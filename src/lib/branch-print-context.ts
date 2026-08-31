import { prisma } from "@/lib/db";
import { formatPhoneForDisplay } from "@/lib/phone-normalize";

export type BranchPrintContext = {
  branchId: string;
  branchName: string;
  shortName: string;
  address: string;
  phone: string;
  email: string;
  telegram: string;
  legalEntity: {
    name: string;
    inn: string;
    ogrn: string;
  } | null;
  workingHours: string;
};

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function workingHoursFromCallbacks(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  return clean((value as Record<string, unknown>).workingHours);
}

export type BranchPrintContextRecord = {
  id: string;
  name: string;
  shortName: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  legalEntityName: string | null;
  inn: string | null;
  ogrn: string | null;
  communication: {
    primaryPhone: string;
    email: string | null;
    telegram: string | null;
    callbackSettingsJson: unknown;
  } | null;
  legalEntities: Array<{
    name: string;
    inn: string | null;
    ogrn: string | null;
    ogrnip: string | null;
  }>;
};

export function branchPrintContextFromRecord(branch: BranchPrintContextRecord): BranchPrintContext {
  const legal = branch.legalEntities[0];
  const legalName = clean(legal?.name) || clean(branch.legalEntityName);
  const legalInn = clean(legal?.inn) || clean(branch.inn);
  const legalOgrn = clean(legal?.ogrnip) || clean(legal?.ogrn) || clean(branch.ogrn);

  return {
    branchId: branch.id,
    branchName: branch.name,
    shortName: branch.shortName,
    address: clean(branch.address),
    phone: formatPhoneForDisplay(branch.communication?.primaryPhone || branch.phone),
    email: clean(branch.communication?.email) || clean(branch.email),
    telegram: clean(branch.communication?.telegram),
    legalEntity: legalName || legalInn || legalOgrn
      ? { name: legalName, inn: legalInn, ogrn: legalOgrn }
      : null,
    workingHours: workingHoursFromCallbacks(branch.communication?.callbackSettingsJson),
  };
}

/**
 * Единый источник филиальных контактов для печати.
 * primaryPhone каноничен; Branch.phone — только fallback для legacy-строк
 * того же филиала. Номер организации, ENV и активный филиал не используются.
 */
export async function resolveBranchPrintContext(branchId: string): Promise<BranchPrintContext | null> {
  const id = branchId.trim();
  if (!id) return null;
  const branch = await prisma.branch.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      shortName: true,
      address: true,
      phone: true,
      email: true,
      legalEntityName: true,
      inn: true,
      ogrn: true,
      communication: {
        select: {
          primaryPhone: true,
          email: true,
          telegram: true,
          callbackSettingsJson: true,
        },
      },
      legalEntities: {
        where: { isPrimary: true },
        select: { name: true, inn: true, ogrn: true, ogrnip: true },
        take: 1,
      },
    },
  });
  if (!branch) return null;

  return branchPrintContextFromRecord(branch);
}
