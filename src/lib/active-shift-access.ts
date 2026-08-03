export type ShiftAccessRole = "owner" | "admin" | "master" | string | undefined;

export type CashShiftAccessState = {
  status?: string | null;
} | null | undefined;

/**
 * Единое правило доступа к операционным разделам:
 * owner не зависит от смены, для остальных достаточно рабочей или кассовой смены.
 */
export function hasActiveShiftAccess(
  role: ShiftAccessRole,
  workShift: unknown,
  cashShift: CashShiftAccessState
): boolean {
  if (role === "owner") return true;
  return Boolean(workShift) || cashShift?.status === "open";
}
