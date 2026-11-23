import { Prisma, type LocalCounterparty } from "@prisma/client";
import { isAnonymousRetailCounterparty, ANONYMOUS_RETAIL_COUNTERPARTY_NAME } from "@/lib/anonymous-retail-counterparty";
import { normalizePhone } from "@/lib/phone-normalize";
import type { BranchContext } from "@/lib/branch-context";
import { LOYALTY_DEFAULTS } from "./calculation";
import { loyaltyLock } from "./posting-request";

export type LoyaltyScope = { businessGroupId: string; branchId: string; actor: string };
export type LoyaltyRules = typeof LOYALTY_DEFAULTS;
type Client = Pick<LocalCounterparty, "id" | "branchId" | "category" | "companyType" | "counterpartyTypeName" | "archived" |
  "status" | "legalForm" | "legalTitle" | "displayName" | "name" | "fullName" | "legalLastName" | "legalFirstName" |
  "legalMiddleName" | "phone" | "normalizedPhone" | "raw">;

export function loyaltyPermissions(context: Pick<BranchContext, "isGroupOwner" | "groupRole" | "branchRole" | "user">) {
  const owner = context.isGroupOwner;
  const manager = owner || context.groupRole === "group_admin"
    || (!context.groupRole && ["branch_owner", "administrator", "manager"].includes(context.branchRole ?? ""))
    || (!context.groupRole && context.user.role === "admin" && context.branchRole === "admin");
  const master = !context.groupRole && context.branchRole === "master";
  return { owner, manager, master, employee: manager || master };
}

export function loyaltyScope(context: BranchContext): LoyaltyScope {
  if (!context.branchId) throw new Error("Выберите филиал");
  return { businessGroupId: context.businessGroupId, branchId: context.branchId, actor: context.user.login };
}

export class LoyaltyError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}

export async function loyaltyProgram(db: Pick<Prisma.TransactionClient, "$queryRaw" | "loyaltyProgram">, businessGroupId: string): Promise<LoyaltyRules> {
  const [schema] = await db.$queryRaw<Array<{ ready: boolean }>>`SELECT to_regclass('loyalty_programs') IS NOT NULL AS ready`;
  if (!schema?.ready) return LOYALTY_DEFAULTS;
  const row = await db.loyaltyProgram.findUnique({ where: { businessGroupId } });
  return row ? { ...row, groupRates: row.groupRates as Record<string, number> } : LOYALTY_DEFAULTS;
}

export function loyaltyIdentity(client: Client) {
  const normalizedName = (value: string) => value.normalize("NFKC").toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const displayName = client.fullName?.trim()
    || [client.legalLastName, client.legalFirstName, client.legalMiddleName].filter(Boolean).join(" ")
    || client.displayName.trim() || client.name.trim();
  const nameKey = normalizedName(displayName);
  const blockedName = /^(?:автопарк|авто парк|таксопарк|таксо парк|ооо|ип|ао|пао)(?: |$)/u;
  if (client.archived || client.status !== "ACTIVE" || client.category !== "INDIVIDUAL"
    || client.companyType?.toLowerCase() !== "individual" || client.legalForm || client.legalTitle
    || /автопарк|таксопарк/i.test(client.counterpartyTypeName ?? "")
    || blockedName.test(nameKey) || normalizedName(ANONYMOUS_RETAIL_COUNTERPARTY_NAME) === nameKey
    || isAnonymousRetailCounterparty(client)) return null;
  const phoneKey = normalizePhone(client.phone) || normalizePhone(client.normalizedPhone);
  return { phoneKey, nameKey, displayName };
}

export async function operation(tx: Prisma.TransactionClient, scope: LoyaltyScope, data: {
  accountId?: string | null; counterpartyId?: string; shipmentId?: string; campaignId?: string;
  kind: string; points: number; reason?: string; requestKey?: string; requestDigest?: string; allocation?: Prisma.InputJsonValue;
}) {
  return tx.loyaltyOperation.create({ data: { ...scope, ...data } });
}

