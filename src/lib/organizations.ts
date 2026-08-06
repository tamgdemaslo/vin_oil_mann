import { Prisma } from "@prisma/client";
import { getPublicUsers, type User } from "@/lib/auth";
import { logChange } from "@/lib/change-log";
import { prisma } from "@/lib/db";

export type OrganizationInput = {
  type?: string;
  shortName?: string;
  legalName?: string | null;
  entityType?: string;
  name?: string;
  fullLegalName?: string | null;
  inn?: string | null;
  kpp?: string | null;
  ogrn?: string | null;
  ogrnip?: string | null;
  legalAddress?: string | null;
  actualAddress?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  taxSystem?: string | null;
  vatMode?: string | null;
  vatEnabled?: boolean | string | null;
  defaultVatRate?: number | string | null;
  currency?: string | null;
  bankName?: string | null;
  bik?: string | null;
  settlementAccount?: string | null;
  checkingAccount?: string | null;
  correspondentAccount?: string | null;
  signatoryName?: string | null;
  signatoryPosition?: string | null;
  signatoryBasis?: string | null;
  signatoryAuthority?: string | null;
  shipmentNumberPrefix?: string | null;
  workOrderNumberPrefix?: string | null;
  shipmentPrefix?: string | null;
  workOrderPrefix?: string | null;
  actPrefix?: string | null;
  updPrefix?: string | null;
  isDefault?: boolean | string | null;
  isActive?: boolean | string | null;
};

const ORGANIZATION_INCLUDE = {
  _count: {
    select: {
      stores: true,
      members: true,
      demands: true,
      closingDocuments: true,
      cashExpenseOrders: true,
    },
  },
} satisfies Prisma.LocalOrganizationInclude;

type OrganizationWithCounts = Prisma.LocalOrganizationGetPayload<{ include: typeof ORGANIZATION_INCLUDE }>;

type OrganizationPermission =
  | "organizations.view"
  | "organizations.create"
  | "organizations.edit"
  | "organizations.archive"
  | "organizations.delete"
  | "organizations.set_default"
  | "organizations.manage";

const MANAGE_PERMISSIONS: OrganizationPermission[] = [
  "organizations.create",
  "organizations.edit",
  "organizations.archive",
  "organizations.delete",
  "organizations.set_default",
  "organizations.manage",
];

function normalizeLogin(value: string) {
  return value.trim().toLowerCase();
}

function envList(name: string) {
  return (process.env[name] ?? "")
    .split(",")
    .map((item) => normalizeLogin(item))
    .filter(Boolean);
}

function cleanText(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function boolFromInput(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (value == null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "да"].includes(normalized)) return true;
  if (["0", "false", "no", "нет"].includes(normalized)) return false;
  return fallback;
}

function permissionsFromJson(value: Prisma.JsonValue | null | undefined): Set<string> {
  if (!value) return new Set();
  if (Array.isArray(value)) return new Set(value.map(String));
  if (typeof value === "object") {
    return new Set(
      Object.entries(value)
        .filter(([, enabled]) => Boolean(enabled))
        .map(([permission]) => permission)
    );
  }
  return new Set();
}

function hasAnyPermission(permissions: Set<string>, required: OrganizationPermission[]) {
  return required.some((permission) => permissions.has(permission)) || permissions.has("organizations.manage");
}

export async function getOrganizationPermissionSet(user: User): Promise<Set<string>> {
  if (user.role === "owner") {
    return new Set<OrganizationPermission>([
      "organizations.view",
      "organizations.create",
      "organizations.edit",
      "organizations.archive",
      "organizations.delete",
      "organizations.set_default",
      "organizations.manage",
    ]);
  }

  const envManagers = envList("ORGANIZATIONS_MANAGERS");
  if (user.role === "admin" && (envManagers.includes("*") || envManagers.includes(normalizeLogin(user.login)))) {
    return new Set<OrganizationPermission>(["organizations.view", "organizations.manage"]);
  }

  const rows = await prisma.organizationMember.findMany({
    where: { userId: user.login },
    select: { permissionsJson: true },
  });
  const permissions = new Set<string>();
  for (const row of rows) {
    for (const permission of permissionsFromJson(row.permissionsJson)) permissions.add(permission);
  }
  if (permissions.size > 0) permissions.add("organizations.view");
  return permissions;
}

