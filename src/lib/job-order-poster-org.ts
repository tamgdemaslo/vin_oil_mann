import { normalizeSellerPhonesForPrint } from "@/lib/job-order-seller-phone";

function formatOrgPhones(org: Record<string, unknown>): string {
  const phone = org.phone;
  if (typeof phone === "string") return phone;
  if (phone && typeof phone === "object") {
    const n = (phone as { number?: string }).number;
    if (n) return n;
  }
  const phones = org.phones;
  if (Array.isArray(phones)) {
    return phones
      .map((p) => {
        if (typeof p === "string") return p;
        if (p && typeof p === "object" && "number" in p) return String((p as { number: string }).number);
        return "";
      })
      .filter(Boolean)
      .join(", ");
  }
  return "";
}

function pickDirector(org: Record<string, unknown>): string {
  const company = org.company as Record<string, unknown> | undefined;
  if (company && typeof company.director === "string" && company.director.trim()) return company.director.trim();
  if (typeof org.director === "string" && org.director.trim()) return org.director.trim();
  if (typeof org.name === "string" && org.name.trim()) return org.name.trim();
  return "";
}

export async function fetchOrganizationRecord(rawDemand: unknown): Promise<Record<string, unknown> | null> {
  const organization = (rawDemand as { organization?: unknown })?.organization;
  return organization && typeof organization === "object" ? (organization as Record<string, unknown>) : null;
}

export function sellerFromOrg(org: Record<string, unknown> | null): {
  director: string;
  inn: string;
  ogrn: string;
  legalAddress: string;
  phones: string;
} {
  if (!org) {
    return {
      director: process.env.JOB_ORDER_SELLER_DIRECTOR?.trim() ?? "",
      inn: process.env.JOB_ORDER_SELLER_INN?.trim() ?? "",
      ogrn: process.env.JOB_ORDER_SELLER_OGRN?.trim() ?? "",
      legalAddress: process.env.JOB_ORDER_SELLER_ADDRESS?.trim() ?? "",
      phones: normalizeSellerPhonesForPrint(process.env.JOB_ORDER_SELLER_PHONES?.trim() ?? ""),
    };
  }
  return {
    director: pickDirector(org),
    inn: String(org.inn ?? ""),
    ogrn: String(org.ogrn ?? (org as Record<string, unknown>)["ogrnip"] ?? ""),
    legalAddress: String(org.legalAddress ?? org.actualAddress ?? ""),
    phones: normalizeSellerPhonesForPrint(formatOrgPhones(org)),
  };
}
