export type CashShiftAccessRole = "owner" | "admin" | "master" | string | undefined;

export type CashShiftAccessState = {
  status?: string | null;
} | null | undefined;

/**
 * Единое правило доступа к операционным разделам:
 * owner не зависит от кассы, для остальных нужна открытая кассовая смена филиала.
 */
export function hasOpenCashShiftAccess(
  role: CashShiftAccessRole,
  cashShift: CashShiftAccessState
): boolean {
  if (role === "owner") return true;
  return cashShift?.status === "open";
}
