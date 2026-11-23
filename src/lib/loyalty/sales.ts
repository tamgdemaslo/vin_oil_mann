import type { SyncAqsiPendingOrderInput } from "@/lib/aqsi";
import type { LocalCounterparty, Prisma } from "@prisma/client";
import { isServiceCostType } from "@/lib/inventory-costing";
import { toServiceDateInput } from "@/lib/date-time";
import { inspectLoyaltyClient, loyaltyIdentity, LoyaltyError, loyaltyProgram, type LoyaltyRules, type LoyaltyScope } from "./accounts";
import { calculateLoyalty, loyaltyLineCents, returnLineDelta, type LoyaltyIntent, type LoyaltyLine, type LoyaltyQuote } from "./calculation";
import { grantLoyalty, lockLoyaltyAccount, loyaltyBalance, recordExpirations, restoreSpent, reverseEarned, spendLoyalty } from "./ledger";
import { requestDigest } from "./posting-request";

type SalePosition = {
  id?: string;
  productId: string | null;
  groupIdSnapshot: string | null;
  assortmentType: string;
  quantity: Prisma.Decimal | number;
  priceCentsPerUnit: number;
  discount: Prisma.Decimal | number;
};
type FrozenLine = LoyaltyLine & { id: string };
type ReturnSelection = { id: string; quantityMilli: number; unitKeys?: string[] };
type ReturnLine = ReturnSelection & { spendCents: number };
export type FiscalReturnUnit = { key: string; label: string; cashCents: number; returned: boolean };


async function calculateSale(
  db: Prisma.TransactionClient, scope: LoyaltyScope, rules: LoyaltyRules, positions: SalePosition[],
  accountId: string | null, balance: number, points: number,
) {
  const ids = [...new Set(positions.flatMap((position) => position.productId ? [position.productId] : []))];
  const products = ids.length ? await db.localProduct.findMany({
    where: { branchId: scope.branchId, id: { in: ids } },
    select: { id: true, groupId: true, entityType: true, groupPath: true },
  }) : [];
  const byId = new Map(products.map((product) => [product.id, product]));
  const groups = Object.keys(rules.groupRates).length ? await db.localCatalogGroup.findMany({
    where: { branchId: scope.branchId, kind: "product", id: { in: Object.keys(rules.groupRates) }, archived: false },
    select: { id: true, name: true },
  }) : [];
  const pathKey = (value: string) => value.split(/\s*[/>\\]\s*/u).map((part) => part.trim().toLocaleLowerCase("ru-RU")).filter(Boolean);
  const configuredByPath = new Map(groups.map((group) => [pathKey(group.name).join("/"), rules.groupRates[group.id]]));
  const configuredIds = new Set(groups.map((group) => group.id));
  const input = positions.map((position) => {
    const product = position.productId ? byId.get(position.productId) : null;
    const type = product?.entityType ?? position.assortmentType;
    const groupId = product ? product.groupId : position.groupIdSnapshot;
    let groupRate = groupId && configuredIds.has(groupId) ? rules.groupRates[groupId] : undefined;
    const path = pathKey(product?.groupPath ?? "");
    while (groupRate === undefined && path.length) {
      groupRate = configuredByPath.get(path.join("/"));
      path.pop();
    }
    return {
      beforeCents: loyaltyLineCents(Number(position.quantity), position.priceCentsPerUnit, Number(position.discount)),
      rate: isServiceCostType(type) ? rules.serviceRate : groupRate ?? rules.productRate,
      quantityMilli: Math.round(Number(position.quantity) * 1000),
    };
  });
  const { lines, ...quote } = calculateLoyalty(input, rules, balance, points);
  return {
    lines,
    quote: { ...quote, token: requestDigest([scope.branchId, accountId, rules.centsPerPoint, quote.spent, input,
      positions.map((position) => [position.productId, position.assortmentType, position.priceCentsPerUnit, String(position.discount)])]) },
  };
}

export class LoyaltyQuoteChanged extends LoyaltyError {
  constructor(public quote: LoyaltyQuote) {
    super("Доступное списание или расчёт изменились. Проверьте новую сумму и подтвердите списание ещё раз.");
  }
}

