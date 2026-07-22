export function normalizeMannYearInput(value: string): string {
  return value.replace(/\D/g, "").slice(0, 4);
}

export function isValidMannYear(value: string, currentYear = new Date().getFullYear()): boolean {
  if (!/^\d{4}$/.test(value)) return false;
  const year = Number(value);
  return year >= 1886 && year <= currentYear + 1;
}

/** A response may update UI state only while it belongs to the latest request. */
export function shouldApplyMannRequest(requestId: number, currentRequestId: number): boolean {
  return requestId === currentRequestId;
}