export async function inspectLoyaltyClient(tx: Prisma.TransactionClient, scope: LoyaltyScope, client: Client | null, {
  mode = "read", chosenAccountId, allowSeparate = false, reason,
}: { mode?: "read" | "sale" | "confirm" | "manage" | "campaign"; chosenAccountId?: string; allowSeparate?: boolean; reason?: string } = {}) {
  if (!client || client.branchId !== scope.branchId) return { status: "ineligible" as const };
  if (mode !== "read") {
    await loyaltyLock(tx, `loyalty:card:${client.id}`);
    await tx.$queryRaw`SELECT id FROM local_counterparties WHERE id = ${client.id} AND branch_id = ${scope.branchId} FOR UPDATE`;
    client = await tx.localCounterparty.findFirst({ where: { branchId: scope.branchId, id: client.id } });
    if (!client) return { status: "ineligible" as const };
  }
  const identity = loyaltyIdentity(client);
  if (!identity) return { status: "ineligible" as const };
  const existing = await tx.loyaltyLink.findFirst({ where: { businessGroupId: scope.businessGroupId, branchId: scope.branchId, counterpartyId: client.id } });
  if (existing?.excluded) return { status: "excluded" as const };
  if (existing?.accountId) return { status: "linked" as const, accountId: existing.accountId };
  if (!identity.phoneKey || identity.nameKey.split(" ").length < 2) return { status: "incomplete" as const };
  const { phoneKey, nameKey, displayName } = identity;
  if (mode !== "read") await loyaltyLock(tx, `loyalty:phone:${scope.businessGroupId}:${phoneKey}`);
  const accounts = await tx.loyaltyAccount.findMany({
    where: { businessGroupId: scope.businessGroupId, phoneKey },
    select: { id: true, nameKey: true, displayName: true },
    orderBy: { id: "asc" },
  });
  const exact = accounts.filter((item) => item.nameKey === nameKey);
  const conflict = existing?.review || exact.length > 1 || (accounts.length > 0 && exact.length === 0);
  const saveLink = (accountId: string | null, review: boolean) => tx.loyaltyLink.upsert({
    where: { counterpartyId: client.id },
    create: { counterpartyId: client.id, branchId: scope.branchId, businessGroupId: scope.businessGroupId, accountId, review },
    update: { accountId, review },
  });
  if (conflict && mode !== "manage") {
    if (!existing?.review && mode !== "read") {
      await saveLink(null, true);
      await operation(tx, scope, { counterpartyId: client.id, kind: "LINK_REVIEW", points: 0 });
    }
    return { status: "review" as const, candidates: accounts.map(({ id, displayName }) => ({ id, displayName })) };
  }
  if (mode === "confirm" && exact.length !== 1) throw new LoyaltyError("Совпадение изменилось. Обновите карточку");
  if (mode === "manage" && !conflict) throw new LoyaltyError("Карточка не ожидает разбора совпадения");
  if (mode === "read" || (exact.length === 1 && (mode === "sale" || mode === "campaign"))) {
    return { status: exact.length ? "confirm" as const : "new" as const };
  }
  let accountId: string | undefined;
  if (mode === "manage") {
    if (chosenAccountId) accountId = accounts.find((item) => item.id === chosenAccountId)?.id;
    else if (!allowSeparate) throw new LoyaltyError("Укажите решение по совпадению");
    if (chosenAccountId && !accountId) throw new LoyaltyError("Список счетов изменился. Обновите карточку");
  } else {
    accountId = exact[0]?.id;
  }
  if (!accountId) {
    accountId = (await tx.loyaltyAccount.create({ data: { businessGroupId: scope.businessGroupId, phoneKey, nameKey, displayName } })).id;
  }
  await saveLink(accountId, false);
  await operation(tx, scope, { counterpartyId: client.id, accountId, kind: "LINKED", points: 0, reason });
  return { status: "linked" as const, accountId };
}

export async function flagLoyaltyReview(tx: Prisma.TransactionClient, scope: LoyaltyScope, client: Client) {
  const result = await inspectLoyaltyClient(tx, scope, client);
  if (result.status === "review") return inspectLoyaltyClient(tx, scope, client, { mode: "sale" });
  return result;
}
