import { normalizeClientCaseStatus } from "@/lib/client-case-shared";
import { parseServiceDateTime, toServiceDateInput } from "@/lib/date-time";

export const WORK_CASE_STATUSES = ["calculation_needed", "calculation_sent", "waiting_parts", "parts_arrived"] as const;
export type WorkCaseStatus = (typeof WORK_CASE_STATUSES)[number];
export type SimpleCaseStatus = WorkCaseStatus | "closed";

type CaseState = {
  caseStatus?: string | null;
  status?: string;
  nextAction?: string | null;
  createdAt?: Date | string;
  nextActionAt?: Date | string | null;
  nextContactAt?: Date | string | null;
  stage?: { name?: string | null } | null;
};

/** Project legacy cases into the simple queue without rewriting or hiding them. */
export function simpleCaseStatus(row: CaseState): SimpleCaseStatus {
  const status = normalizeClientCaseStatus(row.caseStatus, row.stage?.name);
  if (/закры|отказ|дубль|архив|оплач|выполн|потер|lost/i.test(row.stage?.name ?? "")) return "closed";
  if ((row.status && row.status !== "open") || ["closed", "cancelled", "duplicate"].includes(status)) return "closed";
  if (status === "check_response" || status === "client_replied") return "calculation_sent";
  if (status === "postponed") {
    const context = `${row.nextAction ?? ""} ${row.stage?.name ?? ""}`.toLowerCase().replace(/ё/g, "е");
    if (/пришли|поступили/.test(context)) return "parts_arrived";
    if (/запчаст|поставк|расходник/.test(context)) return "waiting_parts";
    if (/ответ|согласован/.test(context)) return "calculation_sent";
    return "calculation_needed";
  }
  return status as WorkCaseStatus;
}

/** A calculation is due on the day received, in the service timezone, not the host timezone. */
export function caseDayDeadline(at: Date | string = new Date()): Date {
  return parseServiceDateTime(`${toServiceDateInput(at)}T23:59:59`)!;
}

export function simpleCaseDeadline(row: CaseState): Date | null {
  const status = simpleCaseStatus(row);
  if (status === "calculation_needed") return row.nextActionAt ? caseDayDeadline(row.nextActionAt) : caseDayDeadline(row.createdAt ?? new Date());
  if (status === "parts_arrived") {
    const value = row.nextActionAt ?? row.nextContactAt;
    return value ? parseServiceDateTime(value) : null;
  }
  return null;
}

export const WORK_CASE_LABELS: Record<SimpleCaseStatus, string> = {
  calculation_needed: "Нужно рассчитать",
  calculation_sent: "Расчёт отправлен",
  waiting_parts: "Запчасти заказаны",
  parts_arrived: "Запчасти пришли",
  closed: "Закрытые",
};
