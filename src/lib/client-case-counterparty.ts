import { formatPhoneForDisplay, normalizePhone } from "@/lib/phone-normalize";

type CaseClient = { clientCounterpartyId?: string | null; phoneNormalized?: string | null; customerName?: string | null };

export function caseCustomerTitle(row: CaseClient): string {
  return row.customerName?.trim() || formatPhoneForDisplay(row.phoneNormalized) || "Клиент не указан";
}

export function caseCounterpartyHref(row: CaseClient): string | null {
  if (row.clientCounterpartyId) return `/clients/counterparties?counterparty=${encodeURIComponent(row.clientCounterpartyId)}`;
  const query = normalizePhone(row.phoneNormalized) || row.customerName?.trim();
  return query ? `/clients/counterparties?search=${encodeURIComponent(query)}` : null;
}

export function caseCounterpartyPhoneKeys(phone: string | null | undefined): string[] {
  const key = normalizePhone(phone);
  if (!key) return [];
  return /^9\d{9}$/.test(key) ? [key, `7${key}`, `8${key}`] : [key];
}

export function uniqueCaseCounterpartyId(phone: string | null | undefined, clients: Array<{ id: string; normalizedPhone: string | null }>): string | null {
  const key = normalizePhone(phone);
  if (!key) return null;
  const matches = new Set(clients.filter(client => normalizePhone(client.normalizedPhone) === key).map(client => client.id));
  return matches.size === 1 ? [...matches][0] : null;
}
