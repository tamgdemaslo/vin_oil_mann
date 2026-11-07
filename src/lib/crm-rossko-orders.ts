import { requireSingleBranchSqlContext } from "@/lib/branch-sql-context";
import { caseRosskoOrder, parseRosskoOrderNumber, withCaseRosskoOrder } from "@/lib/client-case-parts";
import { simpleCaseStatus } from "@/lib/client-case-simple";
import { caseHistoryChanges } from "@/lib/client-case-history";
import { prisma } from "@/lib/db";
import { rosskoConfig, rosskoOrders } from "@/lib/rossko";
import { rosskoIntegrationError } from "@/lib/rossko-integration";
import { normalizeRosskoOrderPartStatus } from "@/lib/rossko-order-status";
import { loadPostedRosskoOrderQuantities, normalizeRosskoOrder, RosskoReceiptError } from "@/lib/rossko-receipt";
import type { Prisma } from "@prisma/client";

export const CRM_ROSSKO_STATUS_EVENT = "rossko_order_status";

export function describeCrmRosskoOrder(
  lines: Awaited<ReturnType<typeof loadPostedRosskoOrderQuantities>>,
  orderDate: Date | null,
) {
  const arrived = lines.length > 0 && lines.every(({ part, postedQty }) => part.orderedQty > 0 && postedQty >= part.orderedQty);
  const partial = !arrived && lines.some(({ postedQty }) => postedQty > 0);
  const pending = lines.filter(({ part, postedQty }) => !(part.orderedQty > 0 && postedQty >= part.orderedQty));
  const labels = [...new Set(pending.map(({ part }) => normalizeRosskoOrderPartStatus(part.status).label))];
  const dates = (arrived ? lines : pending)
    .map(({ part }) => part.deliveryDate)
    .filter((date): date is Date => date != null);
  const expectedAt = dates.length ? new Date(Math.max(...dates.map((date) => date.getTime()))) : orderDate;
  const supplierStatus = labels.join(" · ");
  const label = arrived
    ? "Запчасти пришли"
    : [partial && "Принято частично", supplierStatus || "Статус позиций не передан"].filter(Boolean).join(" · ");
  return { arrived, expectedAt, label };
}

const selectDeal = {
  id: true,
  updatedAt: true,
  status: true,
  caseStatus: true,
  stage: { select: { name: true } },
  nextAction: true,
  nextActionAt: true,
  nextContactAt: true,
  suppliesNote: true,
  suppliesExpectedAt: true,
  events: {
    where: { eventType: CRM_ROSSKO_STATUS_EVENT },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 1,
    select: { title: true, metadata: true },
  },
} satisfies Prisma.CrmDealSelect;

type OrderDeal = Prisma.CrmDealGetPayload<{ select: typeof selectDeal }>;

type OrderInput =
  | { source: "rossko"; orderNumber: string }
  | { source: "manual"; supplier: string; expectedAt: Date | null };

async function describeOrder(branchId: string, payload: unknown, orderNumber: string) {
  const order = normalizeRosskoOrder(payload, orderNumber);
  return describeCrmRosskoOrder(await loadPostedRosskoOrderQuantities(branchId, order), order.deliveryDate);
}

async function saveOrder(
  branchId: string,
  deal: OrderDeal,
  input: OrderInput,
  snapshot: ReturnType<typeof describeCrmRosskoOrder> | null,
  actorLogin?: string,
) {
  const orderNumber = input.source === "rossko" ? input.orderNumber : null;
  const supplier = input.source === "rossko" ? "РОССКО" : input.supplier;
  const arrived = snapshot?.arrived ?? false;
  const caseStatus = arrived ? "parts_arrived" : "waiting_parts";
  const expectedAt = input.source === "manual" ? input.expectedAt : snapshot?.expectedAt
    ?? (parseRosskoOrderNumber(caseRosskoOrder(deal.suppliesNote)) === orderNumber ? deal.suppliesExpectedAt : null);
  const previous = deal.events[0];
  const previousOrderNumber = (previous?.metadata as { orderNumber?: unknown } | null)?.orderNumber;
  const statusChanged = snapshot != null && (
    actorLogin != null || snapshot.label !== previous?.title || orderNumber !== previousOrderNumber
  );
  const stageChanged = actorLogin != null || arrived;
  if (!stageChanged && !statusChanged && expectedAt?.getTime() === deal.suppliesExpectedAt?.getTime()) return true;

  const stage = stageChanged ? await prisma.crmStage.findFirst({
    where: { branchId, sortOrder: arrived ? 60 : 50 },
    select: { id: true },
  }) : null;
  if (stageChanged && !stage) throw new Error("Не найден этап воронки для заказа");
  const dueAt = arrived ? new Date(Date.now() - 1000) : null;
  const changes = {
    suppliesExpectedAt: expectedAt,
    ...(stage && {
      stageId: stage.id,
      caseStatus,
      nextAction: arrived ? "Позвонить клиенту и записать на обслуживание" : "Ждать поставку запчастей",
      nextActionAt: dueAt,
      nextContactAt: dueAt,
      snoozeUntil: null,
    }),
  };

  return prisma.$transaction(async (tx) => {
    const result = await tx.crmDeal.updateMany({
      where: { id: deal.id, branchId, updatedAt: deal.updatedAt, status: "open", caseStatus: deal.caseStatus },
      data: {
        ...changes,
        ...(actorLogin != null && {
          suppliesSupplier: supplier,
          suppliesNote: withCaseRosskoOrder(deal.suppliesNote, orderNumber ?? ""),
        }),
      },
    });
    if (!result.count) return false;
    if (statusChanged && snapshot) {
      await tx.clientCaseEvent.create({
        data: {
          branchId,
          caseId: deal.id,
          actorLogin,
          eventType: CRM_ROSSKO_STATUS_EVENT,
          title: snapshot.label,
          metadata: { orderNumber, changes: caseHistoryChanges(deal, { ...deal, ...changes }, changes) },
        },
      });
    }
    if (input.source === "manual") {
      await tx.clientCaseEvent.create({
        data: {
          branchId,
          caseId: deal.id,
          actorLogin,
          eventType: "order_source_changed",
          title: "Указан источник заказа",
          metadata: { supplier, changes: caseHistoryChanges(deal, { ...deal, ...changes }, changes) },
        },
      });
    }
    return true;
  });
}

