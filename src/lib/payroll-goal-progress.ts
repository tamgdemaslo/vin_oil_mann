import { canonicalizeLogin } from "@/lib/auth";
import type { PayrollSummary } from "@/lib/payroll";
import type { PayrollGoalRecord } from "@/lib/payroll-motivation";

/** Count the employee's own attributed quantities, using immutable catalog IDs. */
export function catalogGoalProgress(goal: PayrollGoalRecord, summary: PayrollSummary, login: string) {
  if (!goal.targetId || (goal.metric !== "SERVICE" && goal.metric !== "PRODUCT_CATEGORY")) return 0;
  const targetType = goal.metric === "SERVICE" ? "service" : "product_group";
  const employee = canonicalizeLogin(login).trim().toLowerCase();
  return summary.vehicleHistory.filter((vehicle) => vehicle.date >= goal.startsAt && vehicle.date <= goal.endsAt)
    .reduce((sum, vehicle) => sum + Object.entries(vehicle.salesPositionsByLogin ?? vehicle.pieceworkBreakdownByLogin)
      .filter(([key]) => canonicalizeLogin(key).trim().toLowerCase() === employee)
      .flatMap(([, entries]) => entries)
      .filter((entry) => entry.targetId === goal.targetId && entry.targetType === targetType)
      .reduce((quantity, entry) => quantity + entry.quantity, 0), 0);
}
