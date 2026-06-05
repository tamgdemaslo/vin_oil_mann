import { prisma } from "@/lib/db";
import { normalizeSellerPhonesForPrint } from "@/lib/job-order-seller-phone";

type SellerRequisites = {
  director: string;
  inn: string;
  ogrn: string;
  legalAddress: string;
  phones: string;
};

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function envSeller(): SellerRequisites {
  return {
    director: process.env.JOB_ORDER_SELLER_DIRECTOR?.trim() ?? "",
    inn: process.env.JOB_ORDER_SELLER_INN?.trim() ?? "",
    ogrn: process.env.JOB_ORDER_SELLER_OGRN?.trim() ?? "",
    legalAddress: process.env.JOB_ORDER_SELLER_ADDRESS?.trim() ?? "",
    phones: normalizeSellerPhonesForPrint(process.env.JOB_ORDER_SELLER_PHONES?.trim() ?? ""),
  };
}

function firstFilled(...values: unknown[]): string {
  for (const value of values) {
    const text = cleanText(value);
    if (text) return text;
  }
  return "";
}

function extractEntityIdFromHref(href: unknown): string {
  const text = cleanText(href);
  if (!text) return "";
  const match = text.match(/\/([^/?#]+)(?:[?#].*)?$/) ?? text.match(/local:\/\/[^/]+\/([^/?#]+)$/);
  return match?.[1] ?? "";
}

function mergeOrgRecords(primary: Record<string, unknown>, fallback: Record<string, unknown>): Record<string, unknown> {
  const out = { ...fallback, ...primary };
  for (const [key, value] of Object.entries(fallback)) {
    if (!cleanText(out[key])) out[key] = value;
  }
  return out;
}

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
  const organization = jsonRecord((rawDemand as { organization?: unknown })?.organization);
  const meta = jsonRecord(organization.meta);
  const organizationId = firstFilled(organization.id, extractEntityIdFromHref(meta.href));
  const organizationName = cleanText(organization.name);

  const where =
    organizationId || organizationName
      ? {
          OR: [
            ...(organizationId ? [{ id: organizationId }, { moyskladId: organizationId }] : []),
            ...(organizationName ? [{ name: organizationName }] : []),
          ],
        }
      : { isActive: true };

  const localOrganization = await prisma.localOrganization.findFirst({
    where,
    orderBy: [{ createdAt: "asc" }],
    select: {
      id: true,
      moyskladId: true,
      moyskladHref: true,
      name: true,
      raw: true,
    },
  });

  if (!localOrganization && Object.keys(organization).length === 0) return null;

  const localRaw = jsonRecord(localOrganization?.raw);
  const localRecord = localOrganization
    ? mergeOrgRecords(localRaw, {
        id: localOrganization.moyskladId ?? localOrganization.id,
        name: localOrganization.name,
        meta: {
          href: localOrganization.moyskladHref ?? `local://organization/${localOrganization.id}`,
          type: "organization",
          mediaType: "application/json",
        },
      })
    : {};

  return mergeOrgRecords(organization, localRecord);
}

export function sellerFromOrg(org: Record<string, unknown> | null): SellerRequisites {
  const fallback = envSeller();
  if (!org) {
    return fallback;
  }
  const raw = jsonRecord(org.raw);
  const company = jsonRecord(org.company);
  const rawCompany = jsonRecord(raw.company);
  return {
    director: firstFilled(company.director, rawCompany.director, pickDirector(org), pickDirector(raw), fallback.director),
    inn: firstFilled(org.inn, raw.inn, fallback.inn),
    ogrn: firstFilled(org.ogrn, org.ogrnip, raw.ogrn, raw.ogrnip, fallback.ogrn),
    legalAddress: firstFilled(org.legalAddress, org.actualAddress, raw.legalAddress, raw.actualAddress, fallback.legalAddress),
    phones: firstFilled(
      normalizeSellerPhonesForPrint(formatOrgPhones(org)),
      normalizeSellerPhonesForPrint(formatOrgPhones(raw)),
      fallback.phones
    ),
  };
}
