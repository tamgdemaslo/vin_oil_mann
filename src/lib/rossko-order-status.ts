export type RosskoOrderPartState =
  | "PENDING"
  | "ASSEMBLING"
  | "READY"
  | "IN_TRANSIT"
  | "DELAYED"
  | "AT_BRANCH"
  | "UNAVAILABLE"
  | "CANCELLED"
  | "EXPIRED"
  | "PARTIALLY_RECEIVED"
  | "RECEIVED"
  | "CLOSED_MANUALLY"
  | "RETURN";

export type RosskoReceiptEligibility =
  | "ELIGIBLE"
  | "WAITING_PROVIDER"
  | "PROVIDER_CANCELLED"
  | "ALREADY_RECEIVED"
  | "MANUAL_REVIEW";

export type RosskoOrderPartStatus = {
  state: RosskoOrderPartState;
  rawStatus: string | null;
  label: string;
  sourceStatus: number | null;
  activeIncoming: boolean;
  providerClosed: boolean;
  receivable: boolean;
  warning: boolean;
  receiptEligibility: Exclude<RosskoReceiptEligibility, "ALREADY_RECEIVED">;
};

type RosskoStatusDefinition = Omit<RosskoOrderPartStatus, "sourceStatus"> & { code: number };

/**
 * GetOrders v2.1 status table from the ROSSKO API contract. Receipt eligibility
 * lives next to the provider code so UI and server validation cannot drift.
 */
export const ROSSKO_ORDER_PART_STATUS_TABLE: readonly RosskoStatusDefinition[] = [
  { code: 0, rawStatus: "ждёт подтверждения", state: "PENDING", label: "Ожидает подтверждения", activeIncoming: true, providerClosed: false, receivable: false, warning: false, receiptEligibility: "WAITING_PROVIDER" },
  { code: 1, rawStatus: "комплектуется", state: "ASSEMBLING", label: "Комплектуется", activeIncoming: true, providerClosed: false, receivable: false, warning: false, receiptEligibility: "WAITING_PROVIDER" },
  { code: 2, rawStatus: "отгружено", state: "IN_TRANSIT", label: "Отгружено", activeIncoming: true, providerClosed: false, receivable: true, warning: false, receiptEligibility: "ELIGIBLE" },
  { code: 3, rawStatus: "готово к отгрузке", state: "READY", label: "Готово к отгрузке", activeIncoming: true, providerClosed: false, receivable: false, warning: false, receiptEligibility: "WAITING_PROVIDER" },
  { code: 5, rawStatus: "ожидаем поступление", state: "PENDING", label: "Ожидаем поступление", activeIncoming: true, providerClosed: false, receivable: false, warning: false, receiptEligibility: "WAITING_PROVIDER" },
  { code: 6, rawStatus: "на складе филиала", state: "AT_BRANCH", label: "На складе ROSSKO", activeIncoming: true, providerClosed: false, receivable: true, warning: false, receiptEligibility: "ELIGIBLE" },
  { code: 7, rawStatus: "нет в наличии", state: "UNAVAILABLE", label: "Нет в наличии", activeIncoming: false, providerClosed: true, receivable: false, warning: true, receiptEligibility: "PROVIDER_CANCELLED" },
  { code: 8, rawStatus: "отменён клиентом", state: "CANCELLED", label: "Отменён клиентом", activeIncoming: false, providerClosed: true, receivable: false, warning: true, receiptEligibility: "PROVIDER_CANCELLED" },
  { code: 9, rawStatus: "просрочен", state: "EXPIRED", label: "Просрочено ROSSKO", activeIncoming: false, providerClosed: true, receivable: false, warning: true, receiptEligibility: "PROVIDER_CANCELLED" },
  { code: 31, rawStatus: "ожидаем товар на складе", state: "PENDING", label: "Ожидаем товар на складе", activeIncoming: true, providerClosed: false, receivable: false, warning: false, receiptEligibility: "WAITING_PROVIDER" },
  { code: 32, rawStatus: "возврат на согласовании", state: "RETURN", label: "Возврат на согласовании", activeIncoming: true, providerClosed: false, receivable: false, warning: true, receiptEligibility: "MANUAL_REVIEW" },
  { code: 33, rawStatus: "товар на экспертизе", state: "RETURN", label: "Товар на экспертизе", activeIncoming: true, providerClosed: false, receivable: false, warning: true, receiptEligibility: "MANUAL_REVIEW" },
  { code: 34, rawStatus: "возврат отклонён", state: "RETURN", label: "Возврат отклонён", activeIncoming: true, providerClosed: false, receivable: false, warning: true, receiptEligibility: "MANUAL_REVIEW" },
  { code: 35, rawStatus: "возврат частично отклонён", state: "RETURN", label: "Возврат частично отклонён", activeIncoming: true, providerClosed: false, receivable: false, warning: true, receiptEligibility: "MANUAL_REVIEW" },
  { code: 36, rawStatus: "товар возвращён", state: "RETURN", label: "Товар возвращён", activeIncoming: true, providerClosed: false, receivable: false, warning: true, receiptEligibility: "MANUAL_REVIEW" },
];

