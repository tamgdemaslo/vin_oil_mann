export const OVERDUE_SIGNAL_INTERVAL_MS = 5 * 60_000;
export type CaseSignalKind = "new" | "overdue";
export function signalDue(last: number | null, now: number) {
  return last === null || now - last >= OVERDUE_SIGNAL_INTERVAL_MS;
}
export function signalNotes(kind: CaseSignalKind) {
  return kind === "new"
    ? [{ frequency: 660, at: 0, duration: 0.16 }, { frequency: 880, at: 0.2, duration: 0.25 }]
    : Array.from({ length: 6 }, (_, index) => ({ frequency: index % 2 ? 440 : 880, at: index * 0.3, duration: 0.22 }));
}
