import { Prisma, type LocalCounterparty } from "@prisma/client";
import { prisma } from "@/lib/db";

export const ANONYMOUS_RETAIL_COUNTERPARTY_NAME = "Розничный покупатель";
export const ANONYMOUS_RETAIL_COUNTERPARTY_SUBTITLE = "Без данных клиента";
export const ANONYMOUS_RETAIL_SYSTEM_ROLE = "ANONYMOUS_RETAIL";

type CounterpartyClient = Pick<Prisma.TransactionClient, "localCounterparty">;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function anonymousRetailCounterpartyId(branchId: string): string {
  return `system:anonymous-retail:${branchId}`;
}

export function isAnonymousRetailCounterparty(
  counterparty: Pick<LocalCounterparty, "id" | "branchId" | "raw"> | null | undefined,
): boolean {
  if (!counterparty) return false;
  const ecoPlatform = record(record(counterparty.raw).ecoPlatform);
  return (
    counterparty.id === anonymousRetailCounterpartyId(counterparty.branchId) &&
    ecoPlatform.isSystem === true &&
    ecoPlatform.systemRole === ANONYMOUS_RETAIL_SYSTEM_ROLE
  );
}

export function isAnonymousRetailCounterpartyId(id: string | null | undefined, branchId: string): boolean {
  return Boolean(id && id === anonymousRetailCounterpartyId(branchId));
}

export function anonymousRetailCounterpartyExclusion(branchId: string): Prisma.LocalCounterpartyWhereInput {
  return { id: { not: anonymousRetailCounterpartyId(branchId) } };
}

export function anonymousRetailCounterpartyApiModel(counterparty: LocalCounterparty) {
  return {
    id: counterparty.id,
    name: counterparty.displayName || counterparty.name,
    phone: null,
    normalizedPhone: null,
    companyType: "individual",
    counterpartyTypeName: "Физическое лицо",
    legalTitle: null,
    isSystem: true,
    isAnonymousRetail: true,
    subtitle: ANONYMOUS_RETAIL_COUNTERPARTY_SUBTITLE,
    meta: {
      href: `local://counterparty/${counterparty.id}`,
      type: "counterparty",
      mediaType: "application/json",
    },
  };
}

export async function ensureAnonymousRetailCounterparty(
  branchId: string,
  client: CounterpartyClient = prisma,
): Promise<LocalCounterparty> {
  const cleanBranchId = branchId.trim();
  if (!cleanBranchId) throw new Error("Не указан филиал для системного контрагента");

  const id = anonymousRetailCounterpartyId(cleanBranchId);
  const marker = {
    source: "system",
    ecoPlatform: {
      isSystem: true,
      systemRole: ANONYMOUS_RETAIL_SYSTEM_ROLE,
      version: 1,
    },
  } satisfies Prisma.InputJsonObject;

  return client.localCounterparty.upsert({
    where: { id },
    update: {
      name: ANONYMOUS_RETAIL_COUNTERPARTY_NAME,
      displayName: ANONYMOUS_RETAIL_COUNTERPARTY_NAME,
      category: "INDIVIDUAL",
      legalForm: null,
      fullName: null,
      actualAddress: null,
      contactPerson: null,
      contactPhone: null,
      bankDetailsJson: Prisma.JsonNull,
      status: "ACTIVE",
      phone: null,
      email: null,
      normalizedPhone: null,
      phonesRaw: [],
      companyType: "individual",
      counterpartyTypeName: "Физическое лицо",
      legalTitle: null,
      legalLastName: null,
      legalFirstName: null,
      legalMiddleName: null,
      legalAddress: null,
      inn: null,
      kpp: null,
      okpo: null,
      fax: null,
      bik: null,
      bankName: null,
      bankLocation: null,
      correspondentAccount: null,
      checkingAccount: null,
      ogrn: null,
      ogrnip: null,
      certificateNumber: null,
      certificateDate: null,
      searchText: "",
      archived: false,
      raw: marker,
      syncedAt: new Date(),
    },
    create: {
      id,
      branchId: cleanBranchId,
      name: ANONYMOUS_RETAIL_COUNTERPARTY_NAME,
      displayName: ANONYMOUS_RETAIL_COUNTERPARTY_NAME,
      category: "INDIVIDUAL",
      status: "ACTIVE",
      companyType: "individual",
      counterpartyTypeName: "Физическое лицо",
      phonesRaw: [],
      searchText: "",
      archived: false,
      raw: marker,
      syncedAt: new Date(),
    },
  });
}

export async function ensureAnonymousRetailCounterpartiesForExistingBranches(): Promise<number> {
  const branches = await prisma.branch.findMany({ select: { id: true }, orderBy: { createdAt: "asc" } });
  for (const branch of branches) await ensureAnonymousRetailCounterparty(branch.id);
  return branches.length;
}
