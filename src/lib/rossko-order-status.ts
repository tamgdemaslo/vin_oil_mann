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

export type RosskoOrderPartStatus = {
  state: RosskoOrderPartState;
  label: string;
  sourceStatus: number | null;
  activeIncoming: boolean;
  providerClosed: boolean;
  receivable: boolean;
  warning: boolean;
};

const STATUS_MAP: Record<number, Omit<RosskoOrderPartStatus, "sourceStatus">> = {
  0: { state: "PENDING", label: "Ожидает подтверждения", activeIncoming: true, providerClosed: false, receivable: true, warning: false },
  1: { state: "ASSEMBLING", label: "Комплектуется", activeIncoming: true, providerClosed: false, receivable: true, warning: false },
  2: { state: "IN_TRANSIT", label: "Отгружено", activeIncoming: true, providerClosed: false, receivable: true, warning: false },
  3: { state: "READY", label: "Готово к отгрузке", activeIncoming: true, providerClosed: false, receivable: true, warning: false },
  5: { state: "PENDING", label: "Ожидаем поступление", activeIncoming: true, providerClosed: false, receivable: true, warning: false },
  6: { state: "AT_BRANCH", label: "На складе ROSSKO", activeIncoming: true, providerClosed: false, receivable: true, warning: false },
  7: { state: "UNAVAILABLE", label: "Нет в наличии", activeIncoming: false, providerClosed: true, receivable: false, warning: true },
  8: { state: "CANCELLED", label: "Отменён клиентом", activeIncoming: false, providerClosed: true, receivable: false, warning: true },
  9: { state: "EXPIRED", label: "Просрочено ROSSKO", activeIncoming: false, providerClosed: true, receivable: false, warning: true },
  31: { state: "PENDING", label: "Ожидаем товар на складе", activeIncoming: true, providerClosed: false, receivable: true, warning: false },
  32: { state: "RETURN", label: "Возврат на согласовании", activeIncoming: true, providerClosed: false, receivable: false, warning: true },
  33: { state: "RETURN", label: "Товар на экспертизе", activeIncoming: true, providerClosed: false, receivable: false, warning: true },
  34: { state: "RETURN", label: "Возврат отклонён", activeIncoming: true, providerClosed: false, receivable: false, warning: true },
  35: { state: "RETURN", label: "Возврат частично отклонён", activeIncoming: true, providerClosed: false, receivable: false, warning: true },
  36: { state: "RETURN", label: "Товар возвращён", activeIncoming: true, providerClosed: false, receivable: false, warning: true },
};

export function normalizeRosskoOrderPartStatus(status: number | null | undefined): RosskoOrderPartStatus {
  const sourceStatus = status == null || !Number.isInteger(status) ? null : status;
  const known = sourceStatus == null ? null : STATUS_MAP[sourceStatus];
  if (known) return { ...known, sourceStatus };
  if (sourceStatus != null && sourceStatus >= 32) {
    return {
      state: "RETURN",
      label: `Возврат / разбирательство (${sourceStatus})`,
      sourceStatus,
      activeIncoming: true,
      providerClosed: false,
      receivable: false,
      warning: true,
    };
  }
  return {
    state: "PENDING",
    label: sourceStatus == null ? "Статус не передан" : `Неизвестный статус (${sourceStatus})`,
    sourceStatus,
    activeIncoming: true,
    providerClosed: false,
    receivable: sourceStatus == null,
    warning: sourceStatus != null,
  };
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