export async function setCrmOrderSource(caseId: string, input: OrderInput, actorLogin: string) {
  const { branchId } = requireSingleBranchSqlContext();
  const deal = await prisma.crmDeal.findFirst({ where: { id: caseId, branchId }, select: selectDeal });
  if (!deal) return { error: "Дело клиента не найдено", status: 404 };
  if (simpleCaseStatus(deal) === "closed") {
    return { error: "Дело клиента закрыто", status: 409 };
  }
  let snapshot = null;
  if (input.source === "rossko") {
    try {
      const payload = await rosskoOrders(await rosskoConfig(), [Number(input.orderNumber)]);
      snapshot = await describeOrder(branchId, payload, input.orderNumber);
    } catch (error) {
      if (error instanceof RosskoReceiptError) {
        return { error: error.message, status: error.status };
      }
      const failure = rosskoIntegrationError(error);
      return { error: failure.error, status: failure.code === "ROSSKO_NOT_CONFIGURED" ? 409 : 502 };
    }
  }
  const saved = await saveOrder(branchId, deal, input, snapshot, actorLogin);
  return saved ? null : { error: "Дело изменилось. Обновите список и повторите попытку.", status: 409 };
}

export async function loadCrmRosskoStatuses(branchId: string, deals: { id: string; suppliesNote: string | null }[]) {
  const statuses = new Map<string, string>();
  if (!deals.length) return statuses;
  const numbers = new Map(deals.map(deal => [deal.id, parseRosskoOrderNumber(caseRosskoOrder(deal.suppliesNote))]));
  try {
    const events = await prisma.clientCaseEvent.findMany({
      where: { branchId, caseId: { in: [...numbers.keys()] }, eventType: CRM_ROSSKO_STATUS_EVENT },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      distinct: ["caseId"],
      select: { caseId: true, metadata: true, title: true },
    });
    for (const event of events) {
      const metadata = event.metadata as { orderNumber?: unknown } | null;
      if (metadata?.orderNumber === numbers.get(event.caseId)) statuses.set(event.caseId, event.title);
    }
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("client_case_events")) throw error;
  }
  return statuses;
}

const SYNC_INTERVAL_MS = 5 * 60_000;
const nextSyncByBranch = new Map<string, number>();

export async function refreshCrmRosskoOrders() {
  const { branchId } = requireSingleBranchSqlContext();
  if (Date.now() < (nextSyncByBranch.get(branchId) ?? 0)) return;
  nextSyncByBranch.set(branchId, Date.now() + SYNC_INTERVAL_MS);

  try {
    const deals = await prisma.crmDeal.findMany({
      where: {
        branchId,
        status: "open",
        caseStatus: { in: ["waiting_parts", "postponed"] },
        suppliesNote: { contains: "Заказ ", mode: "insensitive" },
      },
      select: selectDeal,
    });
    const byOrder = new Map<string, OrderDeal[]>();
    for (const deal of deals) {
      const orderNumber = parseRosskoOrderNumber(caseRosskoOrder(deal.suppliesNote));
      if (orderNumber) byOrder.set(orderNumber, [...(byOrder.get(orderNumber) ?? []), deal]);
    }
    if (!byOrder.size) return;
    const config = await rosskoConfig();
    const orders = [...byOrder];
    for (let offset = 0; offset < orders.length; offset += 20) {
      const batch = orders.slice(offset, offset + 20);
      const payload = await rosskoOrders(config, batch.map(([number]) => Number(number)));
      for (const [orderNumber, linkedDeals] of batch) {
        try {
          const snapshot = await describeOrder(branchId, payload, orderNumber);
          for (const deal of linkedDeals) {
            await saveOrder(branchId, deal, { source: "rossko", orderNumber }, snapshot);
          }
        } catch (error) {
          rosskoIntegrationError(error);
        }
      }
    }
  } catch (error) {
    rosskoIntegrationError(error);
  } finally {
    nextSyncByBranch.set(branchId, Date.now() + SYNC_INTERVAL_MS);
  }
}