export async function previewSaleLoyalty(tx: Prisma.TransactionClient, scope: LoyaltyScope, client: LocalCounterparty | null, positions: SalePosition[], points: number) {
  const rules = await loyaltyProgram(tx, scope.businessGroupId);
  if (!rules.enabled) return { status: "disabled" };
  const match = await inspectLoyaltyClient(tx, scope, client);
  if (match.status === "review" && client) await inspectLoyaltyClient(tx, scope, client, { mode: "sale" });
  if (match.status !== "linked" && match.status !== "new") return { status: match.status };
  const accountId = match.status === "linked" ? match.accountId : null;
  if (accountId) await lockLoyaltyAccount(tx, scope, accountId);
  const balance = accountId ? (await loyaltyBalance(tx, scope.businessGroupId, accountId)).balance : 0;
  return { status: match.status, quote: (await calculateSale(tx, scope, rules, positions, accountId, balance, points)).quote };
}

export async function postSaleLoyalty(
  tx: Prisma.TransactionClient, scope: LoyaltyScope, client: LocalCounterparty | null,
  positions: SalePosition[], intent: LoyaltyIntent | undefined, shipmentId: string, revision: number, documentDate: string,
) {
  const points = intent?.points ?? 0;
  if (!Number.isSafeInteger(points) || points < 0 || (intent?.skip && points > 0)) throw new LoyaltyError("Проверьте сумму списания", 400);
  if (intent?.skip || !client || !loyaltyIdentity(client) || positions.length === 0) {
    if (points) throw new LoyaltyError("Для выбранной отгрузки списание недоступно. Уберите списание или обновите расчёт.");
    return null;
  }
  const rules = await loyaltyProgram(tx, scope.businessGroupId);
  if (!rules.enabled) {
    if (points) throw new LoyaltyError("Программа отключена. Уберите списание или обновите расчёт.");
    return null;
  }
  const match = await inspectLoyaltyClient(tx, scope, client, { mode: "sale" });
  if (match.status !== "linked") {
    if (points) throw new LoyaltyError("Подтвердите бонусный счёт или уберите списание.");
    return null;
  }
  const { accountId } = match;
  if (await tx.aqsiFiscalizationRecord.findFirst({
    where: { branchId: scope.branchId, documentType: "local_demand", documentId: shipmentId }, select: { id: true },
  })) {
    if (points) throw new LoyaltyError("Отгрузка уже передана на кассу. Уберите списание");
    return null;
  }
  await lockLoyaltyAccount(tx, scope, accountId);
  const now = new Date();
  const { balance } = await loyaltyBalance(tx, scope.businessGroupId, accountId, now);
  const { quote, lines } = await calculateSale(tx, scope, rules, positions, accountId, balance, points);
  if (points > 0 && (quote.spent !== points || intent?.token !== quote.token)) throw new LoyaltyQuoteChanged(quote);
  await recordExpirations(tx, scope, accountId, now);
  const origin = { shipmentId, counterpartyId: client.id };
  const spendOperationId = quote.spent > 0
    ? await spendLoyalty(tx, scope, accountId, "PURCHASE_SPEND", quote.spent, origin, now) : null;
  const earned = intent?.suppressEarn === true ? 0 : quote.earned;
  const earnOperationId = earned > 0
    ? await grantLoyalty(tx, scope, accountId, "PURCHASE_EARN", earned, origin, null, now) : null;
  const { beforeCents, cashCents, spent, centsPerPoint } = quote;
  const frozen = lines.map((line, index) => {
    const id = positions[index].id;
    if (!id) throw new Error("Отсутствует идентификатор бонусной строки");
    return { ...line, earned: intent?.suppressEarn === true ? 0 : line.earned, id };
  });
  await tx.loyaltySale.create({ data: {
    ...scope, shipmentId, revision, documentDate, accountId, beforeCents, cashCents, spent, earned, centsPerPoint,
    spendOperationId, earnOperationId, lines: frozen,
  } });
  return { beforeCents, cashCents, spent, earned, centsPerPoint, lines: frozen };
}

