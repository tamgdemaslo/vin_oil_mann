/** UTC is used for calendar arithmetic so a browser timezone cannot move a day. */
export function payrollGoalPeriod(anchor: string, periodType: "WEEK" | "MONTH") {
  const date = new Date(`${anchor}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchor) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== anchor) return null;
  const start = new Date(date);
  const end = new Date(date);
  if (periodType === "WEEK") {
    start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
    end.setTime(start.getTime());
    end.setUTCDate(end.getUTCDate() + 6);
  } else {
    start.setUTCDate(1);
    end.setUTCMonth(end.getUTCMonth() + 1, 0);
  }
  return { dateFrom: start.toISOString().slice(0, 10), dateTo: end.toISOString().slice(0, 10) };
}
