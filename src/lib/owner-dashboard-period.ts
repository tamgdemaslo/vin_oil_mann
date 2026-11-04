import { SERVICE_TIME_ZONE } from "@/lib/date-time";

// Calendar dates are computed in the branch's zone, never the server's zone.
export function ownerDashboardPeriod(now = new Date(), timeZone = SERVICE_TIME_ZONE) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now).filter(p => p.type !== "literal").map(p => [p.type, p.value]));
  const year = Number(parts.year), month = Number(parts.month), day = Number(parts.day);
  const date = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
  const previousLast = new Date(Date.UTC(year, month - 1, 0));
  const previousDay = Math.min(day, previousLast.getUTCDate());
  return {
    month: `${parts.year}-${parts.month}`,
    dateFrom: date(year, month, 1),
    dateTo: date(year, month + 1, 0),
    today: date(year, month, day),
    previousFrom: date(year, month - 1, 1),
    previousTo: date(year, month - 1, previousDay),
    comparisonDays: previousDay,
    currentComparisonTo: date(year, month, previousDay),
  };
}

export function ownerDashboardDelta(current: number, previous: number) {
  return previous === 0 ? current === 0 ? 0 : null : (current - previous) / Math.abs(previous) * 100;
}
