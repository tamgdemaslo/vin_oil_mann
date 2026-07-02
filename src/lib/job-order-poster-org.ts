import { prisma } from "@/lib/db";
import { normalizeSellerPhonesForPrint } from "@/lib/job-order-seller-phone";

type SellerRequisites = {
  director: string;
  inn: string;
  ogrn: string;
  legalAddress: string;
  phones: string;
};

const DEFAULT_SELLER: SellerRequisites = {
  director: "ИП Елисеенко Илья Сергеевич",
  inn: "392302838630",
  ogrn: "319392600035915",
  legalAddress: "238410, РОССИЯ, КАЛИНИНГРАДСКАЯ ОБЛ, ПРАВДИНСКИЙ Р-Н, ПГТ ЖЕЛЕЗНОДОРОЖНЫЙ, УЛ ДЕПОВСКАЯ, Д 1, КВ 7",
  phones: "8 (995) 054-58-59",
};

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function envSeller(): SellerRequisites {
  return {
    director: firstFilled(
      process.env.JOB_ORDER_SELLER_DIRECTOR,
      process.env.CLOSING_SELLER_SHORT_NAME,
      process.env.CLOSING_SELLER_LEGAL_NAME,
      process.env.CLOSING_SELLER_SIGNATORY_NAME,
      DEFAULT_SELLER.director
    ),
    inn: firstFilled(process.env.JOB_ORDER_SELLER_INN, process.env.CLOSING_SELLER_INN, DEFAULT_SELLER.inn),
    ogrn: firstFilled(
      process.env.JOB_ORDER_SELLER_OGRN,
      process.env.CLOSING_SELLER_OGRN,
      process.env.CLOSING_SELLER_OGRNIP,
      DEFAULT_SELLER.ogrn
    ),
    legalAddress: firstFilled(process.env.JOB_ORDER_SELLER_ADDRESS, process.env.CLOSING_SELLER_ADDRESS, DEFAULT_SELLER.legalAddress),
    phones: normalizeSellerPhonesForPrint(
      firstFilled(
        process.env.JOB_ORDER_SELLER_PHONES,
        process.env.CLOSING_SELLER_PHONE,
        process.env.CLOSING_SELLER_PHONES,
        process.env.POSTER_PHONE,
        process.env.POSTER_CONTACT_PHONE,
        DEFAULT_SELLER.phones
      )
    ),
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
    const n = (phone as { number?: string; phone?: string }).number ?? (phone as { phone?: string }).phone;
    if (n) return n;
  }
  const phones = org.phones;
  if (Array.isArray(phones)) {
    return phones
      .map((p) => {
        if (typeof p === "string") return p;
        if (p && typeof p === "object" && "number" in p) return String((p as { number: string }).number);
        if (p && typeof p === "object" && "phone" in p) return String((p as { phone: string }).phone);
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
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    select: {
      id: true,
      moyskladId: true,
      moyskladHref: true,
      name: true,
      fullLegalName: true,
      inn: true,
      kpp: true,
      ogrn: true,
      ogrnip: true,
      legalAddress: true,
      actualAddress: true,
      phone: true,
      signatoryName: true,
      raw: true,
    },
  });

  if (!localOrganization && Object.keys(organization).length === 0) return null;

  const localRaw = jsonRecord(localOrganization?.raw);
  const localRecord = localOrganization
    ? mergeOrgRecords(localRaw, {
        id: localOrganization.moyskladId ?? localOrganization.id,
        name: localOrganization.name,
        legalTitle: localOrganization.fullLegalName,
        inn: localOrganization.inn,
        kpp: localOrganization.kpp,
        ogrn: localOrganization.ogrn,
        ogrnip: localOrganization.ogrnip,
        legalAddress: localOrganization.legalAddress,
        actualAddress: localOrganization.actualAddress,
        phone: localOrganization.phone,
        director: localOrganization.signatoryName,
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
  const hasOrgRequisites = Boolean(
    firstFilled(
      org.inn,
      org.ogrn,
      org.ogrnip,
      org.legalAddress,
      org.actualAddress,
      raw.inn,
      raw.ogrn,
      raw.ogrnip,
      raw.legalAddress,
      raw.actualAddress
    )
  );
  return {
    director: firstFilled(company.director, rawCompany.director, hasOrgRequisites ? pickDirector(org) : "", hasOrgRequisites ? pickDirector(raw) : "", fallback.director),
    inn: firstFilled(org.inn, raw.inn, fallback.inn),
    ogrn: firstFilled(org.ogrnip, org.ogrn, raw.ogrnip, raw.ogrn, fallback.ogrn),
    legalAddress: firstFilled(
      org.legalAddress,
      org.actualAddress,
      raw.legalAddress,
      raw.actualAddress,
      jsonRecord(raw.legalAddressFull).addInfo,
      fallback.legalAddress
    ),
    phones: firstFilled(
      normalizeSellerPhonesForPrint(formatOrgPhones(org)),
      normalizeSellerPhonesForPrint(formatOrgPhones(raw)),
      fallback.phones
    ),
  };
}