export async function voidLoyaltySale(tx: Prisma.TransactionClient, scope: LoyaltyScope, shipmentId: string, reason: string) {
  const [schema] = await tx.$queryRaw<Array<{ ready: boolean }>>`SELECT to_regclass('loyalty_sales') IS NOT NULL AS ready`;
  if (!schema?.ready) return;
  const sale = await tx.loyaltySale.findFirst({ where: { businessGroupId: scope.businessGroupId, branchId: scope.branchId, shipmentId, voidedAt: null },
    include: { _count: { select: { returns: true } } } });
  if (!sale) return;
  if (sale._count.returns) throw new LoyaltyError("По отгрузке уже зарегистрирован возврат");
  const fiscalization = await tx.aqsiFiscalizationRecord.findFirst({ where: { branchId: scope.branchId, documentType: "local_demand", documentId: shipmentId } });
  if (fiscalization) throw new LoyaltyError("Отгрузка передана на кассу. Оформите возврат по чеку");
  await lockLoyaltyAccount(tx, scope, sale.accountId);
  const now = new Date();
  await recordExpirations(tx, scope, sale.accountId, now);
  if (sale.earnOperationId) await reverseEarned(tx, scope, sale.accountId, sale.earnOperationId, sale.earned, { shipmentId, reason }, now);
  if (sale.spendOperationId) await restoreSpent(tx, scope, sale.accountId, sale.spendOperationId, 0, sale.spent, { shipmentId, reason }, now);
  await tx.loyaltySale.update({ where: { id: sale.id }, data: { voidedAt: now } });
}

async function readFiscalReturnUnits(db: Pick<Prisma.TransactionClient, "aqsiFiscalizationRecord">, scope: LoyaltyScope, shipmentId: string, returns: { lines: unknown }[]) {
  const record = await db.aqsiFiscalizationRecord.findFirst({
    where: { branchId: scope.branchId, documentId: shipmentId, documentType: "local_demand", status: "succeeded" },
    select: { payloadJson: true },
  });
  const payload = record?.payloadJson as unknown as SyncAqsiPendingOrderInput | undefined;
  const returned = new Set(returns.flatMap((entry) => (entry.lines as ReturnLine[]).flatMap((line) => line.unitKeys ?? [])));
  const unitsByPosition = new Map<string, FiscalReturnUnit[]>();
  for (const item of payload?.items ?? []) {
    if (!item.sourcePositionId || !item.markingCode || item.quantity !== 1 || item.exactUnitPrice === undefined) continue;
    const units = unitsByPosition.get(item.sourcePositionId) ?? [];
    const key = requestDigest([item.sourcePositionId, item.markingCode]);
    units.push({ key, label: item.markingCode.split("\u001d")[0].slice(-14),
      cashCents: Math.round(item.exactUnitPrice * 100), returned: returned.has(key) });
    unitsByPosition.set(item.sourcePositionId, units);
  }
  return new Map([...unitsByPosition].filter(([, units]) => new Set(units.map((unit) => unit.cashCents)).size > 1));
}

export async function fiscalReturnChoices(db: Pick<Prisma.TransactionClient, "loyaltySale" | "aqsiFiscalizationRecord">, scope: LoyaltyScope, shipmentId: string) {
  const sale = await db.loyaltySale.findFirst({
    where: { businessGroupId: scope.businessGroupId, branchId: scope.branchId, shipmentId, voidedAt: null },
    select: { returns: { select: { lines: true } } },
  });
  if (!sale) throw new LoyaltyError("У отгрузки нет бонусного расчёта", 404);
  return Object.fromEntries(await readFiscalReturnUnits(db, scope, shipmentId, sale.returns));
}

