import { canonicalizeLogin } from "@/lib/auth";
import type { PayrollSummary } from "@/lib/payroll";

export function employeePlanEarnings(summary: PayrollSummary, login: string, positions: { positionId: string; rowKey: string }[]) {
  const rowsByPosition = new Map(positions.map((position) => [position.positionId, position.rowKey]));
  const employee = canonicalizeLogin(login).toLowerCase();
  const earnings = new Map<string, number>();
  for (const vehicle of summary.vehicleHistory) {
    for (const [key, entries] of Object.entries(vehicle.pieceworkBreakdownByLogin)) {
      if (canonicalizeLogin(key).toLowerCase() !== employee) continue;
      for (const entry of entries) {
        const rowKey = entry.positionId ? rowsByPosition.get(entry.positionId) : undefined;
        if (rowKey) earnings.set(rowKey, (earnings.get(rowKey) ?? 0) + entry.amountCents);
      }
    }
  }
  return earnings;
}

export function employeePlanPositionIds(summary: PayrollSummary, login: string) {
  const employee = canonicalizeLogin(login).toLowerCase();
  return new Set(summary.vehicleHistory.flatMap((vehicle) => Object.entries(vehicle.pieceworkBreakdownByLogin)
    .filter(([key]) => canonicalizeLogin(key).toLowerCase() === employee)
    .flatMap(([, entries]) => entries.flatMap((entry) => entry.positionId ? [entry.positionId] : []))));
}