export async function canViewOrganizations(user: User) {
  const permissions = await getOrganizationPermissionSet(user);
  return permissions.has("organizations.view") || hasAnyPermission(permissions, MANAGE_PERMISSIONS);
}

export async function canManageOrganizations(user: User, permission: OrganizationPermission = "organizations.manage") {
  const permissions = await getOrganizationPermissionSet(user);
  return hasAnyPermission(permissions, [permission]);
}

function vatRateFromInput(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(String(value).replace(",", "."));
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

function normalizeEntityType(value: unknown) {
  const text = cleanText(value)?.toLowerCase() ?? "";
  if (["ip", "entrepreneur", "individual_entrepreneur", "индивидуальный предприниматель", "ип"].includes(text)) return "ip";
  if (["ooo", "llc", "limited_liability_company", "ооо"].includes(text)) return "ooo";
  return "legal_entity";
}

function titleCaseRu(value: string) {
  return value
    .toLocaleLowerCase("ru-RU")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toLocaleUpperCase("ru-RU")}${part.slice(1)}`)
    .join(" ");
}

function defaultIpLegalName(name: string) {
  const withoutPrefix = name.replace(/^ип\s+/i, "").trim();
  return `Индивидуальный предприниматель ${titleCaseRu(withoutPrefix || name)}`;
}

type CurrentOrganizationInput = Partial<Record<keyof OrganizationInput, unknown>>;

function valueByAliases(input: OrganizationInput, current: CurrentOrganizationInput | undefined, keys: Array<keyof OrganizationInput>) {
  for (const key of keys) {
    if (input[key] !== undefined) return input[key];
  }
  for (const key of keys) {
    if (current?.[key] !== undefined) return current[key];
  }
  return undefined;
}

function textField(input: OrganizationInput, current: CurrentOrganizationInput | undefined, key: keyof OrganizationInput) {
  return input[key] === undefined ? cleanText(current?.[key]) : cleanText(input[key]);
}

function boolField(input: OrganizationInput, current: CurrentOrganizationInput | undefined, key: "vatEnabled" | "isActive", fallback = false) {
  return input[key] === undefined ? boolFromInput(current?.[key], fallback) : boolFromInput(input[key], fallback);
}

function normalizeOrganizationInput(input: OrganizationInput, current?: CurrentOrganizationInput) {
  const entityType = normalizeEntityType(valueByAliases(input, current, ["entityType", "type"]));
  const name = cleanText(valueByAliases(input, current, ["name", "shortName"])) ?? "";
  const fullLegalName = cleanText(valueByAliases(input, current, ["fullLegalName", "legalName"])) ?? (entityType === "ip" && name ? defaultIpLegalName(name) : null);
  const isActive = boolField(input, current, "isActive", true);
  const vatMode = cleanText(input.vatMode ?? current?.vatMode)?.toLowerCase();
  const vatEnabled = vatMode ? !["without_vat", "no_vat", "без ндс", "none"].includes(vatMode) : boolField(input, current, "vatEnabled", false);

  return {
    entityType,
    name,
    fullLegalName,
    inn: textField(input, current, "inn"),
    kpp: entityType === "ip" ? null : textField(input, current, "kpp"),
    ogrn: entityType === "ip" ? null : textField(input, current, "ogrn"),
    ogrnip: textField(input, current, "ogrnip"),
    legalAddress: textField(input, current, "legalAddress"),
    actualAddress: textField(input, current, "actualAddress"),
    phone: textField(input, current, "phone"),
    email: textField(input, current, "email"),
    website: textField(input, current, "website"),
    taxSystem: textField(input, current, "taxSystem"),
    vatEnabled,
    defaultVatRate: input.defaultVatRate === undefined ? vatRateFromInput(current?.defaultVatRate) : vatRateFromInput(input.defaultVatRate),
    currency: textField(input, current, "currency") ?? "RUB",
    bankName: textField(input, current, "bankName"),
    bik: textField(input, current, "bik"),
    checkingAccount: cleanText(valueByAliases(input, current, ["checkingAccount", "settlementAccount"])),
    correspondentAccount: textField(input, current, "correspondentAccount"),
    signatoryName: textField(input, current, "signatoryName"),
    signatoryPosition: textField(input, current, "signatoryPosition"),
    signatoryAuthority: cleanText(valueByAliases(input, current, ["signatoryAuthority", "signatoryBasis"])),
    shipmentPrefix: cleanText(valueByAliases(input, current, ["shipmentPrefix", "shipmentNumberPrefix"])),
    workOrderPrefix: cleanText(valueByAliases(input, current, ["workOrderPrefix", "workOrderNumberPrefix"])),
    actPrefix: textField(input, current, "actPrefix"),
    updPrefix: textField(input, current, "updPrefix"),
    isActive,
  };
}

function validateOrganizationData(data: ReturnType<typeof normalizeOrganizationInput>) {
  if (!data.name) return "Укажите краткое название организации";
  if (data.entityType === "ip" && data.kpp) return "Для ИП КПП не заполняется";
  const digits = (value: string | null) => (value ?? "").replace(/\D/g, "");
  const inn = digits(data.inn);
  const kpp = digits(data.kpp);
  const ogrn = digits(data.ogrn);
  const ogrnip = digits(data.ogrnip);
  const bik = digits(data.bik);
  const checkingAccount = digits(data.checkingAccount);
  const correspondentAccount = digits(data.correspondentAccount);
  if (inn && ![10, 12].includes(inn.length)) return "ИНН должен содержать 10 или 12 цифр";
  if (data.entityType === "ip" && inn && inn.length !== 12) return "Для ИП ИНН должен содержать 12 цифр";
  if (kpp && kpp.length !== 9) return "КПП должен содержать 9 цифр";
  if (ogrn && ogrn.length !== 13) return "ОГРН должен содержать 13 цифр";
  if (ogrnip && ogrnip.length !== 15) return "ОГРНИП должен содержать 15 цифр";
  if (bik && bik.length !== 9) return "БИК должен содержать 9 цифр";
  if (checkingAccount && checkingAccount.length !== 20) return "Расчётный счёт должен содержать 20 цифр";
  if (correspondentAccount && correspondentAccount.length !== 20) return "Корреспондентский счёт должен содержать 20 цифр";
  return null;
}

async function linkedCounts(id: string) {
  const demandRefs = await prisma.localDemand.findMany({
    where: { organizationId: id },
    select: { id: true },
  });
  const demandIds = demandRefs.map((demand) => demand.id);
  const demandExternalIds = demandIds;
  const [
    stores,
    members,
    demands,
    closingDocuments,
    cashExpenseOrders,
    inventoryDocuments,
    stockProducts,
    diagnosticMaps,
    diagnostics,
    crmDeals,
  ] = await Promise.all([
    prisma.localStore.count({ where: { organizationId: id } }),
    prisma.organizationMember.count({ where: { organizationId: id } }),
    prisma.localDemand.count({ where: { organizationId: id } }),
    prisma.closingDocument.count({ where: { organizationId: id } }),
    prisma.cashExpenseOrder.count({ where: { organizationId: id } }),
    prisma.localInventoryDocument.count({ where: { store: { organizationId: id } } }),
    prisma.localProduct.count({ where: { stockBalances: { some: { store: { organizationId: id } } } } }),
    demandIds.length > 0 ? prisma.diagnosticMapSession.count({ where: { demandId: { in: demandIds } } }) : 0,
    demandExternalIds.length > 0
      ? prisma.diagnostic.count({
          where: {
            OR: [
              { shipmentDraftId: { in: demandIds } },
              { shipmentDraftId: { in: demandExternalIds } },
            ],
          },
        })
      : 0,
    demandExternalIds.length > 0 ? prisma.crmDeal.count({ where: { shipmentId: { in: demandExternalIds } } }) : 0,
  ]);
  return { stores, members, demands, closingDocuments, cashExpenseOrders, inventoryDocuments, stockProducts, diagnosticMaps, diagnostics, crmDeals };
}

function linkedTotal(counts: object) {
  return Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0);
}

function auditOrganization(row: Partial<OrganizationWithCounts> | null | undefined) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    entityType: row.entityType,
    fullLegalName: row.fullLegalName,
    inn: row.inn,
    kpp: row.kpp,
    ogrn: row.ogrn,
    ogrnip: row.ogrnip,
    legalAddress: row.legalAddress,
    actualAddress: row.actualAddress,
    phone: row.phone,
    email: row.email,
    website: row.website,
    taxSystem: row.taxSystem,
    vatEnabled: row.vatEnabled,
    defaultVatRate: row.defaultVatRate,
    currency: row.currency,
    bankName: row.bankName,
    bik: row.bik,
    checkingAccount: row.checkingAccount,
    correspondentAccount: row.correspondentAccount,
    signatoryName: row.signatoryName,
    signatoryPosition: row.signatoryPosition,
    signatoryAuthority: row.signatoryAuthority,
    shipmentPrefix: row.shipmentPrefix,
    workOrderPrefix: row.workOrderPrefix,
    actPrefix: row.actPrefix,
    updPrefix: row.updPrefix,
    isDefault: row.isDefault,
    isActive: row.isActive,
    archivedAt: row.archivedAt instanceof Date ? row.archivedAt.toISOString() : row.archivedAt ?? null,
  };
}

async function auditOrganizationChange(params: {
  id: string;
  action: "create" | "update" | "delete";
  oldValue?: unknown;
  newValue?: unknown;
  performedByLogin?: string;
}) {
  if (!params.performedByLogin) return;
  await logChange({
    entityType: "organization",
    entityId: params.id,
    action: params.action,
    oldValue: params.oldValue,
    newValue: params.newValue,
    performedByLogin: params.performedByLogin,
  });
}

export async function checkOrganizationDeletion(id: string) {
  const organization = await prisma.localOrganization.findUnique({ where: { id } });
  if (!organization) return { ok: false as const, error: "Организация не найдена", notFound: true };
  const [counts, unfinished] = await Promise.all([linkedCounts(id), unfinishedCounts(id)]);
  const used = linkedTotal(counts) > 0;
  return {
    ok: true as const,
    organizationId: id,
    canDelete: !used,
    canArchive: used && organization.isActive && !organization.isDefault,
    linkedCounts: counts,
    unfinished,
    blockers: [
      organization.isDefault ? "Организация является основной" : "",
      linkedTotal(unfinished) > 0 ? "Есть незавершённые документы" : "",
    ].filter(Boolean),
  };
}

async function unfinishedCounts(id: string) {
  const [draftDemands, draftCashOrders, draftInventoryDocuments] = await Promise.all([
    prisma.localDemand.count({ where: { organizationId: id, applicable: false } }),
    prisma.cashExpenseOrder.count({ where: { organizationId: id, status: { in: ["draft"] } } }),
    prisma.localInventoryDocument.count({ where: { store: { organizationId: id }, applicable: false } }),
  ]);
  return { draftDemands, draftCashOrders, draftInventoryDocuments };
}

export async function ensureDefaultOrganization() {
  const active = await prisma.localOrganization.findMany({
    where: { isActive: true },
    select: { id: true, isDefault: true },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
  if (active.length === 0 || active.some((organization) => organization.isDefault)) return;
  if (active.length === 1) {
    await prisma.localOrganization.update({ where: { id: active[0].id }, data: { isDefault: true } });
  }
}

export async function setDefaultOrganization(id: string, performedByLogin?: string) {
  const organization = await prisma.localOrganization.findUnique({ where: { id } });
  if (!organization) return { ok: false as const, error: "Организация не найдена", notFound: true };
  if (!organization.isActive) return { ok: false as const, error: "Архивную организацию нельзя сделать основной" };

  const previousDefault = await prisma.localOrganization.findFirst({ where: { isDefault: true, isActive: true } });
  const updated = await prisma.$transaction(async (tx) => {
    await tx.localOrganization.updateMany({ data: { isDefault: false } });
    return tx.localOrganization.update({
      where: { id },
      data: { isDefault: true },
      include: ORGANIZATION_INCLUDE,
    });
  });

  await auditOrganizationChange({
    id,
    action: "update",
    oldValue: { previousDefaultOrganizationId: previousDefault?.id ?? null },
    newValue: { defaultOrganizationId: id },
    performedByLogin,
  });
  return { ok: true as const, organization: await mapOrganization(updated) };
}

export async function listOrganizations() {
  await ensureDefaultOrganization();
  const [organizations, employees] = await Promise.all([
    prisma.localOrganization.findMany({
      include: ORGANIZATION_INCLUDE,
      orderBy: [{ isDefault: "desc" }, { isActive: "desc" }, { name: "asc" }],
    }),
    getPublicUsers(),
  ]);

  return {
    organizations: organizations.map((organization) => mapOrganizationSync(organization, employees.length)),
  };
}

export async function getOrganization(id: string) {
  const [organization, employees] = await Promise.all([
    prisma.localOrganization.findUnique({ where: { id }, include: ORGANIZATION_INCLUDE }),
    getPublicUsers(),
  ]);
  if (!organization) return null;
  return mapOrganizationSync(organization, employees.length);
}

async function mapOrganization(organization: OrganizationWithCounts) {
  const employees = await getPublicUsers();
  return mapOrganizationSync(organization, employees.length);
}

function mapOrganizationSync(organization: OrganizationWithCounts, employeeCount: number) {
  return {
    id: organization.id,
    type: organization.entityType,
    shortName: organization.name,
    legalName: organization.fullLegalName ?? "",
    name: organization.name,
    entityType: organization.entityType,
    fullLegalName: organization.fullLegalName ?? "",
    inn: organization.inn ?? "",
    kpp: organization.kpp ?? "",
    ogrn: organization.ogrn ?? "",
    ogrnip: organization.ogrnip ?? "",
    legalAddress: organization.legalAddress ?? "",
    actualAddress: organization.actualAddress ?? "",
    phone: organization.phone ?? "",
    email: organization.email ?? "",
    website: organization.website ?? "",
    taxSystem: organization.taxSystem ?? "",
    vatEnabled: organization.vatEnabled,
    vatMode: organization.vatEnabled ? "vat" : "without_vat",
    defaultVatRate: organization.defaultVatRate,
    currency: organization.currency,
    bankName: organization.bankName ?? "",
    bik: organization.bik ?? "",
    settlementAccount: organization.checkingAccount ?? "",
    checkingAccount: organization.checkingAccount ?? "",
    correspondentAccount: organization.correspondentAccount ?? "",
    signatoryName: organization.signatoryName ?? "",
    signatoryPosition: organization.signatoryPosition ?? "",
    signatoryBasis: organization.signatoryAuthority ?? "",
    signatoryAuthority: organization.signatoryAuthority ?? "",
    shipmentNumberPrefix: organization.shipmentPrefix ?? "",
    workOrderNumberPrefix: organization.workOrderPrefix ?? "",
    shipmentPrefix: organization.shipmentPrefix ?? "",
    workOrderPrefix: organization.workOrderPrefix ?? "",
    actPrefix: organization.actPrefix ?? "",
    updPrefix: organization.updPrefix ?? "",
    isDefault: organization.isDefault,
    isActive: organization.isActive,
    status: organization.isActive ? "active" : "archive",
    storesCount: organization._count.stores,
    employeesCount: organization._count.members || (organization.isDefault ? employeeCount : 0),
    demandsCount: organization._count.demands,
    closingDocumentsCount: organization._count.closingDocuments,
    cashExpenseOrdersCount: organization._count.cashExpenseOrders,
    createdAt: organization.createdAt.toISOString(),
    updatedAt: organization.updatedAt.toISOString(),
    archivedAt: organization.archivedAt?.toISOString() ?? null,
  };
}

export async function createOrganization(input: OrganizationInput, performedByLogin?: string) {
  const data = normalizeOrganizationInput(input);
  const error = validateOrganizationData(data);
  if (error) return { ok: false as const, error };
  const makeDefault = boolFromInput(input.isDefault, false);

  const created = await prisma.$transaction(async (tx) => {
    const activeCount = await tx.localOrganization.count({ where: { isActive: true } });
    if (makeDefault || activeCount === 0) await tx.localOrganization.updateMany({ data: { isDefault: false } });
    return tx.localOrganization.create({
      data: {
        ...data,
        isDefault: data.isActive && (makeDefault || activeCount === 0),
      },
      include: ORGANIZATION_INCLUDE,
    });
  });

  await auditOrganizationChange({
    id: created.id,
    action: "create",
    newValue: auditOrganization(created),
    performedByLogin,
  });
  return { ok: true as const, organization: await mapOrganization(created) };
}

export async function updateOrganization(id: string, input: OrganizationInput, performedByLogin?: string) {
  const current = await prisma.localOrganization.findUnique({ where: { id } });
  if (!current) return { ok: false as const, error: "Организация не найдена", notFound: true };
  const data = { ...normalizeOrganizationInput(input, current), isActive: current.isActive };
  const error = validateOrganizationData(data);
  if (error) return { ok: false as const, error };
  const makeDefault = boolFromInput(input.isDefault, current.isDefault);
  if (makeDefault && !data.isActive) return { ok: false as const, error: "Архивную организацию нельзя сделать основной" };

  const updated = await prisma.$transaction(async (tx) => {
    if (makeDefault) await tx.localOrganization.updateMany({ data: { isDefault: false } });
    const organization = await tx.localOrganization.update({
      where: { id },
      data: {
        ...data,
        isDefault: data.isActive ? makeDefault : false,
      },
      include: ORGANIZATION_INCLUDE,
    });
    await tx.branch.updateMany({
      where: { legacyOrganizationId: id },
      data: { name: data.name, shortName: data.name },
    });
    return organization;
  });

  await auditOrganizationChange({
    id,
    action: "update",
    oldValue: auditOrganization(current),
    newValue: auditOrganization(updated),
    performedByLogin,
  });
  return { ok: true as const, organization: await mapOrganization(updated) };
}

export async function archiveOrganization(id: string, performedByLogin?: string) {
  const organization = await prisma.localOrganization.findUnique({ where: { id } });
  if (!organization) return { ok: false as const, error: "Организация не найдена", notFound: true };
  if (!organization.isActive) return { ok: true as const, organization: await getOrganization(id) };
  if (organization.isDefault) return { ok: false as const, error: "Основную организацию нельзя архивировать. Сначала назначьте другую основной." };

  const openCashShift = await prisma.cashShift.findFirst({ where: { status: "open" }, select: { id: true } });
  if (openCashShift) return { ok: false as const, error: "Нельзя архивировать организацию при открытой кассовой смене" };

  const unfinished = await unfinishedCounts(id);
  if (linkedTotal(unfinished) > 0) {
    return {
      ok: false as const,
      error: "У организации есть незавершённые документы",
      unfinished,
    };
  }

  const updated = await prisma.localOrganization.update({
    where: { id },
    data: { isActive: false, isDefault: false, archivedAt: new Date() },
    include: ORGANIZATION_INCLUDE,
  });

  await auditOrganizationChange({
    id,
    action: "update",
    oldValue: auditOrganization(organization),
    newValue: auditOrganization(updated),
    performedByLogin,
  });
  return { ok: true as const, organization: await mapOrganization(updated) };
}

export async function restoreOrganization(id: string, performedByLogin?: string) {
  const organization = await prisma.localOrganization.findUnique({ where: { id } });
  if (!organization) return { ok: false as const, error: "Организация не найдена", notFound: true };

  const updated = await prisma.$transaction(async (tx) => {
    const activeCount = await tx.localOrganization.count({ where: { isActive: true } });
    if (activeCount === 0) await tx.localOrganization.updateMany({ data: { isDefault: false } });
    return tx.localOrganization.update({
      where: { id },
      data: { isActive: true, isDefault: activeCount === 0, archivedAt: null },
      include: ORGANIZATION_INCLUDE,
    });
  });

  await auditOrganizationChange({
    id,
    action: "update",
    oldValue: auditOrganization(organization),
    newValue: auditOrganization(updated),
    performedByLogin,
  });
  return { ok: true as const, organization: await mapOrganization(updated) };
}

export async function deleteOrganization(id: string, performedByLogin?: string) {
  const organization = await prisma.localOrganization.findUnique({ where: { id } });
  if (!organization) return { ok: false as const, error: "Организация не найдена", notFound: true };

  const counts = await linkedCounts(id);
  if (linkedTotal(counts) > 0) {
    return {
      ok: false as const,
      error: "Организация уже используется. Полное удаление запрещено, перенесите её в архив.",
      linkedCounts: counts,
      canArchive: organization.isActive && !organization.isDefault,
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.localOrganization.delete({ where: { id } });
    const hasDefault = await tx.localOrganization.findFirst({ where: { isDefault: true, isActive: true }, select: { id: true } });
    if (!hasDefault) {
      const fallback = await tx.localOrganization.findFirst({
        where: { isActive: true },
        select: { id: true },
        orderBy: [{ createdAt: "asc" }],
      });
      if (fallback) await tx.localOrganization.update({ where: { id: fallback.id }, data: { isDefault: true } });
    }
  });

  await auditOrganizationChange({
    id,
    action: "delete",
    oldValue: auditOrganization(organization),
    performedByLogin,
  });
  return { ok: true as const };
}
