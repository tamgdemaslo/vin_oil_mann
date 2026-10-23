import { simpleCaseStatus } from "@/lib/client-case-simple";
import { clientCaseStatusLabel, isClientCaseStatus } from "@/lib/client-case-shared";
import { formatServiceDateTime } from "@/lib/date-time";

type State = Parameters<typeof simpleCaseStatus>[0] & { suppliesExpectedAt?: Date | string | null };
type Change = { field: "status" | "deadline" | "delivery"; before: string | null; after: string | null };
const instant = (value: Date | string | null | undefined) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
};

export function caseHistoryChanges(before: State, after: State): Change[] {
  const pairs: Change[] = [
    { field: "status", before: simpleCaseStatus(before), after: simpleCaseStatus(after) },
    { field: "deadline", before: instant(before.nextActionAt ?? before.nextContactAt), after: instant(after.nextActionAt ?? after.nextContactAt) },
    { field: "delivery", before: instant(before.suppliesExpectedAt), after: instant(after.suppliesExpectedAt) },
  ];
  return pairs.filter(change => change.before !== change.after);
}

export type CaseHistoryEvent = { id: string; actorLogin: string | null; createdAt: string; eventType: string; title: string; metadata: unknown };

export function caseHistoryLines(event: Pick<CaseHistoryEvent, "eventType" | "title" | "metadata">): string[] {
  const meta = event.metadata && typeof event.metadata === "object" ? event.metadata as Record<string, unknown> : {};
  if (Array.isArray(meta.changes)) {
    const lines = meta.changes.flatMap(value => {
      if (!value || typeof value !== "object") return [];
      const change = value as Change;
      if (!["status", "deadline", "delivery"].includes(change.field)) return [];
      if (change.field === "status") return isClientCaseStatus(change.before) && isClientCaseStatus(change.after) ? [`Статус: ${clientCaseStatusLabel(change.before)} → ${clientCaseStatusLabel(change.after)}`] : [];
      if ((change.before !== null && (typeof change.before !== "string" || !instant(change.before))) || (change.after !== null && (typeof change.after !== "string" || !instant(change.after)))) return [];
      const label = change.field === "delivery" ? "Срок поставки" : "Срок действия";
      return [`${label}: ${change.before ? formatServiceDateTime(change.before) : "не указан"} → ${change.after ? formatServiceDateTime(change.after) : "снят"}`];
    });
    return event.eventType === "confirm_manual_booking" ? ["Подтверждена ручная запись клиента", ...lines] : lines;
  }
  if (event.eventType === "confirm_manual_booking") return ["Клиент записан вручную — заявка закрыта"];
  if (isClientCaseStatus(meta.status)) return [`Статус: ${clientCaseStatusLabel(meta.status)}`];
  if (event.eventType === "case_updated") return ["Заявка изменена. Подробности старого изменения не сохранялись."];
  return [event.title];
}