export type ReturnRequest = { token?: string; requestKey: string; receipt: string; reason: string; lines: ReturnSelection[] };
export async function saleReturn(tx: Prisma.TransactionClient, scope: LoyaltyScope, shipmentId: string, input: ReturnRequest, preview: boolean) {
  const [demand] = await tx.$queryRaw<Array<{ applicable: boolean }>>`SELECT applicable FROM local_demands
    WHERE id = ${shipmentId} AND branch_id = ${scope.branchId} FOR UPDATE`;
  if (!demand?.applicable) throw new LoyaltyError("Проведённая отгрузка не найдена", 404);
  const sale = await tx.loyaltySale.findFirst({ where: { ...{ businessGroupId: scope.businessGroupId, branchId: scope.branchId }, shipmentId, voidedAt: null },
    include: { returns: true } });
  if (!sale) throw new LoyaltyError("У отгрузки нет бонусного расчёта", 404);
  const byId = new Map((sale.lines as FrozenLine[]).map((line) => [line.id, line]));
  const existing = sale.returns.find((item) => item.requestKey === input.requestKey);
  if (existing && !preview) {
    const comparable = (lines: ReturnRequest["lines"]) => lines.map(({ id, quantityMilli, unitKeys }) => [id, quantityMilli, [...unitKeys ?? []].sort()]);
    if (existing.receipt !== input.receipt || existing.reason !== input.reason ||
      requestDigest(comparable(existing.lines as ReturnLine[])) !== requestDigest(comparable(input.lines))) {
      throw new LoyaltyError("Ключ возврата уже использован с другими данными");
    }
    return existing;
  }
  if (!preview && sale.returns.some((item) => item.receipt === input.receipt)) throw new LoyaltyError("Этот чек возврата уже зарегистрирован");
  const fiscalUnits = await readFiscalReturnUnits(tx, scope, shipmentId, sale.returns);
  const quantities = new Map<string, number>();
  let previousCents = 0;
  for (const item of sale.returns) {
    for (const line of item.lines as ReturnLine[]) {
      quantities.set(line.id, (quantities.get(line.id) ?? 0) + line.quantityMilli);
      previousCents += line.spendCents;
    }
  }
  const totals = { beforeCents: 0, cashCents: 0, spendCents: 0, earnedReversed: 0 };
  const lines = input.lines.map(({ id, quantityMilli, unitKeys }) => {
    const original = byId.get(id);
    if (!original) throw new LoyaltyError("Строка отсутствует в исходной продаже");
    const previous = quantities.get(id) ?? 0;
    if (previous + quantityMilli > original.quantityMilli) throw new LoyaltyError("Количество возврата превышает остаток исходной позиции");
    const delta = returnLineDelta(original, previous, previous + quantityMilli);
    const units = fiscalUnits.get(id);
    const chosen = units && unitKeys ? units.filter((unit) => !unit.returned && unitKeys.includes(unit.key)) : [];
    if (units && (chosen.length * 1000 !== quantityMilli || chosen.length !== unitKeys?.length)) {
      throw new LoyaltyError("Выберите невозвращённые коды маркировки из исходного чека");
    }
    if (!units && unitKeys?.length) throw new LoyaltyError("Коды маркировки не относятся к строке возврата");
    const cashCents = units ? chosen.reduce((sum, unit) => sum + unit.cashCents, 0) : delta.cashCents;
    const beforeCents = cashCents + delta.spendCents;
    quantities.set(id, previous + quantityMilli);
    totals.beforeCents += beforeCents;
    totals.cashCents += cashCents;
    totals.spendCents += delta.spendCents;
    totals.earnedReversed += delta.earned;
    return { id, quantityMilli, ...delta, beforeCents, cashCents, ...(units ? { unitKeys: chosen.map((unit) => unit.key) } : {}) };
  });
  const previousPoints = Math.floor(previousCents / sale.centsPerPoint);
  const restored = Math.floor((previousCents + totals.spendCents) / sale.centsPerPoint) - previousPoints;
  const { beforeCents, cashCents, earnedReversed } = totals;
  const token = requestDigest([sale.id, sale.returns.map((item) => item.id).sort(), lines]);
  if (preview) return { beforeCents, cashCents, restored, earnedReversed, lines, token };
  if (token !== input.token) throw new LoyaltyError("Расчёт возврата изменился. Рассчитайте его повторно.");
  await lockLoyaltyAccount(tx, scope, sale.accountId);
  const now = new Date();
  await recordExpirations(tx, scope, sale.accountId, now);
  const origin = { shipmentId, reason: input.reason };
  if (earnedReversed && sale.earnOperationId) {
    await reverseEarned(tx, scope, sale.accountId, sale.earnOperationId, earnedReversed, origin, now);
  }
  if (restored && sale.spendOperationId) {
    await restoreSpent(tx, scope, sale.accountId, sale.spendOperationId, previousPoints, restored, origin, now);
  }
  return tx.loyaltyReturn.create({ data: {
    branchId: scope.branchId, saleId: sale.id, actor: scope.actor, documentDate: toServiceDateInput(now),
    requestKey: input.requestKey, receipt: input.receipt, reason: input.reason,
    beforeCents, cashCents, restored, earnedReversed, lines,
  } });
}