const STATUS_MAP = new Map(ROSSKO_ORDER_PART_STATUS_TABLE.map(({ code, ...definition }) => [code, definition]));

export function normalizeRosskoOrderPartStatus(status: number | null | undefined): RosskoOrderPartStatus {
  const sourceStatus = status == null || !Number.isInteger(status) ? null : status;
  const known = sourceStatus == null ? null : STATUS_MAP.get(sourceStatus);
  if (known) return { ...known, sourceStatus };
  if (sourceStatus != null && sourceStatus >= 32) {
    return {
      state: "RETURN",
      rawStatus: null,
      label: `Возврат / разбирательство (${sourceStatus})`,
      sourceStatus,
      activeIncoming: true,
      providerClosed: false,
      receivable: false,
      warning: true,
      receiptEligibility: "MANUAL_REVIEW",
    };
  }
  return {
    state: "PENDING",
    rawStatus: null,
    label: sourceStatus == null ? "Статус не передан" : `Неизвестный статус (${sourceStatus})`,
    sourceStatus,
    activeIncoming: true,
    providerClosed: false,
    receivable: false,
    warning: true,
    receiptEligibility: "MANUAL_REVIEW",
  };
}

export function resolveRosskoReceiptEligibility(
  status: number | null | undefined,
  remainingQty?: number,
): RosskoReceiptEligibility {
  const normalized = normalizeRosskoOrderPartStatus(status);
  if (normalized.receiptEligibility === "PROVIDER_CANCELLED") return "PROVIDER_CANCELLED";
  if (remainingQty != null && Number.isFinite(remainingQty) && remainingQty <= 0) return "ALREADY_RECEIVED";
  return normalized.receiptEligibility;
}

export function calculateRosskoIncomingQuantities(input: {
  orderedQty: number;
  postedReceivedQty: number;
  manualClosedQty: number;
  sourceStatus: number | null | undefined;
}) {
  const orderedQty = Math.max(0, Number(input.orderedQty) || 0);
  const postedReceivedQty = Math.min(orderedQty, Math.max(0, Number(input.postedReceivedQty) || 0));
  const unresolvedAfterReceipt = Math.max(orderedQty - postedReceivedQty, 0);
  const manualClosedQty = Math.min(unresolvedAfterReceipt, Math.max(0, Number(input.manualClosedQty) || 0));
  const status = normalizeRosskoOrderPartStatus(input.sourceStatus);
  const providerClosedQty = status.providerClosed
    ? Math.max(unresolvedAfterReceipt - manualClosedQty, 0)
    : 0;
  const activeIncomingQty = Math.max(
    orderedQty - postedReceivedQty - manualClosedQty - providerClosedQty,
    0,
  );
  return {
    orderedQty,
    postedReceivedQty,
    manualClosedQty,
    providerClosedQty,
    activeIncomingQty,
    closedQty: manualClosedQty + providerClosedQty,
    status,
  };
}

export function calculateRosskoReceiptQuantities(input: {
  orderedQty: number;
  postedReceivedQty: number;
  manualClosedQty: number;
  sourceStatus: number | null | undefined;
}) {
  const incoming = calculateRosskoIncomingQuantities(input);
  const remainingQty = incoming.activeIncomingQty;
  const receiptEligibility = incoming.postedReceivedQty >= incoming.orderedQty && incoming.orderedQty > 0
    ? "ALREADY_RECEIVED"
    : resolveRosskoReceiptEligibility(input.sourceStatus, remainingQty);
  const providerEligibleQty = receiptEligibility === "ELIGIBLE" ? incoming.orderedQty : 0;
  return {
    ...incoming,
    alreadyReceivedQty: incoming.postedReceivedQty,
    remainingQty,
    providerEligibleQty,
    receivableQty: Math.min(providerEligibleQty, remainingQty),
    receiptEligibility,
  };
}

function deliveryDateKey(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : null;
}

export function classifyRosskoDelivery(input: {
  expectedDate: string | null | undefined;
  previousExpectedDate?: string | null;
  today: string;
  activeIncomingQty: number;
  providerClosed: boolean;
}) {
  const expectedDate = deliveryDateKey(input.expectedDate);
  const previousExpectedDate = deliveryDateKey(input.previousExpectedDate);
  const moved = Boolean(previousExpectedDate && expectedDate && previousExpectedDate !== expectedDate);
  const overdue = Boolean(expectedDate && expectedDate < input.today);
  const delayed = input.activeIncomingQty > 0 && !input.providerClosed && (moved || overdue);
  const delayDays = delayed && expectedDate && expectedDate < input.today
    ? Math.max(0, Math.floor((new Date(`${input.today}T00:00:00Z`).getTime() - new Date(`${expectedDate}T00:00:00Z`).getTime()) / 86_400_000))
    : 0;
  return { expectedDate, previousExpectedDate, moved, overdue, delayed, delayDays };
}
