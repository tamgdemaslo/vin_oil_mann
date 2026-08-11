import { Prisma, type LocalCounterparty } from "@prisma/client";
import type { User } from "@/lib/auth";
import { addExpense, getCurrentShift } from "@/lib/cashbox";
import { parseServiceDateTime, toServiceDateInput } from "@/lib/date-time";
import { prisma } from "@/lib/db";
import { getRequestTenant, getScopedBranchId } from "@/lib/request-tenant-store";
import { buildCatalogSearchText } from "@/lib/catalog-search";
import { mergeProductCrossReferences } from "@/lib/product-cross-references";
import { invalidateLocalInventoryFinanceCache } from "@/lib/local-inventory-finance";
import { normalizePhoneKey } from "@/lib/phone-normalize";
import {
  DEFAULT_BULK_OIL_MARKING_SETTINGS,
  DEFAULT_MARKING_SETTINGS,
  deriveProductMarkingStatus,
  isLiterSaleUnit,
  normalizeProductMarkingMode,
  normalizeProductMarkingSettings,
  productHasMarkingProblem,
  productMarkingDefaultForGroup,
  type ProductMarkingMode,
  type ProductMarkingSettings,
  type ProductMarkingStatus,
} from "@/lib/product-marking";
import { assertNoActiveInventoryLocks } from "@/lib/warehouse-inventory";

export type LocalStockDocumentType = "receipt" | "writeoff";
type LocalAdjustmentType = "technical" | "expense";
type LocalReceiptStatus = "draft" | "posted" | "cancelled" | "needs_review" | "blocked";
type ReceiptDangerAction = "unpost" | "cancel";

const TECHNICAL_ADJUSTMENT_REASONS = new Set([
  "Ошибка начальных остатков",
  "Ошибка импорта",
  "Ошибка миграции",
  "Дублирующий складской документ",
  "Некорректное ручное проведение",
  "Расхождение после инвентаризации",
  "Ошибка единицы измерения",
  "Ошибка старой базы",
  "Другое техническое исправление",
]);

const EXPENSE_WRITE_OFF_REASONS = new Set([
  "Порча",
  "Истёк срок хранения",
  "Утрата",
  "Кража",
  "Использовано для внутренних нужд",
  "Передано бесплатно",
  "Гарантийная замена",
  "Повреждено при работе",
  "Другое фактическое списание",
]);

type ProductInput = {
  name?: string;
  article?: string;
  code?: string;
  externalCode?: string;
  groupPath?: string;
  uomName?: string;
  entityType?: string;
  salePrice?: number;
  buyPrice?: number | null;
  currencyName?: string;
  minimumBalance?: number | string | null;
  barcodeEan13?: string;
  barcodeEan8?: string;
  barcodeCode128?: string;
  description?: string;
  minPrice?: number | string | null;
  minPriceCurrencyName?: string;
  countryName?: string;
  vatLabel?: string;
  supplierCounterpartyId?: string | null;
  /** Legacy import-only text. Product forms must use supplierCounterpartyId. */
  legacySupplierName?: string | null;
  weight?: number | string | null;
  volume?: number | string | null;
  modificationCode?: string;
  tnvedCode?: string;
  sae?: string;
  oem?: string;
  acea?: string;
  apiSpec?: string;
  packageVolume?: string;
  avito?: boolean | string | null;
  brand?: string;
  atf?: string;
  ilsac?: string;
  aceaExtra?: string;
  oemAtf?: string;
  mannName?: string;
  rosskoPartNumber?: string;
  rosskoBrand?: string;
  rosskoMin?: string;
  supplierAttribute?: string;
  oemParts?: string;
  cell?: string;
  mannCharacteristicName?: string;
  markingEnabled?: boolean | string | null;
  markingMode?: string | null;
  markingSettings?: Partial<ProductMarkingSettings> | null;
  markingConfiguredManually?: boolean | string | null;
  archived?: boolean;
};

const productWithStockInclude = {
  stockBalances: { include: { store: true }, orderBy: { store: { name: "asc" as const } } },
  supplierCounterparty: {
    select: { id: true, name: true, displayName: true, inn: true, legalForm: true, archived: true, status: true },
  },
  photos: {
    select: {
      id: true,
      fileName: true,
      contentType: true,
      sizeBytes: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" as const },
  },
} satisfies Prisma.LocalProductInclude;
const productListIndexSelect = {
  id: true,
  name: true,
  article: true,
  code: true,
  externalCode: true,
  groupPath: true,
  uomName: true,
  entityType: true,
  salePriceCents: true,
  buyPriceCents: true,
  barcodeEan13: true,
  barcodeEan8: true,
  barcodeCode128: true,
  description: true,
  legacySupplierName: true,
  supplierCounterparty: {
    select: { id: true, name: true, displayName: true, inn: true, legalForm: true, archived: true, status: true },
  },
  sae: true,
  oem: true,
  acea: true,
  apiSpec: true,
  packageVolume: true,
  brand: true,
  atf: true,
  ilsac: true,
  aceaExtra: true,
  oemAtf: true,
  mannName: true,
  rosskoPartNumber: true,
  rosskoBrand: true,
  rosskoMin: true,
  supplierAttribute: true,
  oemParts: true,
  cell: true,
  mannCharacteristicName: true,
  markingEnabled: true,
  markingMode: true,
  markingStatus: true,
  markingSettings: true,
  markingConfiguredManually: true,
  markingConfiguredAt: true,
  markingConfiguredByLogin: true,
  searchText: true,
  archived: true,
  updatedAt: true,
} satisfies Prisma.LocalProductSelect;
const restockProductInclude = {
  stockBalances: { include: { store: true }, orderBy: { store: { name: "asc" as const } } },
} satisfies Prisma.LocalProductInclude;

type CounterpartyInput = {
  category?: string;
  legalForm?: string | null;
  allowDuplicate?: boolean;
  name?: string;
  fullName?: string | null;
  phone?: string;
  additionalPhone?: string;
  email?: string;
  companyType?: string;
  counterpartyTypeName?: string;
  legalTitle?: string;
  legalLastName?: string;
  legalFirstName?: string;
  legalMiddleName?: string;
  legalAddress?: string;
  actualAddress?: string | null;
  contactPerson?: string | null;
  contactPhone?: string | null;
  bankDetailsJson?: Record<string, unknown> | null;
  inn?: string;
  kpp?: string;
  okpo?: string;
  fax?: string;
  bik?: string;
  bankName?: string;
  bankLocation?: string;
  correspondentAccount?: string;
  checkingAccount?: string;
  ogrn?: string;
  ogrnip?: string;
  certificateNumber?: string;
  certificateDate?: string | null;
  comment?: string;
  vehiclePlate?: string;
  vehicleVin?: string;
  vehicleModel?: string;
  vehicleYear?: string;
  archived?: boolean;
};

type StockDocumentInput = {
  type?: string;
  storeId?: string;
  counterpartyId?: string | null;
  documentDate?: string;
  moment?: string;
  description?: string;
  adjustmentType?: string;
  adjustmentMethod?: string;
  adjustmentReason?: string;
  applicable?: boolean;
  positions?: {
    id?: string;
    productId?: string;
    quantity?: number;
    price?: number;
    salePrice?: number;
    slotName?: string;
    makeDefaultCell?: boolean;
  }[];
  invoice?: {
    create?: boolean;
    number?: string;
    invoiceDate?: string;
    dueDate?: string;
    status?: string;
  } | null;
};

export type StockDocumentSourceMetadata = {
  source: string;
  externalCode: string;
  raw: Record<string, unknown>;
  positions: Array<{
    source: string;
    externalCode: string;
    raw: Record<string, unknown>;
  }>;
};

type StockDocumentCreateOptions = {
  transaction?: Prisma.TransactionClient;
  sourceMetadata?: StockDocumentSourceMetadata;
};

type SupplierInvoiceInput = {
  documentId?: string;
  number?: string;
  invoiceDate?: string;
  dueDate?: string;
  status?: string;
};

type SupplierInvoicePaymentInput = {
  amount?: number | string;
  paymentDate?: string;
  paymentType?: string;
  comment?: string;
  attachmentUrl?: string;
  allowOverpay?: boolean;
};

type ActingUser = {
  login?: string;
  name?: string | null;
  role?: string;
};

type ProductWithStock = Prisma.LocalProductGetPayload<{ include: typeof productWithStockInclude }>;
type ProductListIndexProduct = Prisma.LocalProductGetPayload<{ select: typeof productListIndexSelect }>;
type RestockProductWithStock = Prisma.LocalProductGetPayload<{ include: typeof restockProductInclude }>;
export const supplierInvoiceInclude = {
  document: {
    include: {
      store: true,
      counterparty: true,
      positions: { orderBy: { id: "asc" as const } },
    },
  },
  payments: {
    include: {
      cashExpenseOrder: { select: { id: true, number: true, status: true } },
    },
    orderBy: [{ paymentDate: "desc" as const }, { createdAt: "desc" as const }],
  },
  tbankPayments: {
    orderBy: [{ createdAt: "desc" as const }],
  },
} satisfies Prisma.LocalSupplierInvoiceInclude;
const stockDocumentActionInclude = {
  store: true,
  counterparty: true,
  positions: {
    include: { product: true },
    orderBy: { id: "asc" as const },
  },
  supplierInvoice: true,
} satisfies Prisma.LocalInventoryDocumentInclude;
export type SupplierInvoiceWithDocument = Prisma.LocalSupplierInvoiceGetPayload<{
  include: typeof supplierInvoiceInclude;
}>;
type StockDocumentForAction = Prisma.LocalInventoryDocumentGetPayload<{
  include: typeof stockDocumentActionInclude;
}>;
type CounterpartyRow = LocalCounterparty;

function toJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value == null) return Prisma.JsonNull;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function jsonRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function stringFromRecord(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value.trim() : "";
}

function markingEnabledFromInput(value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return booleanFromInput(value) ?? false;
}

export function productPayloadHasMarkingSettings(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  return "markingEnabled" in body || "markingMode" in body || "markingSettings" in body || "markingConfiguredManually" in body;
}

export function canManageWarehouseMarking(user?: ActingUser & { role?: string }): boolean {
  return user?.role === "owner" || user?.role === "admin";
}

function normalizedMarkingSettingsForMode(input: {
  mode: ProductMarkingMode;
  current?: unknown;
  next?: unknown;
}): ProductMarkingSettings | null {
  if (input.mode !== "BULK_OIL_FROM_MARKED_BARREL") return null;
  const base = {
    ...DEFAULT_BULK_OIL_MARKING_SETTINGS,
    ...normalizeProductMarkingSettings(input.current),
  };
  const next = input.next === undefined ? {} : normalizeProductMarkingSettings(input.next);
  return { ...base, ...next };
}

function normalizeProductMarkingData(
  body: ProductInput,
  current?: {
    markingEnabled: boolean;
    markingMode: string;
    markingStatus: string;
    markingSettings: unknown;
  },
  nextUomName?: string | null,
  nextGroupPath?: string | null
): { ok: true; data: {
  markingEnabled: boolean;
  markingMode: ProductMarkingMode;
  markingStatus: ProductMarkingStatus;
  markingSettings: ProductMarkingSettings | null;
} } | { ok: false; error: string } {
  const currentMode = normalizeProductMarkingMode(current?.markingMode);
  const hasExplicitMarking = productPayloadHasMarkingSettings(body);
  const groupDefault = productMarkingDefaultForGroup(nextGroupPath);
  let defaultEnabled = current?.markingEnabled ?? false;
  let defaultMode = currentMode;

  if (!current && !hasExplicitMarking) {
    if (groupDefault === "PACKAGED") {
      defaultEnabled = true;
      defaultMode = "PACKAGED_MARKED_GOOD";
    }
    if (groupDefault === "BULK_OIL") {
      defaultEnabled = true;
      defaultMode = "BULK_OIL_FROM_MARKED_BARREL";
    }
  }

  const markingEnabled = markingEnabledFromInput(body.markingEnabled, defaultEnabled);
  let markingMode = body.markingMode === undefined ? defaultMode : normalizeProductMarkingMode(body.markingMode);

  if (!markingEnabled) markingMode = "NOT_MARKED";
  if (markingEnabled && markingMode === "NOT_MARKED") markingMode = "REQUIRES_CHECK";

  if (
    markingEnabled &&
    markingMode === "PACKAGED_MARKED_GOOD" &&
    (groupDefault === "BULK_OIL" || isLiterSaleUnit(nextUomName))
  ) {
    return {
      ok: false,
      error:
        "Товар продаётся как мерный или находится в группе разлива, но маркировка настроена как обычная упаковка. " +
        "Есть риск полного вывода кода из оборота.",
    };
  }

  const markingSettings =
    markingEnabled && markingMode === "BULK_OIL_FROM_MARKED_BARREL"
      ? normalizedMarkingSettingsForMode({
          mode: markingMode,
          current: current?.markingSettings,
          next: body.markingSettings,
        })
      : null;

  if (markingEnabled && markingMode === "BULK_OIL_FROM_MARKED_BARREL" && !isLiterSaleUnit(nextUomName)) {
    return {
      ok: false,
      error: "Для сценария «Масло на разлив из бочки» единица товара должна быть «л».",
    };
  }

  const markingStatus = deriveProductMarkingStatus({
    markingEnabled,
    markingMode,
    uomName: nextUomName,
    settings: markingSettings ?? DEFAULT_MARKING_SETTINGS,
  });

  return {
    ok: true,
    data: {
      markingEnabled,
      markingMode,
      markingStatus,
      markingSettings,
    },
  };
}

function productMarkingSnapshot(value: {
  markingEnabled: boolean;
  markingMode: string;
  markingStatus: string;
  markingSettings: unknown;
}) {
  const mode = normalizeProductMarkingMode(value.markingMode);
  return {
    markingEnabled: Boolean(value.markingEnabled),
    markingMode: mode,
    markingStatus: value.markingStatus,
    markingSettings: mode === "BULK_OIL_FROM_MARKED_BARREL"
      ? normalizeProductMarkingSettings(value.markingSettings)
      : null,
  };
}

function productMarkingSnapshotChanged(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

async function writeProductMarkingAudit(input: {
  productId: string;
  oldValue: unknown;
  newValue: unknown;
  actor?: ActingUser | null;
  transaction?: Prisma.TransactionClient;
}) {
  if (!productMarkingSnapshotChanged(input.oldValue, input.newValue)) return;
  const client = input.transaction ?? prisma;
  await client.productMarkingAuditLog.create({
    data: {
      productId: input.productId,
      oldValue: toJson(input.oldValue),
      newValue: toJson(input.newValue),
      performedByLogin: input.actor?.login ?? null,
      performedByName: input.actor?.name ?? null,
    },
  });
}

function compactCounterpartyVehicleLabel(input: {
  vehiclePlate?: string | null;
  vehicleVin?: string | null;
  vehicleModel?: string | null;
  vehicleYear?: string | null;
}) {
  const model = input.vehicleModel?.trim() ?? "";
  const year = input.vehicleYear?.trim() ?? "";
  const plate = input.vehiclePlate?.trim() ?? "";
  const vin = input.vehicleVin?.trim() ?? "";
  return [
    [model, year].filter(Boolean).join(" "),
    plate,
    vin ? `VIN ${vin}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function counterpartyRawExtra(raw: unknown) {
  const record = jsonRecord(raw);
  const vehicle = jsonRecord(record.vehicle);
  return {
    additionalPhone: stringFromRecord(record, "additionalPhone"),
    comment: stringFromRecord(record, "comment"),
    vehiclePlate: stringFromRecord(vehicle, "plate") || stringFromRecord(record, "vehiclePlate"),
    vehicleVin: stringFromRecord(vehicle, "vin") || stringFromRecord(record, "vehicleVin"),
    vehicleModel: stringFromRecord(vehicle, "model") || stringFromRecord(record, "vehicleModel"),
    vehicleYear: stringFromRecord(vehicle, "year") || stringFromRecord(record, "vehicleYear"),
  };
}

function counterpartyRawSearchText(raw: unknown) {
  const extra = counterpartyRawExtra(raw);
  return buildSearchText([
    extra.additionalPhone,
    normalizePhoneKey(extra.additionalPhone),
    extra.comment,
    extra.vehiclePlate,
    extra.vehicleVin,
    extra.vehicleModel,
    extra.vehicleYear,
    compactCounterpartyVehicleLabel(extra),
  ]);
}

function centsFromRub(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.round(Math.max(0, n) * 100) : 0;
}

function nullableCentsFromRub(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = parseLocaleNumber(value);
  return n == null ? null : Math.round(Math.max(0, n) * 100);
}

function parseLocaleNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const raw = String(value).trim().replace(/\s/g, "").replace(",", ".");
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function cleanText(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function normalizeAdjustmentType(value: unknown): LocalAdjustmentType {
  return value === "technical" ? "technical" : "expense";
}

function normalizeAdjustmentMethod(value: unknown): "WRITE_OFF_QUANTITY" | "SET_ACTUAL_QUANTITY" | "ZERO_BALANCE" {
  if (value === "SET_ACTUAL_QUANTITY" || value === "ZERO_BALANCE") return value;
  return "WRITE_OFF_QUANTITY";
}

function validateWriteoffReason(type: LocalAdjustmentType, reason: string | null, applicable: boolean): string | null {
  if (!applicable && !reason) return null;
  if (!reason) return "Выберите причину списания";
  if (type === "technical") {
    if (EXPENSE_WRITE_OFF_REASONS.has(reason)) {
      return "Причина фактического расхода не может быть технической корректировкой";
    }
    if (!TECHNICAL_ADJUSTMENT_REASONS.has(reason)) {
      return "Выберите техническую причину корректировки";
    }
    return null;
  }
  if (TECHNICAL_ADJUSTMENT_REASONS.has(reason)) {
    return "Техническая причина не может быть обычным списанием";
  }
  if (!EXPENSE_WRITE_OFF_REASONS.has(reason)) return "Выберите причину обычного списания";
  return null;
}

function normalizeSearchText(value: unknown): string {
  if (value == null) return "";
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ё/g, "е")
    .replace(/Ё/g, "е")
    .toLocaleLowerCase("ru-RU")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function compactSearchText(value: unknown): string {
  return normalizeSearchText(value).replace(/\s+/g, "");
}

function buildSearchText(parts: unknown[]): string {
  return normalizeSearchText(parts.filter(Boolean).join(" "));
}

function parseSearchQuery(value?: string) {
  const normalized = normalizeSearchText(value ?? "");
  return {
    normalized,
    compact: compactSearchText(normalized),
    tokens: normalized.split(" ").filter(Boolean),
  };
}

type SearchQuery = ReturnType<typeof parseSearchQuery>;

function tokenCanMatchInside(token: string): boolean {
  return token.length >= 5 || /\d/.test(token);
}

function commonPrefixLength(a: string, b: string) {
  const max = Math.min(a.length, b.length);
  let index = 0;
  while (index < max && a[index] === b[index]) index += 1;
  return index;
}

function tokenStemMatches(token: string, textToken: string) {
  if (!/^\p{L}+$/u.test(token) || !/^\p{L}+$/u.test(textToken)) return false;
  const minLength = Math.min(token.length, textToken.length);
  if (minLength < 6) return false;
  return commonPrefixLength(token, textToken) >= Math.min(6, minLength - 1);
}

function tokenMatchesTextToken(token: string, textToken: string) {
  return (
    textToken.startsWith(token) ||
    tokenStemMatches(token, textToken) ||
    (tokenCanMatchInside(token) && textToken.includes(token))
  );
}

function normalizedSearchTextMatches(text: string, query: SearchQuery) {
  if (!query.normalized) return true;
  const normalizedText = normalizeSearchText(text);
  if (!normalizedText) return false;
  const textTokens = normalizedText.split(" ").filter(Boolean);
  const compactText = normalizedText.replace(/\s+/g, "");

  if (
    (query.normalized.length >= 5 && normalizedText.includes(query.normalized)) ||
    (query.compact.length >= 5 && compactText.includes(query.compact)) ||
    (/\d/.test(query.compact) && compactText.includes(query.compact))
  ) {
    return true;
  }

  return query.tokens.every((token) =>
    textTokens.some((textToken) => tokenMatchesTextToken(token, textToken)) ||
    (tokenCanMatchInside(token) && compactText.includes(token))
  );
}

function fieldSearchRank(value: unknown, query: SearchQuery): number | null {
  if (!query.normalized) return 0;
  const normalized = normalizeSearchText(value);
  if (!normalized) return null;
  const compact = normalized.replace(/\s+/g, "");
  const tokens = normalized.split(" ").filter(Boolean);

  if (normalized === query.normalized || compact === query.compact) return 0;
  if (normalized.startsWith(query.normalized) || compact.startsWith(query.compact)) return 1;
  if (query.tokens.every((token) => tokens.some((textToken) => tokenMatchesTextToken(token, textToken)))) return 2;
  if (query.normalized.length >= 5 && normalized.includes(query.normalized)) return 3;
  if ((query.compact.length >= 5 || /\d/.test(query.compact)) && compact.includes(query.compact)) return 4;
  if (
    query.tokens.every((token) =>
      tokens.some((textToken) => tokenCanMatchInside(token) && textToken.includes(token)) ||
      (tokenCanMatchInside(token) && compact.includes(token))
    )
  ) {
    return 5;
  }
  return null;
}

function booleanFromInput(value: unknown): boolean | null {
  if (value == null || value === "") return null;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "да"].includes(normalized)) return true;
  if (["0", "false", "no", "нет"].includes(normalized)) return false;
  return null;
}

function decimalFromInput(value: unknown): Prisma.Decimal | null {
  const n = parseLocaleNumber(value);
  return n == null ? null : new Prisma.Decimal(n);
}

function decimalToNumber(value: Prisma.Decimal | number | null | undefined): number {
  if (value == null) return 0;
  return typeof value === "number" ? value : value.toNumber();
}

function decimalToNullableNumber(value: Prisma.Decimal | number | null | undefined): number | null {
  if (value == null) return null;
  return typeof value === "number" ? value : value.toNumber();
}

function dateFromInput(value: unknown): Date | null {
  const raw = cleanText(value);
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return parseServiceDateTime(`${raw} 00:00:00`);
  const parts = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (parts) return parseServiceDateTime(`${parts[3]}-${parts[2].padStart(2, "0")}-${parts[1].padStart(2, "0")} 00:00:00`);
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function documentDateFromInput(value?: string): string {
  const raw = value?.trim();
  if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return toServiceDateInput(new Date());
}

function optionalDocumentDateFromInput(value?: string | null): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  return documentDateFromInput(raw);
}

function momentFromInput(value: string | undefined, documentDate: string): Date {
  const raw = value?.trim();
  return parseServiceDateTime(raw || `${documentDate} 00:00:00`) ?? new Date();
}

function buildProductSearchText(input: {
  name?: string | null;
  article?: string | null;
  code?: string | null;
  externalCode?: string | null;
  groupPath?: string | null;
  barcodeEan13?: string | null;
  barcodeEan8?: string | null;
  barcodeCode128?: string | null;
  description?: string | null;
  supplierName?: string | null;
  tnvedCode?: string | null;
  sae?: string | null;
  oem?: string | null;
  acea?: string | null;
  apiSpec?: string | null;
  packageVolume?: string | null;
  brand?: string | null;
  atf?: string | null;
  ilsac?: string | null;
  aceaExtra?: string | null;
  oemAtf?: string | null;
  rosskoPartNumber?: string | null;
  rosskoBrand?: string | null;
  supplierAttribute?: string | null;
  oemParts?: string | null;
  cell?: string | null;
  mannCharacteristicName?: string | null;
  entityType?: string | null;
  currencyName?: string | null;
  rosskoMin?: string | null;
}): string {
  return buildCatalogSearchText(input);
}

function buildCounterpartySearchText(input: {
  fullName?: string | null;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  legalTitle?: string | null;
  legalLastName?: string | null;
  legalFirstName?: string | null;
  legalMiddleName?: string | null;
  legalAddress?: string | null;
  actualAddress?: string | null;
  contactPerson?: string | null;
  contactPhone?: string | null;
  inn?: string | null;
  kpp?: string | null;
  okpo?: string | null;
  fax?: string | null;
  bik?: string | null;
  bankName?: string | null;
  bankLocation?: string | null;
  correspondentAccount?: string | null;
  checkingAccount?: string | null;
  ogrn?: string | null;
  ogrnip?: string | null;
  certificateNumber?: string | null;
  counterpartyTypeName?: string | null;
  companyType?: string | null;
  extraSearchText?: string | null;
}): string {
  return buildSearchText([
    input.fullName,
    input.name,
    input.phone,
    normalizePhoneKey(input.phone),
    input.email,
    input.legalTitle,
    input.legalLastName,
    input.legalFirstName,
    input.legalMiddleName,
    input.legalAddress,
    input.actualAddress,
    input.contactPerson,
    input.contactPhone,
    input.inn,
    input.kpp,
    input.okpo,
    input.fax,
    input.bik,
    input.bankName,
    input.bankLocation,
    input.correspondentAccount,
    input.checkingAccount,
    input.ogrn,
    input.ogrnip,
    input.certificateNumber,
    input.counterpartyTypeName,
    input.companyType,
    input.extraSearchText,
  ]);
}

function isStockTrackedType(type: string): boolean {
  return type === "product" || type === "variant" || type === "bundle";
}

function localMeta(type: string, id: string) {
  return { href: `local://${type}/${id}`, type, mediaType: "application/json" };
}

function supplierSnapshotId(name: string) {
  return `${SUPPLIER_SNAPSHOT_ID_PREFIX}${encodeURIComponent(name)}`;
}

function supplierSnapshotNameFromId(id: string | undefined | null) {
  if (!id?.startsWith(SUPPLIER_SNAPSHOT_ID_PREFIX)) return null;
  try {
    const name = decodeURIComponent(id.slice(SUPPLIER_SNAPSHOT_ID_PREFIX.length)).trim();
    return name || null;
  } catch {
    return null;
  }
}

function mapProductSupplier(counterparty: {
  id: string;
  name: string;
  displayName: string;
  inn: string | null;
  legalForm: string | null;
  archived: boolean;
  status: string;
} | null | undefined) {
  if (!counterparty) return null;
  return {
    id: counterparty.id,
    displayName: counterparty.displayName || counterparty.name,
    inn: counterparty.inn ?? "",
    legalForm: counterparty.legalForm ?? "",
    status: counterparty.archived ? "ARCHIVED" : counterparty.status || "ACTIVE",
  };
}

function supplierDisplayName(product: {
  supplierCounterparty?: { name: string; displayName?: string } | null;
  legacySupplierName?: string | null;
}) {
  return product.supplierCounterparty?.displayName?.trim() || product.supplierCounterparty?.name?.trim() || product.legacySupplierName?.trim() || "";
}

function mapProduct(product: ProductWithStock) {
  const stock = product.stockBalances.map((balance) => ({
    storeId: balance.storeId,
    storeName: balance.store?.name ?? "",
    quantity: decimalToNumber(balance.quantity),
    reserve: decimalToNumber(balance.reserve),
    available: decimalToNumber(balance.available),
    slotName: balance.slotName ?? "",
  }));
  return {
    id: product.id,
    name: product.name,
    article: product.article ?? "",
    code: product.code ?? "",
    externalCode: product.externalCode ?? "",
    groupPath: product.groupPath ?? "",
    uomName: product.uomName ?? "",
    entityType: product.entityType,
    salePrice: product.salePriceCents / 100,
    buyPrice: product.buyPriceCents == null ? null : product.buyPriceCents / 100,
    currencyName: product.currencyName ?? "руб.",
    minimumBalance: decimalToNullableNumber(product.minimumBalance),
    barcodeEan13: product.barcodeEan13 ?? "",
    barcodeEan8: product.barcodeEan8 ?? "",
    barcodeCode128: product.barcodeCode128 ?? "",
    description: product.description ?? "",
    minPrice: product.minPriceCents == null ? null : product.minPriceCents / 100,
    minPriceCurrencyName: product.minPriceCurrencyName ?? "",
    countryName: product.countryName ?? "",
    vatLabel: product.vatLabel ?? "",
    supplierName: supplierDisplayName(product),
    legacySupplierName: product.legacySupplierName ?? "",
    supplierCounterparty: mapProductSupplier(product.supplierCounterparty),
    weight: decimalToNullableNumber(product.weight),
    volume: decimalToNullableNumber(product.volume),
    modificationCode: product.modificationCode ?? "",
    tnvedCode: product.tnvedCode ?? "",
    sae: product.sae ?? "",
    oem: product.oem ?? "",
    acea: product.acea ?? "",
    apiSpec: product.apiSpec ?? "",
    packageVolume: product.packageVolume ?? "",
    avito: product.avito,
    brand: product.brand ?? "",
    atf: product.atf ?? "",
    ilsac: product.ilsac ?? "",
    aceaExtra: product.aceaExtra ?? "",
    oemAtf: product.oemAtf ?? "",
    mannName: product.mannName ?? "",
    rosskoPartNumber: product.rosskoPartNumber ?? "",
    rosskoBrand: product.rosskoBrand ?? "",
    rosskoMin: product.rosskoMin ?? "",
    supplierAttribute: product.supplierAttribute ?? "",
    oemParts: product.oemParts ?? "",
    cell: product.cell ?? "",
    mannCharacteristicName: product.mannCharacteristicName ?? "",
    markingEnabled: product.markingEnabled,
    markingMode: normalizeProductMarkingMode(product.markingMode),
    markingStatus: product.markingStatus,
    markingSettings: product.markingMode === "BULK_OIL_FROM_MARKED_BARREL"
      ? normalizeProductMarkingSettings(product.markingSettings)
      : null,
    markingConfiguredManually: product.markingConfiguredManually,
    markingConfiguredAt: product.markingConfiguredAt?.toISOString() ?? null,
    markingConfiguredByLogin: product.markingConfiguredByLogin ?? null,
    imageHref: product.imageHref ?? "",
    photos: product.photos.map((photo) => ({
      id: photo.id,
      fileName: photo.fileName ?? "",
      contentType: photo.contentType,
      sizeBytes: photo.sizeBytes,
      createdAt: photo.createdAt.toISOString(),
      url: `/api/local-inventory/products/${product.id}/photos/${photo.id}`,
    })),
    searchText: buildProductSearchText({
      name: product.name,
      article: product.article,
      code: product.code,
      externalCode: product.externalCode,
      groupPath: product.groupPath,
      barcodeEan13: product.barcodeEan13,
      barcodeEan8: product.barcodeEan8,
      barcodeCode128: product.barcodeCode128,
      description: product.description,
      supplierName: supplierDisplayName(product),
      tnvedCode: product.tnvedCode,
      sae: product.sae,
      oem: product.oem,
      acea: product.acea,
      apiSpec: product.apiSpec,
      packageVolume: product.packageVolume,
      brand: product.brand,
      atf: product.atf,
      ilsac: product.ilsac,
      aceaExtra: product.aceaExtra,
      oemAtf: product.oemAtf,
      rosskoPartNumber: product.rosskoPartNumber,
      rosskoBrand: product.rosskoBrand,
      rosskoMin: product.rosskoMin,
      supplierAttribute: product.supplierAttribute,
      oemParts: product.oemParts,
      cell: product.cell,
      mannCharacteristicName: product.mannCharacteristicName,
      entityType: product.entityType,
      currencyName: product.currencyName,
    }),
    archived: product.archived,
    updatedAt: product.updatedAt.toISOString(),
    stock,
    totalQuantity: stock.reduce((sum, row) => sum + row.quantity, 0),
    totalAvailable: stock.reduce((sum, row) => sum + row.available, 0),
    meta: localMeta(product.entityType || "product", product.id),
  };
}

function mapProductSearchRow(
  product: ProductListIndexProduct,
  totals: { totalQuantity: number; totalAvailable: number } | undefined
): ProductSearchRow {
  return {
    id: product.id,
    name: product.name,
    article: product.article ?? "",
    code: product.code ?? "",
    externalCode: product.externalCode ?? "",
    groupPath: product.groupPath ?? "",
    uomName: product.uomName ?? "",
    entityType: product.entityType,
    salePrice: product.salePriceCents / 100,
    buyPrice: product.buyPriceCents == null ? null : product.buyPriceCents / 100,
    barcodeEan13: product.barcodeEan13 ?? "",
    barcodeEan8: product.barcodeEan8 ?? "",
    barcodeCode128: product.barcodeCode128 ?? "",
    description: product.description ?? "",
    supplierName: supplierDisplayName(product),
    legacySupplierName: product.legacySupplierName ?? "",
    supplierCounterparty: mapProductSupplier(product.supplierCounterparty),
    sae: product.sae ?? "",
    oem: product.oem ?? "",
    acea: product.acea ?? "",
    apiSpec: product.apiSpec ?? "",
    packageVolume: product.packageVolume ?? "",
    brand: product.brand ?? "",
    atf: product.atf ?? "",
    ilsac: product.ilsac ?? "",
    aceaExtra: product.aceaExtra ?? "",
    oemAtf: product.oemAtf ?? "",
    mannName: product.mannName ?? "",
    rosskoPartNumber: product.rosskoPartNumber ?? "",
    rosskoBrand: product.rosskoBrand ?? "",
    rosskoMin: product.rosskoMin ?? "",
    supplierAttribute: product.supplierAttribute ?? "",
    oemParts: product.oemParts ?? "",
    cell: product.cell ?? "",
    mannCharacteristicName: product.mannCharacteristicName ?? "",
    markingEnabled: product.markingEnabled,
    markingMode: normalizeProductMarkingMode(product.markingMode),
    markingStatus: product.markingStatus,
    markingSettings: product.markingMode === "BULK_OIL_FROM_MARKED_BARREL"
      ? normalizeProductMarkingSettings(product.markingSettings)
      : null,
    markingConfiguredManually: product.markingConfiguredManually,
    markingConfiguredAt: product.markingConfiguredAt?.toISOString() ?? null,
    markingConfiguredByLogin: product.markingConfiguredByLogin ?? null,
    searchText: product.searchText || buildProductSearchText({
      name: product.name,
      article: product.article,
      code: product.code,
      externalCode: product.externalCode,
      groupPath: product.groupPath,
      barcodeEan13: product.barcodeEan13,
      barcodeEan8: product.barcodeEan8,
      barcodeCode128: product.barcodeCode128,
      description: product.description,
      supplierName: supplierDisplayName(product),
      sae: product.sae,
      oem: product.oem,
      acea: product.acea,
      apiSpec: product.apiSpec,
      packageVolume: product.packageVolume,
      brand: product.brand,
      atf: product.atf,
      ilsac: product.ilsac,
      aceaExtra: product.aceaExtra,
      oemAtf: product.oemAtf,
      rosskoPartNumber: product.rosskoPartNumber,
      rosskoBrand: product.rosskoBrand,
      rosskoMin: product.rosskoMin,
      supplierAttribute: product.supplierAttribute,
      oemParts: product.oemParts,
      cell: product.cell,
      mannCharacteristicName: product.mannCharacteristicName,
      entityType: product.entityType,
    }),
    archived: product.archived,
    updatedAt: product.updatedAt.toISOString(),
    totalQuantity: totals?.totalQuantity ?? 0,
    totalAvailable: totals?.totalAvailable ?? 0,
  };
}

type ProductListRow = ReturnType<typeof mapProduct>;
type ProductSearchRow = Pick<ProductListRow,
  | "id"
  | "name"
  | "article"
  | "code"
  | "externalCode"
  | "groupPath"
  | "uomName"
  | "entityType"
  | "salePrice"
  | "buyPrice"
  | "barcodeEan13"
  | "barcodeEan8"
  | "barcodeCode128"
  | "description"
  | "supplierName"
  | "legacySupplierName"
  | "supplierCounterparty"
  | "sae"
  | "oem"
  | "acea"
  | "apiSpec"
  | "packageVolume"
  | "brand"
  | "atf"
  | "ilsac"
  | "aceaExtra"
  | "oemAtf"
  | "mannName"
  | "rosskoPartNumber"
  | "rosskoBrand"
  | "rosskoMin"
  | "supplierAttribute"
  | "oemParts"
  | "cell"
  | "mannCharacteristicName"
  | "markingEnabled"
  | "markingMode"
  | "markingStatus"
  | "markingSettings"
  | "markingConfiguredManually"
  | "markingConfiguredAt"
  | "markingConfiguredByLogin"
  | "searchText"
  | "archived"
  | "updatedAt"
  | "totalQuantity"
  | "totalAvailable"
>;
type ProductSortKey =
  | "name"
  | "article"
  | "code"
  | "available"
  | "quantity"
  | "buyPrice"
  | "salePrice"
  | "margin"
  | "updatedAt";
type SortDirection = "asc" | "desc";
type StockFilter = "all" | "inStock" | "outOfStock";
type MultiProductFilterValue = string | string[] | undefined;
type ProductFilterParams = {
  brand?: MultiProductFilterValue;
  sae?: MultiProductFilterValue;
  supplier?: MultiProductFilterValue;
  group?: MultiProductFilterValue;
  entityType?: MultiProductFilterValue;
  apiSpec?: MultiProductFilterValue;
  acea?: MultiProductFilterValue;
  packageVolume?: MultiProductFilterValue;
  stock?: string;
  markingProblems?: boolean;
};
type ProductFilterOptions = {
  brands: string[];
  sae: string[];
  suppliers: string[];
  groups: string[];
  entityTypes: string[];
  apiSpecs: string[];
  acea: string[];
  packageVolumes: string[];
};
type ProductRowsCacheEntry = { key: string; expiresAt: number; rows: ProductSearchRow[] };
type ProductAdminCache = {
  rows: ProductRowsCacheEntry | null;
};
type CounterpartySource = "local" | "supplier" | "snapshot";
type CounterpartyListRow = ReturnType<typeof mapCounterparty>;
type CounterpartyRowsCacheEntry = { key: string; expiresAt: number; rows: CounterpartyListRow[] };
type CounterpartyAdminCache = { rows: CounterpartyRowsCacheEntry | null };
type StoreAdminList = {
  stores: Array<{ id: string; branchId: string; name: string; isMain: boolean; archived: boolean; meta: ReturnType<typeof localMeta> }>;
};
type StockDocumentAdminList = {
  meta: { total: number; limit: number; offset: number };
  documents: Array<{
    id: string;
    branchId: string;
    type: string;
    name: string;
    moment: string;
    documentDate: string;
    status: LocalReceiptStatus;
    applicable: boolean;
    sum: number;
    description: string;
    adjustmentType: string | null;
    adjustmentMethod: string | null;
    adjustmentReason: string;
    affectsManagementProfit: boolean;
    correctionOfId: string | null;
    isDeleted: boolean;
    cancelledAt: string | null;
    deletedAt: string | null;
    storeId: string;
    storeName: string;
    counterpartyId: string;
    counterpartyName: string;
    positionsCount: number;
    totalQuantity: number;
    invoice: {
      id: string;
      number: string;
      invoiceDate: string;
      dueDate: string;
      status: string;
      sum: number;
    } | null;
    positions: Array<{
      id: string;
      productId: string | null;
      name: string;
      quantity: number;
      price: number;
      slotName: string;
    }>;
  }>;
};
type SupplierInvoiceAdminList = {
  meta: { total: number; limit: number; offset: number };
  invoices: ReturnType<typeof mapSupplierInvoice>[];
};
type LocalRestockMode = "below_min" | "outflow";
type LocalRestockNeedItem = {
  productId: string;
  name: string | null;
  code: string | null;
  group: string | null;
  supplier: string | null;
  minimumBalance: number | null;
  stock: number;
  reserve: number;
  inTransit: number;
  quantity: number;
  shortage: number;
  spentInPeriod?: number;
};
type LocalRestockNeedsList = {
  ok: true;
  rule: "below_min" | "below_min_with_period_outflow";
  source: "local";
  timezone: string;
  dateLabel?: string;
  dateFrom?: string;
  dateTo?: string;
  note?: string;
  items: LocalRestockNeedItem[];
  fetchedRows: number;
  catalogSize: number;
};
type CacheEntry<T> = { key: string; expiresAt: number; value: T };
type InventoryListsCache = {
  stores: Map<string, CacheEntry<StoreAdminList>>;
  stockDocuments: Map<string, CacheEntry<StockDocumentAdminList>>;
  supplierInvoices: Map<string, CacheEntry<SupplierInvoiceAdminList>>;
  restockNeeds: Map<string, CacheEntry<LocalRestockNeedsList>>;
};

const productSortKeys = new Set<ProductSortKey>([
  "name",
  "article",
  "code",
  "available",
  "quantity",
  "buyPrice",
  "salePrice",
  "margin",
  "updatedAt",
]);
const ruCollator = new Intl.Collator("ru", { numeric: true, sensitivity: "base" });
const PRODUCT_ROWS_CACHE_MS = 60_000;
const COUNTERPARTY_ROWS_CACHE_MS = 60_000;
const STORE_ROWS_CACHE_MS = 300_000;
const STOCK_DOCUMENTS_CACHE_MS = 60_000;
const SUPPLIER_INVOICES_CACHE_MS = 60_000;
const LOCAL_RESTOCK_NEEDS_CACHE_MS = 60_000;
const SUPPLIER_SNAPSHOT_ID_PREFIX = "supplier:";
const productAdminCache = ((globalThis as typeof globalThis & {
  __localInventoryProductAdminCache?: ProductAdminCache;
}).__localInventoryProductAdminCache ??= { rows: null });
const counterpartyAdminCache = ((globalThis as typeof globalThis & {
  __localInventoryCounterpartyAdminCache?: CounterpartyAdminCache;
}).__localInventoryCounterpartyAdminCache ??= { rows: null });
const inventoryListsCache = ((globalThis as typeof globalThis & {
  __localInventoryListsCache?: InventoryListsCache;
}).__localInventoryListsCache ??= {
  stores: new Map<string, CacheEntry<StoreAdminList>>(),
  stockDocuments: new Map<string, CacheEntry<StockDocumentAdminList>>(),
  supplierInvoices: new Map<string, CacheEntry<SupplierInvoiceAdminList>>(),
  restockNeeds: new Map<string, CacheEntry<LocalRestockNeedsList>>(),
});
// The cache lives on globalThis in development. Convert the pre-branch cache
// shape ({ expiresAt, value }) during hot reload instead of crashing the
// stores endpoint while a user has the app open.
if (!(inventoryListsCache.stores instanceof Map)) {
  inventoryListsCache.stores = new Map<string, CacheEntry<StoreAdminList>>();
}
inventoryListsCache.stockDocuments ??= new Map<string, CacheEntry<StockDocumentAdminList>>();
inventoryListsCache.supplierInvoices ??= new Map<string, CacheEntry<SupplierInvoiceAdminList>>();
inventoryListsCache.restockNeeds ??= new Map<string, CacheEntry<LocalRestockNeedsList>>();

/**
 * Only accepts a scope already resolved from the signed server-side branch
 * context.  A client-provided branch id must never widen a document list.
 */
function trustedReadableBranchIds(requested?: string[]) {
  const tenant = getRequestTenant();
  if (!tenant || tenant.mode === "denied") throw new Error("Контекст филиала обязателен для работы со складскими документами");
  const ids = [...new Set(requested?.filter(Boolean) ?? [])].sort();
  if (tenant.mode === "branch") {
    if (!tenant.branchId) throw new Error("Активный филиал не выбран");
    if (ids.length && (ids.length !== 1 || ids[0] !== tenant.branchId)) {
      throw new Error("Попытка доступа к данным другого филиала");
    }
    return [tenant.branchId];
  }
  if (!ids.length || ids.some((id) => !tenant.allowedBranchIds.includes(id))) {
    throw new Error("В режиме «Все филиалы» требуется разрешённый серверный scope");
  }
  return ids;
}

function normalizeProductSort(value?: string): ProductSortKey {
  return value && productSortKeys.has(value as ProductSortKey) ? (value as ProductSortKey) : "name";
}

function normalizeSortDirection(value?: string): SortDirection {
  return value === "desc" ? "desc" : "asc";
}

function normalizeStockFilter(value?: string): StockFilter {
  return value === "inStock" || value === "outOfStock" ? value : "all";
}

function cleanFilterValues(value: MultiProductFilterValue): string[] {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  const seen = new Set<string>();
  for (const item of values) {
    for (const part of String(item).split(",")) {
      const clean = part.trim();
      if (clean) seen.add(clean);
    }
  }
  return [...seen];
}

function filterValuesInclude(values: string[], candidate: string | null | undefined) {
  if (!values.length) return true;
  const clean = candidate?.trim() ?? "";
  const normalized = normalizeSearchText(clean);
  return clean ? values.some((value) => value === clean || normalizeSearchText(value) === normalized) : false;
}

function uniqueSorted(values: Array<string | null | undefined>, limit = 200) {
  const seen = new Set<string>();
  for (const value of values) {
    const clean = value?.trim();
    if (clean) seen.add(clean);
  }
  return [...seen].sort((a, b) => ruCollator.compare(a, b)).slice(0, limit);
}

function compareText(a: string, b: string, direction: SortDirection) {
  const result = ruCollator.compare(a || "", b || "");
  return direction === "asc" ? result : -result;
}

function compareNullableNumber(a: number | null | undefined, b: number | null | undefined, direction: SortDirection) {
  const aMissing = a == null;
  const bMissing = b == null;
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  const result = a - b;
  return direction === "asc" ? result : -result;
}

function productMargin(product: ProductSearchRow): number | null {
  return product.buyPrice == null ? null : product.salePrice - product.buyPrice;
}

function compareProducts(a: ProductSearchRow, b: ProductSearchRow, sort: ProductSortKey, direction: SortDirection) {
  let result = 0;
  if (sort === "name") result = compareText(a.name, b.name, direction);
  if (sort === "article") result = compareText(a.article || a.code || a.name, b.article || b.code || b.name, direction);
  if (sort === "code") result = compareText(a.code || a.article || a.name, b.code || b.article || b.name, direction);
  if (sort === "available") result = compareNullableNumber(a.totalAvailable, b.totalAvailable, direction);
  if (sort === "quantity") result = compareNullableNumber(a.totalQuantity, b.totalQuantity, direction);
  if (sort === "buyPrice") result = compareNullableNumber(a.buyPrice, b.buyPrice, direction);
  if (sort === "salePrice") result = compareNullableNumber(a.salePrice, b.salePrice, direction);
  if (sort === "margin") result = compareNullableNumber(productMargin(a), productMargin(b), direction);
  if (sort === "updatedAt") {
    result = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
    if (direction === "desc") result = -result;
  }
  if (result !== 0) return result;
  return compareText(a.name, b.name, "asc");
}

type ProductFacetKey = "brand" | "sae" | "supplier" | "group" | "entityType" | "apiSpec" | "acea" | "packageVolume";
type ProductFacetOption = { value: string; count: number };
type ProductFacets = {
  brands: ProductFacetOption[];
  sae: ProductFacetOption[];
  suppliers: ProductFacetOption[];
  groups: ProductFacetOption[];
  entityTypes: ProductFacetOption[];
  apiSpecs: ProductFacetOption[];
  acea: ProductFacetOption[];
  packageVolumes: ProductFacetOption[];
  stock: Record<StockFilter, number>;
};

function productFacetValue(row: ProductSearchRow, key: ProductFacetKey): string {
  if (key === "brand") return row.brand;
  if (key === "sae") return row.sae;
  if (key === "supplier") return row.supplierName;
  if (key === "group") return row.groupPath;
  if (key === "entityType") return row.entityType;
  if (key === "apiSpec") return row.apiSpec;
  if (key === "acea") return row.acea;
  return row.packageVolume;
}

function facetCollectionKey(key: ProductFacetKey): keyof Omit<ProductFacets, "stock"> {
  if (key === "brand") return "brands";
  if (key === "supplier") return "suppliers";
  if (key === "group") return "groups";
  if (key === "entityType") return "entityTypes";
  if (key === "apiSpec") return "apiSpecs";
  if (key === "packageVolume") return "packageVolumes";
  return key;
}

function productFilterValues(params: ProductFilterParams, key: ProductFacetKey): string[] {
  return cleanFilterValues(params[key]);
}

function productMatchesFacetFilter(row: ProductSearchRow, params: ProductFilterParams, key: ProductFacetKey) {
  return filterValuesInclude(productFilterValues(params, key), productFacetValue(row, key));
}

function facetOptionsFromRows(rows: ProductSearchRow[], key: ProductFacetKey, params: ProductFilterParams) {
  const selected = new Set(productFilterValues(params, key));
  const selectedByNormalized = new Map([...selected].map((value) => [normalizeSearchText(value), value]));
  const counts = new Map<string, { value: string; count: number }>();
  for (const row of rows) {
    const value = productFacetValue(row, key).trim();
    if (!value) continue;
    const normalized = normalizeSearchText(value);
    const current = counts.get(normalized);
    counts.set(normalized, {
      value: current?.value ?? selectedByNormalized.get(normalized) ?? value,
      count: (current?.count ?? 0) + 1,
    });
  }
  for (const value of selected) {
    const normalized = normalizeSearchText(value);
    if (value && !counts.has(normalized)) counts.set(normalized, { value, count: 0 });
  }
  return [...counts.values()]
    .sort((a, b) => {
      const selectedDiff =
        Number(selected.has(b.value) || selectedByNormalized.has(normalizeSearchText(b.value))) -
        Number(selected.has(a.value) || selectedByNormalized.has(normalizeSearchText(a.value)));
      if (selectedDiff !== 0) return selectedDiff;
      const countDiff = b.count - a.count;
      if (countDiff !== 0) return countDiff;
      return ruCollator.compare(a.value, b.value);
    });
}

function buildProductFacets(searchRows: ProductSearchRow[], params: ProductFilterParams): ProductFacets {
  const facetKeys: ProductFacetKey[] = ["brand", "sae", "supplier", "group", "entityType", "apiSpec", "acea", "packageVolume"];
  const result = {
    brands: [],
    sae: [],
    suppliers: [],
    groups: [],
    entityTypes: [],
    apiSpecs: [],
    acea: [],
    packageVolumes: [],
    stock: { all: 0, inStock: 0, outOfStock: 0 },
  } as ProductFacets;

  for (const key of facetKeys) {
    const rowsForFacet = searchRows.filter((row) =>
      facetKeys.every((otherKey) => otherKey === key || productMatchesFacetFilter(row, params, otherKey)) &&
      rowMatchesProductStockFilter(row, params.stock)
    );
    result[facetCollectionKey(key)] = facetOptionsFromRows(rowsForFacet, key, params);
  }

  const rowsForStock = searchRows.filter((row) => facetKeys.every((key) => productMatchesFacetFilter(row, params, key)));
  result.stock = {
    all: rowsForStock.length,
    inStock: rowsForStock.filter((row) => row.totalAvailable > 0).length,
    outOfStock: rowsForStock.filter((row) => row.totalAvailable <= 0).length,
  };
  return result;
}

export function invalidateProductFilterOptions() {
  productAdminCache.rows = null;
}

function invalidateStockDocumentLists() {
  inventoryListsCache.stockDocuments.clear();
}

function invalidateSupplierInvoiceLists() {
  inventoryListsCache.supplierInvoices.clear();
}

function invalidateRestockNeedsLists() {
  inventoryListsCache.restockNeeds.clear();
}

export function invalidateWarehouseReadCaches() {
  invalidateProductFilterOptions();
  inventoryListsCache.stores.clear();
  invalidateStockDocumentLists();
  invalidateSupplierInvoiceLists();
  invalidateRestockNeedsLists();
  invalidateLocalInventoryFinanceCache();
}

export async function listLocalProductGroups(options: { branchId: string; includeArchived?: boolean }) {
  const rows = await prisma.localProduct.findMany({
    where: {
      branchId: options.branchId,
      ...(options.includeArchived ? {} : { archived: false }),
      AND: [
        { groupPath: { not: null } },
        { groupPath: { not: "" } },
      ],
    },
    select: { groupPath: true },
    distinct: ["groupPath"],
  });
  return rows
    .map((row) => row.groupPath?.trim() ?? "")
    .filter(Boolean)
    .sort((a, b) => ruCollator.compare(a, b));
}

async function getProductRowsForAdmin(branchId: string, includeArchived?: boolean) {
  const key = `${branchId}:${includeArchived ? "all" : "active"}`;
  const now = Date.now();
  if (productAdminCache.rows?.key === key && productAdminCache.rows.expiresAt > now) {
    return productAdminCache.rows.rows;
  }

  const [products, balances] = await Promise.all([
    prisma.localProduct.findMany({
      where: { branchId, ...(includeArchived ? {} : { archived: false }) },
      select: productListIndexSelect,
      orderBy: [{ name: "asc" }],
    }),
    prisma.localStockBalance.findMany({
      where: { branchId },
      select: {
        productId: true,
        quantity: true,
        available: true,
      },
    }),
  ]);
  const totalsByProduct = new Map<string, { totalQuantity: number; totalAvailable: number }>();
  for (const balance of balances) {
    const current = totalsByProduct.get(balance.productId) ?? { totalQuantity: 0, totalAvailable: 0 };
    current.totalQuantity += decimalToNumber(balance.quantity);
    current.totalAvailable += decimalToNumber(balance.available);
    totalsByProduct.set(balance.productId, current);
  }
  const rows = products.map((product) => mapProductSearchRow(product, totalsByProduct.get(product.id)));
  productAdminCache.rows = { key, expiresAt: now + PRODUCT_ROWS_CACHE_MS, rows };
  return rows;
}

async function resolveProductSupplierCounterparty(
  supplierCounterpartyId: string | null | undefined,
  branchId: string,
  options: { allowExistingArchivedId?: string | null; transaction?: Prisma.TransactionClient } = {}
) {
  if (supplierCounterpartyId === undefined) return { ok: true as const, id: undefined, name: undefined };
  const id = supplierCounterpartyId?.trim() || null;
  if (!id) return { ok: true as const, id: null, name: "" };

  const client = options.transaction ?? prisma;
  const supplier = await client.localCounterparty.findFirst({
    where: {
      id,
      branchId,
      AND: [supplierCounterpartyIdentityWhere()],
      OR: [
        { archived: false },
        ...(options.allowExistingArchivedId === id ? [{ id }] : []),
      ],
    },
    select: { id: true, name: true, displayName: true },
  });
  if (!supplier) {
    return { ok: false as const, error: "Выберите активного поставщика текущего филиала" };
  }
  return { ok: true as const, id: supplier.id, name: supplier.displayName || supplier.name };
}

/**
 * Older branch imports marked suppliers through companyType/counterpartyTypeName
 * before category became canonical. Keep one compatibility rule for selectors,
 * product validation and imports until those rows are normalized in the DB.
 */
export function supplierCounterpartyIdentityWhere(): Prisma.LocalCounterpartyWhereInput {
  return {
    OR: [
      { category: "SUPPLIER" },
      { companyType: { equals: "supplier", mode: "insensitive" } },
      { counterpartyTypeName: { contains: "поставщик", mode: "insensitive" } },
    ],
  };
}

export async function getLocalAdminProduct(id: string, branchId: string) {
  const product = await prisma.localProduct.findFirst({
    where: { branchId, OR: [{ id }, { id: id }] },
    include: productWithStockInclude,
  });
  if (!product) return null;
  return mapProduct(product);
}

function productIdentityMatchesSearch(row: ProductSearchRow, query: SearchQuery) {
  const identityFields = [
    row.name,
    row.article,
    row.code,
    row.externalCode,
    row.barcodeEan13,
    row.barcodeEan8,
    row.barcodeCode128,
    row.brand,
    row.rosskoBrand,
    row.rosskoPartNumber,
    row.sae,
    row.packageVolume,
    row.supplierName,
    row.groupPath,
  ];
  return identityFields.some((field) => fieldSearchRank(field, query) != null);
}

function rowMatchesSearch(row: ProductSearchRow, query: SearchQuery) {
  if (!query.normalized) return true;
  if (productIdentityMatchesSearch(row, query)) return true;
  const canSearchDeepFields = query.tokens.some(tokenCanMatchInside);
  return canSearchDeepFields && normalizedSearchTextMatches(row.searchText, query);
}

function productSearchRank(row: ProductSearchRow, query: SearchQuery) {
  if (!query.normalized) return 0;
  const weightedFields: Array<[unknown, number]> = [
    [row.article, 0],
    [row.code, 0],
    [row.externalCode, 1],
    [row.barcodeEan13, 1],
    [row.barcodeEan8, 1],
    [row.barcodeCode128, 1],
    [row.brand, 4],
    [row.rosskoBrand, 5],
    [row.name, 8],
    [row.rosskoPartNumber, 10],
    [row.sae, 16],
    [row.packageVolume, 18],
    [row.apiSpec, 20],
    [row.acea, 20],
    [row.oem, 22],
    [row.oemParts, 24],
    [row.supplierAttribute, 32],
    [row.supplierName, 45],
    [row.groupPath, 65],
    [row.description, 80],
    [row.searchText, 120],
  ];

  let best = Number.POSITIVE_INFINITY;
  for (const [value, weight] of weightedFields) {
    const rank = fieldSearchRank(value, query);
    if (rank != null) best = Math.min(best, weight + rank);
  }
  if (!Number.isFinite(best)) return 10_000;
  return best + (row.entityType === "service" ? 1_000 : 0);
}

function compareProductsForSearch(
  a: ProductSearchRow,
  b: ProductSearchRow,
  query: SearchQuery,
  sort: ProductSortKey,
  direction: SortDirection
) {
  if (query.normalized) {
    const rankDiff = productSearchRank(a, query) - productSearchRank(b, query);
    if (rankDiff !== 0) return rankDiff;
  }
  return compareProducts(a, b, sort, direction);
}

function rowMatchesProductStockFilter(row: ProductSearchRow, value?: string) {
  const stock = normalizeStockFilter(value);
  if (stock === "inStock") return row.totalAvailable > 0;
  if (stock === "outOfStock") return row.totalAvailable <= 0;
  return true;
}

function rowMatchesProductFilters(row: ProductSearchRow, params: ProductFilterParams) {
  const stock = normalizeStockFilter(params.stock);
  if (!filterValuesInclude(cleanFilterValues(params.brand), row.brand)) return false;
  if (!filterValuesInclude(cleanFilterValues(params.sae), row.sae)) return false;
  if (!filterValuesInclude(cleanFilterValues(params.supplier), row.supplierName)) return false;
  if (!filterValuesInclude(cleanFilterValues(params.group), row.groupPath)) return false;
  if (!filterValuesInclude(cleanFilterValues(params.entityType), row.entityType)) return false;
  if (!filterValuesInclude(cleanFilterValues(params.apiSpec), row.apiSpec)) return false;
  if (!filterValuesInclude(cleanFilterValues(params.acea), row.acea)) return false;
  if (!filterValuesInclude(cleanFilterValues(params.packageVolume), row.packageVolume)) return false;
  if (stock === "inStock" && row.totalAvailable <= 0) return false;
  if (stock === "outOfStock" && row.totalAvailable > 0) return false;
  if (params.markingProblems && !productHasMarkingProblem({
    markingEnabled: row.markingEnabled,
    markingMode: row.markingMode,
    markingStatus: row.markingStatus,
    groupPath: row.groupPath,
    uomName: row.uomName,
    settings: row.markingSettings,
  })) {
    return false;
  }
  return true;
}

function mapCounterparty(counterparty: CounterpartyRow) {
  const rawExtra = counterpartyRawExtra(counterparty.raw);
  const category = counterparty.category === "SUPPLIER" ? "SUPPLIER" : "INDIVIDUAL";
  return {
    id: counterparty.id,
    source: "local" as CounterpartySource,
    name: counterparty.displayName || counterparty.name,
    displayName: counterparty.displayName || counterparty.name,
    fullName: counterparty.fullName ?? "",
    category,
    legalForm: counterparty.legalForm ?? "",
    status: counterparty.archived ? "ARCHIVED" : counterparty.status || "ACTIVE",
    phone: counterparty.phone ?? "",
    additionalPhone: rawExtra.additionalPhone,
    email: counterparty.email ?? "",
    companyType: counterparty.companyType ?? "legal",
    counterpartyTypeName: counterparty.counterpartyTypeName ?? "",
    legalTitle: counterparty.legalTitle ?? "",
    legalLastName: counterparty.legalLastName ?? "",
    legalFirstName: counterparty.legalFirstName ?? "",
    legalMiddleName: counterparty.legalMiddleName ?? "",
    legalAddress: counterparty.legalAddress ?? "",
    actualAddress: counterparty.actualAddress ?? "",
    contactPerson: counterparty.contactPerson ?? "",
    contactPhone: counterparty.contactPhone ?? "",
    bankDetailsJson: counterparty.bankDetailsJson ?? null,
    inn: counterparty.inn ?? "",
    kpp: counterparty.kpp ?? "",
    okpo: counterparty.okpo ?? "",
    fax: counterparty.fax ?? "",
    bik: counterparty.bik ?? "",
    bankName: counterparty.bankName ?? "",
    bankLocation: counterparty.bankLocation ?? "",
    correspondentAccount: counterparty.correspondentAccount ?? "",
    checkingAccount: counterparty.checkingAccount ?? "",
    ogrn: counterparty.ogrn ?? "",
    ogrnip: counterparty.ogrnip ?? "",
    certificateNumber: counterparty.certificateNumber ?? "",
    certificateDate: counterparty.certificateDate?.toISOString().slice(0, 10) ?? "",
    comment: rawExtra.comment,
    supplierProductCount: 0,
    vehiclePlate: rawExtra.vehiclePlate,
    vehicleVin: rawExtra.vehicleVin,
    vehicleModel: rawExtra.vehicleModel,
    vehicleYear: rawExtra.vehicleYear,
    vehicleLabel: compactCounterpartyVehicleLabel(rawExtra),
    createdAt: counterparty.createdAt.toISOString(),
    updatedAt: counterparty.updatedAt.toISOString(),
    searchText: buildCounterpartySearchText({
      fullName: counterparty.fullName,
      name: counterparty.displayName || counterparty.name,
      phone: counterparty.phone,
      email: counterparty.email,
      legalTitle: counterparty.legalTitle,
      legalLastName: counterparty.legalLastName,
      legalFirstName: counterparty.legalFirstName,
      legalMiddleName: counterparty.legalMiddleName,
      legalAddress: counterparty.legalAddress,
      actualAddress: counterparty.actualAddress,
      contactPerson: counterparty.contactPerson,
      contactPhone: counterparty.contactPhone,
      inn: counterparty.inn,
      kpp: counterparty.kpp,
      okpo: counterparty.okpo,
      fax: counterparty.fax,
      bik: counterparty.bik,
      bankName: counterparty.bankName,
      bankLocation: counterparty.bankLocation,
      correspondentAccount: counterparty.correspondentAccount,
      checkingAccount: counterparty.checkingAccount,
      ogrn: counterparty.ogrn,
      ogrnip: counterparty.ogrnip,
      certificateNumber: counterparty.certificateNumber,
      counterpartyTypeName: counterparty.counterpartyTypeName,
      companyType: counterparty.companyType,
      extraSearchText: counterpartyRawSearchText(counterparty.raw),
    }),
    archived: counterparty.archived,
    meta: localMeta("counterparty", counterparty.id),
  };
}

function mapSupplierNameCounterparty(name: string): CounterpartyListRow {
  return {
    id: supplierSnapshotId(name),
    source: "supplier",
    name,
    displayName: name,
    fullName: "",
    category: "SUPPLIER",
    legalForm: "",
    status: "ACTIVE",
    phone: "",
    additionalPhone: "",
    email: "",
    companyType: "supplier",
    counterpartyTypeName: "Поставщик из карточек товаров",
    legalTitle: name,
    legalLastName: "",
    legalFirstName: "",
    legalMiddleName: "",
    legalAddress: "",
    actualAddress: "",
    contactPerson: "",
    contactPhone: "",
    bankDetailsJson: null,
    inn: "",
    kpp: "",
    okpo: "",
    fax: "",
    bik: "",
    bankName: "",
    bankLocation: "",
    correspondentAccount: "",
    checkingAccount: "",
    ogrn: "",
    ogrnip: "",
    certificateNumber: "",
    certificateDate: "",
    comment: "",
    supplierProductCount: 0,
    vehiclePlate: "",
    vehicleVin: "",
    vehicleModel: "",
    vehicleYear: "",
    vehicleLabel: "",
    createdAt: "",
    updatedAt: "",
    searchText: buildCounterpartySearchText({
      name,
      legalTitle: name,
      counterpartyTypeName: "Поставщик из карточек товаров",
      companyType: "supplier",
    }),
    archived: false,
    meta: localMeta("supplier", supplierSnapshotId(name)),
  };
}

type CounterpartyActivity = {
  demandCount: number;
  totalDemandSumCents: number;
  lastDemandName: string;
  lastDemandAt: string;
  lastDemandSumCents: number | null;
  recentDemands: Array<{
    id: string;
    name: string;
    momentAt: string;
    sumCents: number;
    applicable: boolean;
  }>;
  vehicleCount: number;
  vehicleLabel: string;
  vehiclePlate: string;
  vehicleVin: string;
  crmSearchText: string;
};

type CounterpartyCrmRow = CounterpartyListRow & CounterpartyActivity;

type ActivityBuilder = CounterpartyActivity & {
  vehicleKeys: Set<string>;
  searchParts: string[];
};

type SnapshotCounterpartyBuilder = {
  key: string;
  id: string | null;
  name: string;
  phone: string;
  normalizedPhone: string;
  demandCount: number;
  totalDemandSumCents: number;
  lastDemandName: string;
  lastDemandAt: string;
  lastDemandSumCents: number | null;
  vehicleKeys: Set<string>;
  vehicleLabel: string;
  vehiclePlate: string;
  vehicleVin: string;
  searchParts: string[];
};

function emptyCounterpartyActivity(): CounterpartyActivity {
  return {
    demandCount: 0,
    totalDemandSumCents: 0,
    lastDemandName: "",
    lastDemandAt: "",
    lastDemandSumCents: null,
    recentDemands: [],
    vehicleCount: 0,
    vehicleLabel: "",
    vehiclePlate: "",
    vehicleVin: "",
    crmSearchText: "",
  };
}

function localCounterpartyIdFromHref(href: string | null | undefined) {
  const match = href?.match(/\/entity\/counterparty\/([^/?#]+)/);
  return match?.[1] ?? null;
}

function phonesFromAnalyticsRaw(raw: unknown) {
  if (Array.isArray(raw)) return phoneValuesFromUnknown(raw);
  const record = jsonRecord(raw);
  return [...phoneValuesFromUnknown(record.candidates), ...phoneValuesFromUnknown(record.phones)];
}

function phoneValuesFromUnknown(value: unknown) {
  const values = Array.isArray(value) ? value : [];
  return values
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (item && typeof item === "object") {
        const record = item as Record<string, unknown>;
        return String(record.phone ?? record.value ?? record.name ?? "").trim();
      }
      return String(item ?? "").trim();
    })
    .filter(Boolean);
}

function snapshotKey(input: { id?: string | null; normalizedPhone?: string | null; name?: string | null }) {
  if (input.id) return `legacy:${input.id}`;
  if (input.normalizedPhone) return `phone:${input.normalizedPhone}`;
  const name = normalizeSearchText(input.name ?? "");
  return name ? `name:${name}` : "";
}

function ensureSnapshotBuilder(
  builders: Map<string, SnapshotCounterpartyBuilder>,
  input: { id?: string | null; name?: string | null; phone?: string | null; normalizedPhone?: string | null }
) {
  const name = input.name?.trim() ?? "";
  const phone = input.phone?.trim() ?? "";
  const normalizedPhone = input.normalizedPhone?.trim() || normalizePhoneKey(phone) || "";
  const key = snapshotKey({ id: input.id, normalizedPhone, name });
  if (!key || (!name && !phone && !normalizedPhone)) return null;

  const existing = builders.get(key);
  if (existing) {
    if (!existing.name && name) existing.name = name;
    if (!existing.phone && phone) existing.phone = phone;
    if (!existing.normalizedPhone && normalizedPhone) existing.normalizedPhone = normalizedPhone;
    if (!existing.id && input.id) existing.id = input.id;
    return existing;
  }

  const builder: SnapshotCounterpartyBuilder = {
    key,
    id: input.id ?? null,
    name: name || phone || normalizedPhone,
    phone: phone || normalizedPhone,
    normalizedPhone,
    demandCount: 0,
    totalDemandSumCents: 0,
    lastDemandName: "",
    lastDemandAt: "",
    lastDemandSumCents: null,
    vehicleKeys: new Set<string>(),
    vehicleLabel: "",
    vehiclePlate: "",
    vehicleVin: "",
    searchParts: [],
  };
  builders.set(key, builder);
  return builder;
}

function addSnapshotDemand(
  builder: SnapshotCounterpartyBuilder,
  input: {
    demandName: string;
    momentAt: Date;
    sumCents: number;
    searchParts?: unknown[];
    vehicle?: ReturnType<typeof demandVehicleInfo>;
  }
) {
  const moment = input.momentAt.toISOString();
  builder.demandCount += 1;
  builder.totalDemandSumCents += input.sumCents;
  builder.searchParts.push(input.demandName, ...(input.searchParts ?? []).map((part) => String(part ?? "").trim()).filter(Boolean));

  if (!builder.lastDemandAt || input.momentAt.getTime() > new Date(builder.lastDemandAt).getTime()) {
    builder.lastDemandName = input.demandName;
    builder.lastDemandAt = moment;
    builder.lastDemandSumCents = input.sumCents;
  }

  const vehicle = input.vehicle;
  if (!vehicle?.label && !vehicle?.plate && !vehicle?.vin) return;
  builder.searchParts.push(vehicle.label, vehicle.plate, vehicle.vin, vehicle.model, vehicle.year);
  const vehicleKey = [vehicle.vin, vehicle.plate, vehicle.model, vehicle.year].filter(Boolean).join("|");
  if (vehicleKey && !builder.vehicleKeys.has(vehicleKey)) {
    builder.vehicleKeys.add(vehicleKey);
    if (!builder.vehicleLabel) {
      builder.vehicleLabel = vehicle.label;
      builder.vehiclePlate = vehicle.plate;
      builder.vehicleVin = vehicle.vin;
    }
  }
}

function snapshotBuilderMatchesExisting(builder: SnapshotCounterpartyBuilder, existingRows: CounterpartyListRow[]) {
  const normalizedName = normalizeSearchText(builder.name);
  return existingRows.some((row) => {
    if (builder.id && row.id === builder.id) return true;
    if (builder.normalizedPhone) {
      const rowPhones = [row.phone, row.additionalPhone].map(normalizePhoneKey).filter(Boolean);
      if (rowPhones.includes(builder.normalizedPhone)) return true;
    }
    return !builder.normalizedPhone && normalizedName && normalizeSearchText(row.name) === normalizedName;
  });
}

function mapSnapshotCounterparty(builder: SnapshotCounterpartyBuilder): CounterpartyCrmRow {
  const companyType = builder.normalizedPhone || builder.phone ? "individual" : "legal";
  const createdAt = builder.lastDemandAt || new Date(0).toISOString();
  const searchText = buildCounterpartySearchText({
    name: builder.name,
    phone: builder.phone,
    counterpartyTypeName: "Клиент из импортированных отгрузок",
    companyType,
    extraSearchText: buildSearchText([
      builder.normalizedPhone,
      builder.lastDemandName,
      builder.vehicleLabel,
      builder.vehiclePlate,
      builder.vehicleVin,
      ...builder.searchParts,
    ]),
  });

  return {
    id: `snapshot:${builder.key}`,
    source: "snapshot",
    name: builder.name,
    displayName: builder.name,
    fullName: "",
    category: "INDIVIDUAL",
    legalForm: "",
    status: "ACTIVE",
    phone: builder.phone,
    additionalPhone: "",
    email: "",
    companyType,
    counterpartyTypeName: "Клиент из импортированных отгрузок",
    legalTitle: "",
    legalLastName: "",
    legalFirstName: "",
    legalMiddleName: "",
    legalAddress: "",
    actualAddress: "",
    contactPerson: "",
    contactPhone: "",
    bankDetailsJson: null,
    inn: "",
    kpp: "",
    okpo: "",
    fax: "",
    bik: "",
    bankName: "",
    bankLocation: "",
    correspondentAccount: "",
    checkingAccount: "",
    ogrn: "",
    ogrnip: "",
    certificateNumber: "",
    certificateDate: "",
    comment: "",
    supplierProductCount: 0,
    vehiclePlate: builder.vehiclePlate,
    vehicleVin: builder.vehicleVin,
    vehicleModel: "",
    vehicleYear: "",
    vehicleLabel: builder.vehicleLabel,
    createdAt,
    updatedAt: createdAt,
    searchText,
    archived: false,
    meta: localMeta("counterparty-snapshot", builder.key),
    demandCount: builder.demandCount,
    totalDemandSumCents: builder.totalDemandSumCents,
    lastDemandName: builder.lastDemandName,
    lastDemandAt: builder.lastDemandAt,
    lastDemandSumCents: builder.lastDemandSumCents,
    recentDemands: [],
    vehicleCount: builder.vehicleKeys.size,
    crmSearchText: buildSearchText(builder.searchParts),
  };
}

async function getDemandSnapshotCounterpartyRows(branchId: string, existingRows: CounterpartyListRow[]): Promise<CounterpartyCrmRow[]> {
  const builders = new Map<string, SnapshotCounterpartyBuilder>();

  try {
    const demands = await prisma.localDemand.findMany({
      where: {
        branchId,
        OR: [
          { counterpartyId: { not: null } },
          { agentNameSnapshot: { not: null } },
        ],
      },
      select: {
        name: true,
        momentAt: true,
        sumCents: true,
        description: true,
        counterpartyId: true,
        agentNameSnapshot: true,
        attributes: true,
        raw: true,
      },
      orderBy: { momentAt: "desc" },
      take: 20_000,
    });

    for (const demand of demands) {
      const raw = jsonRecord(demand.raw);
      const agent = jsonRecord(raw.agent);
      const rawPhones = [
        stringFromRecord(agent, "phone"),
        ...phoneValuesFromUnknown(agent.phones),
      ].filter(Boolean);
      const phone = rawPhones[0] ?? "";
      const builder = ensureSnapshotBuilder(builders, {
        id: demand.counterpartyId,
        name: demand.agentNameSnapshot || stringFromRecord(agent, "name"),
        phone,
        normalizedPhone: normalizePhoneKey(phone),
      });
      if (!builder) continue;
      addSnapshotDemand(builder, {
        demandName: demand.name,
        momentAt: demand.momentAt,
        sumCents: demand.sumCents,
        searchParts: [demand.description ?? "", phone, normalizePhoneKey(phone)],
        vehicle: demandVehicleInfo(demand.attributes),
      });
    }
  } catch {
    // The CRM list should still work when the local demand mirror is not available yet.
  }

  return [...builders.values()]
    .filter((builder) => !snapshotBuilderMatchesExisting(builder, existingRows))
    .map(mapSnapshotCounterparty);
}

function jsonArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
}

function attributeValueText(value: unknown): string {
  if (Array.isArray(value)) return value.map(attributeValueText).filter(Boolean).join(" ");
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return String(record.name ?? record.value ?? "").trim();
  }
  return String(value ?? "").trim();
}

function attrByName(attributes: unknown, matcher: RegExp): string {
  for (const attr of jsonArray(attributes)) {
    const name = String(attr.name ?? "").trim();
    if (matcher.test(name)) return attributeValueText(attr.value);
  }
  return "";
}

function demandVehicleInfo(attributes: unknown) {
  const plate = attrByName(attributes, /гос|г\/н|госномер|г\.\s*н|номер\s*(тс|а\/м|авто)|state\s*reg|plate/i);
  const vin = attrByName(attributes, /vin|вин/i);
  const model = attrByName(attributes, /модель|марка|авто|vehicle|car/i);
  const year = attrByName(attributes, /^год$|год\s*вып|year/i);
  const label = compactCounterpartyVehicleLabel({
    vehiclePlate: plate,
    vehicleVin: vin,
    vehicleModel: model,
    vehicleYear: year,
  });
  return { plate, vin, model, year, label };
}

async function buildCounterpartyActivity(branchId: string, rows: CounterpartyListRow[]) {
  const ids = [...new Set(rows.map((row) => row.id).filter((id) => !supplierSnapshotNameFromId(id)))];
  const byId = new Map<string, ActivityBuilder>();
  for (const id of ids) {
    byId.set(id, { ...emptyCounterpartyActivity(), vehicleKeys: new Set<string>(), searchParts: [] });
  }
  if (ids.length === 0) return byId;

  const demands = await prisma.localDemand.findMany({
    where: { branchId, counterpartyId: { in: ids } },
    select: {
      counterpartyId: true,
      id: true,
      name: true,
      momentAt: true,
      sumCents: true,
      applicable: true,
      description: true,
      attributes: true,
    },
    orderBy: [{ momentAt: "desc" }],
  });

  for (const demand of demands) {
    if (!demand.counterpartyId) continue;
    const activity = byId.get(demand.counterpartyId);
    if (!activity) continue;

    activity.demandCount += 1;
    activity.totalDemandSumCents += demand.sumCents ?? 0;
    activity.searchParts.push(demand.name, demand.description ?? "");
    if (activity.recentDemands.length < 5) {
      activity.recentDemands.push({
        id: demand.id ?? demand.id,
        name: demand.name,
        momentAt: demand.momentAt.toISOString(),
        sumCents: demand.sumCents ?? 0,
        applicable: demand.applicable,
      });
    }

    if (!activity.lastDemandAt) {
      activity.lastDemandName = demand.name;
      activity.lastDemandAt = demand.momentAt.toISOString();
      activity.lastDemandSumCents = demand.sumCents;
    }

    const vehicle = demandVehicleInfo(demand.attributes);
    activity.searchParts.push(vehicle.label, vehicle.plate, vehicle.vin, vehicle.model, vehicle.year);
    const vehicleKey = [vehicle.vin, vehicle.plate, vehicle.model, vehicle.year].filter(Boolean).join("|");
    if (vehicleKey && !activity.vehicleKeys.has(vehicleKey)) {
      activity.vehicleKeys.add(vehicleKey);
      activity.vehicleCount = activity.vehicleKeys.size;
      if (!activity.vehicleLabel) {
        activity.vehicleLabel = vehicle.label;
        activity.vehiclePlate = vehicle.plate;
        activity.vehicleVin = vehicle.vin;
      }
    }
  }

  for (const activity of byId.values()) {
    activity.crmSearchText = buildSearchText(activity.searchParts);
  }
  return byId;
}

async function enrichCounterpartyRows(branchId: string, rows: CounterpartyListRow[]): Promise<CounterpartyCrmRow[]> {
  const supplierIds = rows.filter((row) => row.category === "SUPPLIER").map((row) => row.id);
  const [activityById, supplierProductGroups] = await Promise.all([
    buildCounterpartyActivity(branchId, rows),
    supplierIds.length
      ? prisma.localProduct.groupBy({
          by: ["supplierCounterpartyId"],
          where: { branchId, supplierCounterpartyId: { in: supplierIds } },
          _count: { _all: true },
        })
      : [],
  ]);
  const supplierProductCounts = new Map(
    supplierProductGroups
      .filter((group) => group.supplierCounterpartyId)
      .map((group) => [group.supplierCounterpartyId!, group._count._all])
  );
  return rows.map((row) => {
    const activity = activityById.get(row.id) ?? ({ ...emptyCounterpartyActivity(), vehicleKeys: new Set<string>(), searchParts: [] } as ActivityBuilder);
    const storedVehicleLabel = row.vehicleLabel || compactCounterpartyVehicleLabel(row);
    const hasStoredVehicle = Boolean(storedVehicleLabel || row.vehiclePlate || row.vehicleVin);
    const vehicleCount = activity.vehicleCount || (hasStoredVehicle ? 1 : 0);
    const vehicleLabel = activity.vehicleLabel || storedVehicleLabel;
    const vehiclePlate = activity.vehiclePlate || row.vehiclePlate;
    const vehicleVin = activity.vehicleVin || row.vehicleVin;
    return {
      ...row,
      supplierProductCount: supplierProductCounts.get(row.id) ?? row.supplierProductCount,
      demandCount: activity.demandCount,
      totalDemandSumCents: activity.totalDemandSumCents,
      lastDemandName: activity.lastDemandName,
      lastDemandAt: activity.lastDemandAt,
      lastDemandSumCents: activity.lastDemandSumCents,
      recentDemands: activity.recentDemands,
      vehicleCount,
      vehicleLabel,
      vehiclePlate,
      vehicleVin,
      crmSearchText: buildSearchText([
        activity.crmSearchText,
        row.comment,
        row.additionalPhone,
        row.vehiclePlate,
        row.vehicleVin,
        row.vehicleModel,
        row.vehicleYear,
        storedVehicleLabel,
      ]),
    };
  });
}

function hasCounterpartyRequisites(row: CounterpartyListRow) {
  return Boolean(
    row.legalTitle ||
      row.inn ||
      row.kpp ||
      row.okpo ||
      row.ogrn ||
      row.ogrnip ||
      row.checkingAccount ||
      row.correspondentAccount ||
      row.bik ||
      row.bankName ||
      row.legalAddress
  );
}

function counterpartyStats(rows: CounterpartyListRow[]) {
  return {
    total: rows.length,
    active: rows.filter((row) => !row.archived).length,
    archived: rows.filter((row) => row.archived).length,
    individuals: rows.filter((row) => row.category === "INDIVIDUAL").length,
    companies: rows.filter((row) => row.category === "SUPPLIER").length,
    noPhone: rows.filter((row) => !row.phone && !row.additionalPhone).length,
    noRequisites: rows.filter((row) => !hasCounterpartyRequisites(row)).length,
  };
}

async function fastCounterpartyStats(branchId: string) {
  const requisitesMissing: Prisma.LocalCounterpartyWhereInput = {
    AND: [
      { OR: [{ legalTitle: null }, { legalTitle: "" }] },
      { OR: [{ inn: null }, { inn: "" }] },
      { OR: [{ kpp: null }, { kpp: "" }] },
      { OR: [{ okpo: null }, { okpo: "" }] },
      { OR: [{ ogrn: null }, { ogrn: "" }] },
      { OR: [{ ogrnip: null }, { ogrnip: "" }] },
      { OR: [{ checkingAccount: null }, { checkingAccount: "" }] },
      { OR: [{ correspondentAccount: null }, { correspondentAccount: "" }] },
      { OR: [{ bik: null }, { bik: "" }] },
      { OR: [{ bankName: null }, { bankName: "" }] },
      { OR: [{ legalAddress: null }, { legalAddress: "" }] },
    ],
  };
  const [total, active, archived, individuals, noPhone, noRequisites] = await Promise.all([
    prisma.localCounterparty.count({ where: { branchId } }),
    prisma.localCounterparty.count({ where: { branchId, archived: false } }),
    prisma.localCounterparty.count({ where: { branchId, archived: true } }),
    prisma.localCounterparty.count({ where: { branchId, category: "INDIVIDUAL" } }),
    prisma.localCounterparty.count({ where: { branchId, AND: [{ OR: [{ phone: null }, { phone: "" }] }, { archived: false }] } }),
    prisma.localCounterparty.count({ where: { branchId, AND: [{ archived: false }, requisitesMissing] } }),
  ]);
  return {
    total,
    active,
    archived,
    individuals,
    companies: Math.max(0, total - individuals),
    noPhone,
    noRequisites,
  };
}

export async function listLocalAdminProducts(params: {
  branchId: string;
  search?: string;
  limit?: number;
  offset?: number;
  includeArchived?: boolean;
  sort?: string;
  direction?: string;
  brand?: MultiProductFilterValue;
  sae?: MultiProductFilterValue;
  supplier?: MultiProductFilterValue;
  group?: MultiProductFilterValue;
  entityType?: MultiProductFilterValue;
  apiSpec?: MultiProductFilterValue;
  acea?: MultiProductFilterValue;
  packageVolume?: MultiProductFilterValue;
  stock?: string;
  markingProblems?: boolean;
}) {
  const searchQuery = parseSearchQuery(params.search);
  const limit = Math.min(100, Math.max(1, params.limit ?? 30));
  const offset = Math.max(0, params.offset ?? 0);
  const sort = normalizeProductSort(params.sort);
  const direction = normalizeSortDirection(params.direction);
  const filterParams: ProductFilterParams = {
    brand: params.brand,
    sae: params.sae,
    supplier: params.supplier,
    group: params.group,
    entityType: params.entityType,
    apiSpec: params.apiSpec,
    acea: params.acea,
    packageVolume: params.packageVolume,
    stock: normalizeStockFilter(params.stock),
    markingProblems: params.markingProblems === true,
  };
  const allRows = await getProductRowsForAdmin(params.branchId, params.includeArchived);
  const searchRows = allRows.filter((row) => rowMatchesSearch(row, searchQuery));
  const facets = buildProductFacets(searchRows, filterParams);
  const filteredProducts = searchRows
    .filter((row) => rowMatchesProductFilters(row, filterParams))
    .sort((a, b) => compareProductsForSearch(a, b, searchQuery, sort, direction));
  const total = filteredProducts.length;
  const pageRows = filteredProducts.slice(offset, offset + limit);
  const pageIds = pageRows.map((row) => row.id);
  const fullPageProducts = pageIds.length
    ? await prisma.localProduct.findMany({
        where: { branchId: params.branchId, id: { in: pageIds } },
        include: productWithStockInclude,
      })
    : [];
  const fullPageById = new Map(fullPageProducts.map((product) => [product.id, mapProduct(product)]));
  const pageProducts = pageRows.flatMap((row) => {
    const product = fullPageById.get(row.id);
    return product ? [product] : [];
  });
  const filterOptions: ProductFilterOptions = {
    brands: facets.brands.map((item) => item.value),
    sae: facets.sae.map((item) => item.value),
    suppliers: facets.suppliers.map((item) => item.value),
    groups: facets.groups.map((item) => item.value),
    entityTypes: facets.entityTypes.map((item) => item.value),
    apiSpecs: facets.apiSpecs.map((item) => item.value),
    acea: facets.acea.map((item) => item.value),
    packageVolumes: facets.packageVolumes.map((item) => item.value),
  };

  const hasMore = offset + limit < total;
  return {
    meta: {
      total,
      hasMore,
      limit,
      offset,
      sort,
      direction,
      filters: {
        brand: cleanFilterValues(params.brand),
        sae: cleanFilterValues(params.sae),
        supplier: cleanFilterValues(params.supplier),
        group: cleanFilterValues(params.group),
        entityType: cleanFilterValues(params.entityType),
        apiSpec: cleanFilterValues(params.apiSpec),
        acea: cleanFilterValues(params.acea),
        packageVolume: cleanFilterValues(params.packageVolume),
        stock: normalizeStockFilter(params.stock),
        markingProblems: params.markingProblems === true,
      },
      filterOptions,
      facets,
    },
    products: pageProducts,
  };
}

function normalizeRestockMode(value?: string): LocalRestockMode {
  return value === "outflow" ? "outflow" : "below_min";
}

function localDateKey(date = new Date()) {
  const timezone = process.env.APP_TIMEZONE?.trim() || "Europe/Kaliningrad";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : date.toISOString().slice(0, 10);
}

function isDateKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function formatRestockDateLabel(dateFrom: string, dateTo: string) {
  const label = (value: string) => value.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$3.$2.$1");
  return dateFrom === dateTo ? label(dateFrom) : `${label(dateFrom)}-${label(dateTo)}`;
}

function restockItemFromLocalProduct(
  product: RestockProductWithStock,
  spentInPeriod?: number
): LocalRestockNeedItem | null {
  if (!isStockTrackedType(product.entityType)) return null;
  const minimumBalance = decimalToNullableNumber(product.minimumBalance);
  if (minimumBalance == null || minimumBalance <= 0) return null;
  const stockRows = product.stockBalances.map((balance) => ({
    quantity: decimalToNumber(balance.quantity),
    reserve: decimalToNumber(balance.reserve),
    available: decimalToNumber(balance.available),
  }));
  const stock = stockRows.reduce((sum, row) => sum + row.available, 0);
  const shortageValue = minimumBalance - stock;
  if (shortageValue <= 0) return null;
  return {
    productId: product.id,
    name: product.name,
    code: product.rosskoPartNumber || product.article || product.code || product.externalCode || null,
    group: product.groupPath || null,
    supplier: supplierDisplayName(product) || product.supplierAttribute || null,
    minimumBalance,
    stock,
    reserve: stockRows.reduce((sum, row) => sum + row.reserve, 0),
    inTransit: 0,
    quantity: stockRows.reduce((sum, row) => sum + row.quantity, 0),
    shortage: shortageValue,
    ...(spentInPeriod != null ? { spentInPeriod } : {}),
  };
}

function compareRestockItems(a: LocalRestockNeedItem, b: LocalRestockNeedItem, mode: LocalRestockMode) {
  if (mode === "outflow") {
    const spentDiff = (b.spentInPeriod ?? 0) - (a.spentInPeriod ?? 0);
    if (spentDiff !== 0) return spentDiff;
  }
  const shortageDiff = b.shortage - a.shortage;
  if (shortageDiff !== 0) return shortageDiff;
  return ruCollator.compare(a.name ?? "", b.name ?? "");
}

async function aggregateLocalOutflowByProduct(dateFrom: string, dateTo: string) {
  const [demands, writeoffs] = await Promise.all([
    prisma.localDemandPosition.groupBy({
      by: ["productId"],
      where: {
        productId: { not: null },
        demand: {
          applicable: true,
          documentDate: { gte: dateFrom, lte: dateTo },
        },
      },
      _sum: { quantity: true },
    }),
    prisma.localInventoryDocumentPosition.groupBy({
      by: ["productId"],
      where: {
        productId: { not: null },
        document: {
          type: "writeoff",
          applicable: true,
          isDeleted: false,
          status: { not: "cancelled" },
          documentDate: { gte: dateFrom, lte: dateTo },
        },
      },
      _sum: { quantity: true },
    }),
  ]);

  const totals = new Map<string, number>();
  for (const row of [...demands, ...writeoffs]) {
    if (!row.productId) continue;
    const quantity = row._sum.quantity?.toNumber() ?? 0;
    if (quantity <= 0) continue;
    totals.set(row.productId, (totals.get(row.productId) ?? 0) + quantity);
  }
  return totals;
}

async function getRestockProductsForAdmin() {
  return prisma.localProduct.findMany({
    where: { archived: false },
    include: restockProductInclude,
    orderBy: [{ name: "asc" }],
  });
}

export async function listLocalRestockNeeds(params: {
  mode?: string;
  refresh?: boolean;
  dateFrom?: string | null;
  dateTo?: string | null;
}): Promise<LocalRestockNeedsList> {
  const branchId = getScopedBranchId();
  const mode = normalizeRestockMode(params.mode);
  const timezone = process.env.APP_TIMEZONE?.trim() || "Europe/Kaliningrad";
  const rawDateFrom = params.dateFrom?.trim() || "";
  const rawDateTo = params.dateTo?.trim() || "";
  const dateFrom = mode === "outflow" ? rawDateFrom || localDateKey() : undefined;
  const dateTo = mode === "outflow" ? rawDateTo || dateFrom : undefined;

  if (mode === "outflow") {
    if (!dateFrom || !dateTo || !isDateKey(dateFrom) || !isDateKey(dateTo)) {
      throw new Error("Некорректный период: укажите даты в формате YYYY-MM-DD");
    }
    if (dateFrom > dateTo) throw new Error("Дата начала не может быть позже даты окончания");
  }

  const cacheKey = JSON.stringify({ branchId, mode, dateFrom, dateTo });
  const now = Date.now();
  if (params.refresh) {
    invalidateProductFilterOptions();
    invalidateRestockNeedsLists();
  }
  const cached = inventoryListsCache.restockNeeds.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.value;

  const rows = await getRestockProductsForAdmin();
  const outflowByProduct = mode === "outflow" && dateFrom && dateTo
    ? await aggregateLocalOutflowByProduct(dateFrom, dateTo)
    : new Map<string, number>();

  const items = rows
    .map((row) => restockItemFromLocalProduct(row, mode === "outflow" ? outflowByProduct.get(row.id) ?? 0 : undefined))
    .filter((item): item is LocalRestockNeedItem => {
      if (!item) return false;
      return mode !== "outflow" || (item.spentInPeriod ?? 0) > 0;
    })
    .sort((a, b) => compareRestockItems(a, b, mode));

  const value: LocalRestockNeedsList = {
    ok: true,
    rule: mode === "outflow" ? "below_min_with_period_outflow" : "below_min",
    source: "local",
    timezone,
    ...(mode === "outflow" && dateFrom && dateTo
      ? {
          dateLabel: formatRestockDateLabel(dateFrom, dateTo),
          dateFrom,
          dateTo,
          note: "Расход считается по локальным отгрузкам и списаниям за выбранный период.",
        }
      : {}),
    items,
    fetchedRows: rows.length,
    catalogSize: rows.length,
  };

  inventoryListsCache.restockNeeds.set(cacheKey, {
    key: cacheKey,
    expiresAt: now + LOCAL_RESTOCK_NEEDS_CACHE_MS,
    value,
  });
  return value;
}

export async function createLocalAdminProduct(
  body: ProductInput,
  actor: ActingUser | null | undefined,
  branchId: string,
  options: { transaction?: Prisma.TransactionClient } = {},
) {
  const name = body.name?.trim() ?? "";
  if (!name) return { ok: false as const, error: "Укажите название товара" };
  const entityType = body.entityType?.trim() || "product";
  const article = body.article?.trim() || null;
  const code = body.code?.trim() || null;
  const externalCode = cleanText(body.externalCode);
  const groupPath = cleanText(body.groupPath);
  const uomName = cleanText(body.uomName);
  const currencyName = body.currencyName?.trim() || "руб.";
  const barcodeEan13 = cleanText(body.barcodeEan13);
  const barcodeEan8 = cleanText(body.barcodeEan8);
  const barcodeCode128 = cleanText(body.barcodeCode128);
  const description = cleanText(body.description);
  const minPriceCurrencyName = cleanText(body.minPriceCurrencyName);
  const countryName = cleanText(body.countryName);
  const vatLabel = cleanText(body.vatLabel);
  const supplierResult = await resolveProductSupplierCounterparty(body.supplierCounterpartyId, branchId, options);
  if (!supplierResult.ok) return supplierResult;
  const supplierCounterpartyId = supplierResult.id ?? null;
  const legacySupplierName = cleanText(body.legacySupplierName);
  const modificationCode = cleanText(body.modificationCode);
  const tnvedCode = cleanText(body.tnvedCode);
  const sae = cleanText(body.sae);
  const oem = cleanText(body.oem);
  const acea = cleanText(body.acea);
  const apiSpec = cleanText(body.apiSpec);
  const packageVolume = cleanText(body.packageVolume);
  const brand = cleanText(body.brand);
  const atf = cleanText(body.atf);
  const ilsac = cleanText(body.ilsac);
  const aceaExtra = cleanText(body.aceaExtra);
  const oemAtf = cleanText(body.oemAtf);
  const legacyMannName = cleanText(body.mannName);
  const rosskoPartNumber = cleanText(body.rosskoPartNumber);
  const rosskoBrand = cleanText(body.rosskoBrand);
  const rosskoMin = cleanText(body.rosskoMin);
  const supplierAttribute = cleanText(body.supplierAttribute);
  const oemParts = mergeProductCrossReferences(cleanText(body.oemParts), [legacyMannName]);
  const cell = cleanText(body.cell);
  const mannCharacteristicName = cleanText(body.mannCharacteristicName);
  const marking = normalizeProductMarkingData(body, undefined, uomName, groupPath);
  if (!marking.ok) return { ok: false as const, error: marking.error };
  const markingConfiguredManually = booleanFromInput(body.markingConfiguredManually) === true;
  const client = options.transaction ?? prisma;
  const product = await client.localProduct.create({
    data: {
      branchId,
      name,
      entityType,
      article,
      code,
      externalCode,
      groupPath,
      uomName,
      salePriceCents: centsFromRub(body.salePrice),
      buyPriceCents: body.buyPrice == null ? null : centsFromRub(body.buyPrice),
      currencyName,
      minimumBalance: decimalFromInput(body.minimumBalance),
      barcodeEan13,
      barcodeEan8,
      barcodeCode128,
      description,
      minPriceCents: nullableCentsFromRub(body.minPrice),
      minPriceCurrencyName,
      countryName,
      vatLabel,
      legacySupplierName,
      supplierCounterpartyId,
      weight: decimalFromInput(body.weight),
      volume: decimalFromInput(body.volume),
      modificationCode,
      tnvedCode,
      sae,
      oem,
      acea,
      apiSpec,
      packageVolume,
      avito: booleanFromInput(body.avito),
      brand,
      atf,
      ilsac,
      aceaExtra,
      oemAtf,
      mannName: null,
      rosskoPartNumber,
      rosskoBrand,
      rosskoMin,
      supplierAttribute,
      oemParts,
      cell,
      mannCharacteristicName,
      markingEnabled: marking.data.markingEnabled,
      markingMode: marking.data.markingMode,
      markingStatus: marking.data.markingStatus,
      markingSettings: marking.data.markingSettings == null ? Prisma.JsonNull : toJson(marking.data.markingSettings),
      markingConfiguredManually,
      markingConfiguredAt: markingConfiguredManually ? new Date() : null,
      markingConfiguredByLogin: markingConfiguredManually ? actor?.login ?? null : null,
      searchText: buildProductSearchText({
        name,
        article,
        code,
        externalCode,
        groupPath,
        barcodeEan13,
        barcodeEan8,
        barcodeCode128,
        description,
        supplierName: supplierResult.name ?? "",
        tnvedCode,
        sae,
        oem,
        acea,
        apiSpec,
        packageVolume,
        brand,
        atf,
        ilsac,
        aceaExtra,
        oemAtf,
        rosskoPartNumber,
        rosskoBrand,
        rosskoMin,
        supplierAttribute,
        oemParts,
        cell,
        mannCharacteristicName,
        entityType,
        currencyName,
      }),
      raw: toJson(body),
      syncedAt: new Date(),
    },
    include: productWithStockInclude,
  });
  if (productPayloadHasMarkingSettings(body)) {
    await writeProductMarkingAudit({
      productId: product.id,
      oldValue: productMarkingSnapshot({
        markingEnabled: false,
        markingMode: "NOT_MARKED",
        markingStatus: "NOT_MARKED",
        markingSettings: null,
      }),
      newValue: productMarkingSnapshot(product),
      actor,
      transaction: options.transaction,
    });
  }
  invalidateProductFilterOptions();
  invalidateRestockNeedsLists();
  invalidateLocalInventoryFinanceCache();
  return { ok: true as const, product: mapProduct(product) };
}

export async function updateLocalAdminProduct(id: string, body: ProductInput, actor: ActingUser | null | undefined, branchId: string) {
  const current = await prisma.localProduct.findFirst({ where: { branchId, OR: [{ id }, { id: id }] } });
  if (!current) return { ok: false as const, error: "Товар не найден", notFound: true };
  const name = body.name == null ? current.name : body.name.trim();
  if (!name) return { ok: false as const, error: "Укажите название товара" };
  const entityType = body.entityType == null ? current.entityType : body.entityType.trim() || "product";
  const article = body.article == null ? current.article : body.article.trim() || null;
  const code = body.code == null ? current.code : body.code.trim() || null;
  const externalCode = body.externalCode === undefined ? current.externalCode : cleanText(body.externalCode);
  const groupPath = body.groupPath === undefined ? current.groupPath : cleanText(body.groupPath);
  const uomName = body.uomName === undefined ? current.uomName : cleanText(body.uomName);
  const currencyName = body.currencyName == null ? current.currencyName ?? "руб." : body.currencyName.trim() || "руб.";
  const buyPriceCents = body.buyPrice === undefined
    ? current.buyPriceCents
    : body.buyPrice == null
      ? null
      : centsFromRub(body.buyPrice);
  const minimumBalance = body.minimumBalance === undefined ? current.minimumBalance : decimalFromInput(body.minimumBalance);
  const barcodeEan13 = body.barcodeEan13 === undefined ? current.barcodeEan13 : cleanText(body.barcodeEan13);
  const barcodeEan8 = body.barcodeEan8 === undefined ? current.barcodeEan8 : cleanText(body.barcodeEan8);
  const barcodeCode128 = body.barcodeCode128 === undefined ? current.barcodeCode128 : cleanText(body.barcodeCode128);
  const description = body.description === undefined ? current.description : cleanText(body.description);
  const minPriceCents = body.minPrice === undefined ? current.minPriceCents : nullableCentsFromRub(body.minPrice);
  const minPriceCurrencyName =
    body.minPriceCurrencyName === undefined ? current.minPriceCurrencyName : cleanText(body.minPriceCurrencyName);
  const countryName = body.countryName === undefined ? current.countryName : cleanText(body.countryName);
  const vatLabel = body.vatLabel === undefined ? current.vatLabel : cleanText(body.vatLabel);
  const supplierResult = await resolveProductSupplierCounterparty(
    body.supplierCounterpartyId === undefined ? current.supplierCounterpartyId : body.supplierCounterpartyId,
    branchId,
    {
    allowExistingArchivedId: current.supplierCounterpartyId,
    }
  );
  if (!supplierResult.ok) return supplierResult;
  const supplierCounterpartyId = supplierResult.id;
  const legacySupplierName = body.legacySupplierName === undefined ? current.legacySupplierName : cleanText(body.legacySupplierName);
  const weight = body.weight === undefined ? current.weight : decimalFromInput(body.weight);
  const volume = body.volume === undefined ? current.volume : decimalFromInput(body.volume);
  const modificationCode = body.modificationCode === undefined ? current.modificationCode : cleanText(body.modificationCode);
  const tnvedCode = body.tnvedCode === undefined ? current.tnvedCode : cleanText(body.tnvedCode);
  const sae = body.sae === undefined ? current.sae : cleanText(body.sae);
  const oem = body.oem === undefined ? current.oem : cleanText(body.oem);
  const acea = body.acea === undefined ? current.acea : cleanText(body.acea);
  const apiSpec = body.apiSpec === undefined ? current.apiSpec : cleanText(body.apiSpec);
  const packageVolume = body.packageVolume === undefined ? current.packageVolume : cleanText(body.packageVolume);
  const avito = body.avito === undefined ? current.avito : booleanFromInput(body.avito);
  const brand = body.brand === undefined ? current.brand : cleanText(body.brand);
  const atf = body.atf === undefined ? current.atf : cleanText(body.atf);
  const ilsac = body.ilsac === undefined ? current.ilsac : cleanText(body.ilsac);
  const aceaExtra = body.aceaExtra === undefined ? current.aceaExtra : cleanText(body.aceaExtra);
  const oemAtf = body.oemAtf === undefined ? current.oemAtf : cleanText(body.oemAtf);
  const legacyMannName = body.mannName === undefined ? current.mannName : cleanText(body.mannName);
  const rosskoPartNumber =
    body.rosskoPartNumber === undefined ? current.rosskoPartNumber : cleanText(body.rosskoPartNumber);
  const rosskoBrand = body.rosskoBrand === undefined ? current.rosskoBrand : cleanText(body.rosskoBrand);
  const rosskoMin = body.rosskoMin === undefined ? current.rosskoMin : cleanText(body.rosskoMin);
  const supplierAttribute =
    body.supplierAttribute === undefined ? current.supplierAttribute : cleanText(body.supplierAttribute);
  const oemPartsBase = body.oemParts === undefined ? current.oemParts : cleanText(body.oemParts);
  const oemParts = mergeProductCrossReferences(oemPartsBase, [legacyMannName]);
  const cell = body.cell === undefined ? current.cell : cleanText(body.cell);
  const mannCharacteristicName =
    body.mannCharacteristicName === undefined ? current.mannCharacteristicName : cleanText(body.mannCharacteristicName);
  const oldMarking = productMarkingSnapshot(current);
  const marking = normalizeProductMarkingData(body, current, uomName, groupPath);
  if (!marking.ok) return { ok: false as const, error: marking.error };
  const markingConfiguredByUser = booleanFromInput(body.markingConfiguredManually) === true;
  const markingConfiguredManually = current.markingConfiguredManually || markingConfiguredByUser;
  const product = await prisma.localProduct.update({
    where: { id: current.id },
    data: {
      name,
      entityType,
      article,
      code,
      externalCode,
      groupPath,
      uomName,
      salePriceCents: body.salePrice === undefined ? current.salePriceCents : centsFromRub(body.salePrice),
      buyPriceCents,
      currencyName,
      minimumBalance,
      barcodeEan13,
      barcodeEan8,
      barcodeCode128,
      description,
      minPriceCents,
      minPriceCurrencyName,
      countryName,
      vatLabel,
      legacySupplierName,
      supplierCounterpartyId,
      weight,
      volume,
      modificationCode,
      tnvedCode,
      sae,
      oem,
      acea,
      apiSpec,
      packageVolume,
      avito,
      brand,
      atf,
      ilsac,
      aceaExtra,
      oemAtf,
      rosskoPartNumber,
      rosskoBrand,
      rosskoMin,
      supplierAttribute,
      oemParts,
      cell,
      mannCharacteristicName,
      markingEnabled: marking.data.markingEnabled,
      markingMode: marking.data.markingMode,
      markingStatus: marking.data.markingStatus,
      markingSettings: marking.data.markingSettings == null ? Prisma.JsonNull : toJson(marking.data.markingSettings),
      markingConfiguredManually,
      markingConfiguredAt: markingConfiguredByUser ? new Date() : current.markingConfiguredAt,
      markingConfiguredByLogin: markingConfiguredByUser ? actor?.login ?? current.markingConfiguredByLogin : current.markingConfiguredByLogin,
      archived: body.archived === undefined ? current.archived : Boolean(body.archived),
      searchText: buildProductSearchText({
        name,
        article,
        code,
        externalCode,
        groupPath,
        barcodeEan13,
        barcodeEan8,
        barcodeCode128,
        description,
        supplierName: supplierResult.name ?? "",
        tnvedCode,
        sae,
        oem,
        acea,
        apiSpec,
        packageVolume,
        brand,
        atf,
        ilsac,
        aceaExtra,
        oemAtf,
        rosskoPartNumber,
        rosskoBrand,
        rosskoMin,
        supplierAttribute,
        oemParts,
        cell,
        mannCharacteristicName,
        entityType,
        currencyName,
      }),
      raw: toJson({ ...(typeof current.raw === "object" && current.raw ? current.raw : {}), lastLocalUpdate: new Date().toISOString() }),
      syncedAt: new Date(),
    },
    include: productWithStockInclude,
  });
  if (productPayloadHasMarkingSettings(body)) {
    await writeProductMarkingAudit({
      productId: product.id,
      oldValue: oldMarking,
      newValue: productMarkingSnapshot(product),
      actor,
    });
  }
  invalidateProductFilterOptions();
  invalidateRestockNeedsLists();
  invalidateLocalInventoryFinanceCache();
  return { ok: true as const, product: mapProduct(product) };
}

export async function applyBulkOilSaleMovements(
  movements: Array<{ productId: string; volumeLiters: number }>,
  actor?: ActingUser | null
) {
  for (const movement of movements) {
    if (!movement.productId || !Number.isFinite(movement.volumeLiters) || movement.volumeLiters <= 0) continue;
    const current = await prisma.localProduct.findUnique({ where: { id: movement.productId } });
    if (!current || current.markingMode !== "BULK_OIL_FROM_MARKED_BARREL" || !current.markingEnabled) continue;

    const settings = normalizeProductMarkingSettings(current.markingSettings);
    if (settings.currentVolumeLiters == null) continue;

    const oldMarking = productMarkingSnapshot(current);
    const nextSettings: ProductMarkingSettings = {
      ...settings,
      currentVolumeLiters: Math.max(0, settings.currentVolumeLiters - movement.volumeLiters),
    };
    const nextStatus = deriveProductMarkingStatus({
      markingEnabled: true,
      markingMode: "BULK_OIL_FROM_MARKED_BARREL",
      uomName: current.uomName,
      settings: nextSettings,
    });
    const updated = await prisma.localProduct.update({
      where: { id: current.id },
      data: {
        markingStatus: nextStatus,
        markingSettings: toJson(nextSettings),
      },
    });
    await writeProductMarkingAudit({
      productId: updated.id,
      oldValue: oldMarking,
      newValue: productMarkingSnapshot(updated),
      actor,
    });
  }

  if (movements.length > 0) {
    invalidateProductFilterOptions();
    invalidateRestockNeedsLists();
    invalidateLocalInventoryFinanceCache();
  }
}

export function invalidateCounterpartyRows() {
  counterpartyAdminCache.rows = null;
}

async function getCounterpartyRowsForAdmin(branchId: string, includeArchived?: boolean) {
  const key = `${branchId}:${includeArchived ? "all" : "active"}`;
  const now = Date.now();
  if (counterpartyAdminCache.rows?.key === key && counterpartyAdminCache.rows.expiresAt > now) {
    return counterpartyAdminCache.rows.rows;
  }

  const counterparties = await prisma.localCounterparty.findMany({
    where: { branchId, ...(includeArchived ? {} : { archived: false }) },
    orderBy: [{ name: "asc" }],
  });
  const rows = counterparties.map(mapCounterparty);
  counterpartyAdminCache.rows = { key, expiresAt: now + COUNTERPARTY_ROWS_CACHE_MS, rows };
  return rows;
}

async function getSupplierCounterpartyRows(branchId: string, existingRows: CounterpartyListRow[], includeArchived?: boolean) {
  const existingNames = new Set(existingRows.map((row) => normalizeSearchText(row.name)).filter(Boolean));
  return uniqueSorted((await getProductRowsForAdmin(branchId, includeArchived)).map((product) => product.supplierName), 1_000)
    .filter((name) => !existingNames.has(normalizeSearchText(name)))
    .map(mapSupplierNameCounterparty);
}

type CounterpartyStatusFilter = "active" | "archive" | "all";
type CounterpartyTypeFilter = "all" | "individual" | "supplier";
type CounterpartyPresenceFilter = "all" | "with" | "without";
type CounterpartySortKey = "name" | "createdAt" | "updatedAt" | "lastDemand";

function normalizeCounterpartyStatus(value?: string, includeArchived?: boolean): CounterpartyStatusFilter {
  if (value === "archive" || value === "all" || value === "active") return value;
  return includeArchived ? "all" : "active";
}

function normalizeCounterpartyType(value?: string): CounterpartyTypeFilter {
  return value === "individual" || value === "supplier" ? value : "all";
}

function normalizeCounterpartyCategory(value: unknown, fallback: "INDIVIDUAL" | "SUPPLIER" = "INDIVIDUAL") {
  return value === "SUPPLIER" ? "SUPPLIER" : value === "INDIVIDUAL" ? "INDIVIDUAL" : fallback;
}

function normalizeSupplierLegalForm(value: unknown) {
  return value === "LEGAL_ENTITY" || value === "SOLE_PROPRIETOR" || value === "OTHER" ? value : null;
}

function normalizePresenceFilter(value?: string): CounterpartyPresenceFilter {
  return value === "with" || value === "without" ? value : "all";
}

function normalizeCounterpartySort(value?: string): CounterpartySortKey {
  if (value === "createdAt" || value === "updatedAt" || value === "lastDemand") return value;
  return "name";
}

function counterpartyMatchesSearch(row: CounterpartyCrmRow, query: SearchQuery) {
  return normalizedSearchTextMatches([row.searchText, row.crmSearchText].join(" "), query);
}

function counterpartySearchRank(row: CounterpartyCrmRow, query: SearchQuery) {
  if (!query.normalized) return 0;
  const weightedFields: Array<[unknown, number]> = [
    [row.name, 0],
    [row.legalTitle, 2],
    [row.legalLastName, 4],
    [row.legalFirstName, 5],
    [row.legalMiddleName, 6],
    [row.inn, 8],
    [row.phone, 10],
    [normalizePhoneKey(row.phone), 10],
    [row.additionalPhone, 11],
    [normalizePhoneKey(row.additionalPhone), 11],
    [row.email, 13],
    [row.vehiclePlate, 14],
    [row.vehicleVin, 14],
    [row.lastDemandName, 16],
    [row.ogrn, 18],
    [row.ogrnip, 18],
    [row.crmSearchText, 40],
    [row.searchText, 60],
  ];

  let best = Number.POSITIVE_INFINITY;
  for (const [value, weight] of weightedFields) {
    const rank = fieldSearchRank(value, query);
    if (rank != null) best = Math.min(best, weight + rank);
  }
  return Number.isFinite(best) ? best : 10_000;
}

function compareNullableDateString(a: string | null | undefined, b: string | null | undefined, direction: SortDirection) {
  const aTime = a ? new Date(a).getTime() : NaN;
  const bTime = b ? new Date(b).getTime() : NaN;
  const aMissing = !Number.isFinite(aTime);
  const bMissing = !Number.isFinite(bTime);
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  const result = aTime - bTime;
  return direction === "asc" ? result : -result;
}

function compareCounterparties(
  a: CounterpartyCrmRow,
  b: CounterpartyCrmRow,
  query: SearchQuery,
  sort: CounterpartySortKey,
  direction: SortDirection
) {
  if (query.normalized) {
    const rankDiff = counterpartySearchRank(a, query) - counterpartySearchRank(b, query);
    if (rankDiff !== 0) return rankDiff;
  }
  let result = 0;
  if (sort === "name") result = compareText(a.name, b.name, direction);
  if (sort === "createdAt") result = compareNullableDateString(a.createdAt, b.createdAt, direction);
  if (sort === "updatedAt") result = compareNullableDateString(a.updatedAt, b.updatedAt, direction);
  if (sort === "lastDemand") result = compareNullableDateString(a.lastDemandAt, b.lastDemandAt, direction);
  if (result !== 0) return result;
  return compareText(a.name, b.name, "asc");
}

export async function listLocalAdminCounterparties(params: {
  branchId: string;
  search?: string;
  limit?: number;
  offset?: number;
  includeArchived?: boolean;
  status?: string;
  type?: string;
  phone?: string;
  requisites?: string;
  shipments?: string;
  sort?: string;
  direction?: string;
}) {
  const searchQuery = parseSearchQuery(params.search);
  const limit = Math.min(100, Math.max(1, params.limit ?? 30));
  const offset = Math.max(0, params.offset ?? 0);
  const status = normalizeCounterpartyStatus(params.status, params.includeArchived);
  const type = normalizeCounterpartyType(params.type);
  const phone = normalizePresenceFilter(params.phone);
  const requisites = normalizePresenceFilter(params.requisites);
  const shipments = normalizePresenceFilter(params.shipments);
  const sort = normalizeCounterpartySort(params.sort);
  const direction = normalizeSortDirection(params.direction);
  const where: Prisma.LocalCounterpartyWhereInput = {
    branchId: params.branchId,
    ...(status === "active" ? { archived: false } : status === "archive" ? { archived: true } : {}),
    ...(type === "individual" ? { category: "INDIVIDUAL" } : type === "supplier" ? { category: "SUPPLIER" } : {}),
    ...(phone === "with"
      ? { AND: [{ phone: { not: null } }, { NOT: { phone: "" } }] }
      : phone === "without"
        ? { OR: [{ phone: null }, { phone: "" }] }
        : {}),
    ...(searchQuery.normalized
      ? {
          OR: [
            { name: { contains: searchQuery.normalized, mode: "insensitive" } },
            { phone: { contains: searchQuery.normalized, mode: "insensitive" } },
            { email: { contains: searchQuery.normalized, mode: "insensitive" } },
            { legalTitle: { contains: searchQuery.normalized, mode: "insensitive" } },
            { inn: { contains: searchQuery.normalized, mode: "insensitive" } },
            { searchText: { contains: searchQuery.normalized, mode: "insensitive" } },
            ...(searchQuery.compact ? [{ normalizedPhone: { contains: searchQuery.compact, mode: "insensitive" as const } }] : []),
          ],
        }
      : {}),
  };
  const orderBy: Prisma.LocalCounterpartyOrderByWithRelationInput =
    sort === "createdAt" ? { createdAt: direction } : sort === "updatedAt" ? { updatedAt: direction } : { name: direction };
  const [total, baseRows, stats] = await Promise.all([
    prisma.localCounterparty.count({ where }),
    prisma.localCounterparty.findMany({
      where,
      orderBy: [orderBy, { name: "asc" }],
      skip: offset,
      take: limit,
    }),
    fastCounterpartyStats(params.branchId),
  ]);
  let filteredCounterparties = await enrichCounterpartyRows(params.branchId, baseRows.map(mapCounterparty));
  if (requisites === "with") filteredCounterparties = filteredCounterparties.filter(hasCounterpartyRequisites);
  if (requisites === "without") filteredCounterparties = filteredCounterparties.filter((row) => !hasCounterpartyRequisites(row));
  if (shipments === "with") filteredCounterparties = filteredCounterparties.filter((row) => row.demandCount > 0);
  if (shipments === "without") filteredCounterparties = filteredCounterparties.filter((row) => row.demandCount === 0);
  return {
    meta: { total, limit, offset },
    stats,
    counterparties: filteredCounterparties,
  };
}

export async function getLocalAdminCounterparty(id: string, branchId: string) {
  const cleanId = id.trim();
  if (!cleanId) return { ok: false as const, error: "id не указан", notFound: true as const };
  const counterparty = await prisma.localCounterparty.findFirst({
    where: {
      branchId,
      OR: [{ id: cleanId }, { id: cleanId }],
    },
  });
  if (!counterparty) {
    return { ok: false as const, error: "Контрагент не найден", notFound: true as const };
  }
  const [row] = await enrichCounterpartyRows(branchId, [mapCounterparty(counterparty)]);
  return { ok: true as const, counterparty: row };
}

function normalizeSupplierDuplicateValue(value: string | null | undefined) {
  return normalizeSearchText((value ?? "").replace(/[«»“”„‟]/g, '"').replace(/\s+/g, " ").trim());
}

function supplierSummary(counterparty: {
  id: string;
  name: string;
  displayName: string;
  inn: string | null;
  legalForm: string | null;
  phone: string | null;
  contactPerson: string | null;
  contactPhone: string | null;
  archived: boolean;
  status: string;
}) {
  return {
    id: counterparty.id,
    displayName: counterparty.displayName || counterparty.name,
    inn: counterparty.inn ?? "",
    legalForm: counterparty.legalForm ?? "",
    phone: counterparty.contactPhone ?? counterparty.phone ?? "",
    contactPerson: counterparty.contactPerson ?? "",
    status: counterparty.archived ? "ARCHIVED" : counterparty.status || "ACTIVE",
  };
}

export async function listActiveSuppliers(params: { branchId: string; search?: string; limit?: number }) {
  const search = params.search?.trim() ?? "";
  const limit = Math.min(100, Math.max(1, params.limit ?? 30));
  const suppliers = await prisma.localCounterparty.findMany({
    where: {
      branchId: params.branchId,
      archived: false,
      AND: [
        supplierCounterpartyIdentityWhere(),
        ...(search
          ? [{
              OR: [
                { name: { contains: search, mode: "insensitive" as const } },
                { fullName: { contains: search, mode: "insensitive" as const } },
                { inn: { contains: search, mode: "insensitive" as const } },
                { contactPerson: { contains: search, mode: "insensitive" as const } },
                { contactPhone: { contains: search, mode: "insensitive" as const } },
                { phone: { contains: search, mode: "insensitive" as const } },
                { searchText: { contains: search, mode: "insensitive" as const } },
              ],
            }]
          : []),
      ],
    },
    select: {
      id: true,
      name: true,
      displayName: true,
      inn: true,
      legalForm: true,
      phone: true,
      contactPerson: true,
      contactPhone: true,
      archived: true,
      status: true,
    },
    orderBy: [{ name: "asc" }],
    take: limit,
  });
  return { suppliers: suppliers.map(supplierSummary) };
}

export async function quickCreateSupplier(
  body: CounterpartyInput,
  branchId: string,
  options: { transaction?: Prisma.TransactionClient; rawMetadata?: Record<string, unknown> } = {},
) {
  const name = body.name?.trim() ?? "";
  if (!name) return { ok: false as const, error: "Укажите название поставщика" };
  const inn = cleanText(body.inn);
  const phone = cleanText(body.contactPhone) ?? cleanText(body.phone);
  const normalizedName = normalizeSupplierDuplicateValue(name);
  const normalizedPhone = normalizePhoneKey(phone);
  const client = options.transaction ?? prisma;
  const candidates = await client.localCounterparty.findMany({
    where: { branchId, archived: false, AND: [supplierCounterpartyIdentityWhere()] },
    select: {
      id: true,
      name: true,
      displayName: true,
      inn: true,
      legalForm: true,
      phone: true,
      contactPerson: true,
      contactPhone: true,
      archived: true,
      status: true,
    },
    orderBy: [{ updatedAt: "desc" }],
    take: 2_000,
  });
  const duplicates = candidates.filter((candidate) => {
    const nameMatches = normalizedName && normalizeSupplierDuplicateValue(candidate.name) === normalizedName;
    const innMatches = Boolean(inn && candidate.inn && inn === candidate.inn.trim());
    const candidatePhone = normalizePhoneKey(candidate.contactPhone ?? candidate.phone);
    const phoneMatches = Boolean(normalizedPhone && candidatePhone && normalizedPhone === candidatePhone);
    return nameMatches || innMatches || phoneMatches;
  });
  if (duplicates.length && !body.allowDuplicate) {
    return {
      ok: false as const,
      conflict: true as const,
      error: "Похожий поставщик уже существует",
      candidates: duplicates.map(supplierSummary),
    };
  }
  return createLocalAdminCounterparty({
    ...body,
    category: "SUPPLIER",
    companyType: "supplier",
    legalTitle: body.legalTitle ?? name,
    contactPhone: body.contactPhone ?? phone,
  }, branchId, options);
}

export async function createLocalAdminCounterparty(
  body: CounterpartyInput,
  branchId: string,
  options: { transaction?: Prisma.TransactionClient; rawMetadata?: Record<string, unknown> } = {},
) {
  const name = body.name?.trim() ?? "";
  if (!name) return { ok: false as const, error: "Укажите имя или название контрагента" };
  const category = normalizeCounterpartyCategory(body.category);
  const legalForm = category === "SUPPLIER" ? normalizeSupplierLegalForm(body.legalForm) : null;
  const fullName = cleanText(body.fullName);
  const phone = body.phone?.trim() || null;
  const additionalPhone = body.additionalPhone?.trim() || null;
  const email = body.email?.trim() || null;
  const companyType = category === "SUPPLIER" ? "supplier" : "individual";
  const legalTitle = body.legalTitle?.trim() || null;
  const counterpartyTypeName = cleanText(body.counterpartyTypeName) || (category === "SUPPLIER" ? "Поставщик" : "Физическое лицо");
  const legalLastName = cleanText(body.legalLastName);
  const legalFirstName = cleanText(body.legalFirstName);
  const legalMiddleName = cleanText(body.legalMiddleName);
  const legalAddress = cleanText(body.legalAddress);
  const actualAddress = cleanText(body.actualAddress);
  const contactPerson = cleanText(body.contactPerson);
  const contactPhone = cleanText(body.contactPhone);
  const bankDetailsJson = body.bankDetailsJson ? toJson(body.bankDetailsJson) : Prisma.JsonNull;
  const inn = cleanText(body.inn);
  const kpp = cleanText(body.kpp);
  const okpo = cleanText(body.okpo);
  const fax = cleanText(body.fax);
  const bik = cleanText(body.bik);
  const bankName = cleanText(body.bankName);
  const bankLocation = cleanText(body.bankLocation);
  const correspondentAccount = cleanText(body.correspondentAccount);
  const checkingAccount = cleanText(body.checkingAccount);
  const ogrn = cleanText(body.ogrn);
  const ogrnip = cleanText(body.ogrnip);
  const certificateNumber = cleanText(body.certificateNumber);
  const certificateDate = dateFromInput(body.certificateDate);
  const comment = cleanText(body.comment);
  const vehiclePlate = cleanText(body.vehiclePlate);
  const vehicleVin = cleanText(body.vehicleVin);
  const vehicleModel = cleanText(body.vehicleModel);
  const vehicleYear = cleanText(body.vehicleYear);
  const rawPayload = {
    ...body,
    ...(options.rawMetadata ?? {}),
    additionalPhone,
    comment,
    vehicle: {
      plate: vehiclePlate,
      vin: vehicleVin,
      model: vehicleModel,
      year: vehicleYear,
    },
  };
  const client = options.transaction ?? prisma;
  const counterparty = await client.localCounterparty.create({
    data: {
      branchId,
      name,
      displayName: name,
      category,
      legalForm,
      fullName,
      actualAddress,
      contactPerson,
      contactPhone,
      bankDetailsJson,
      status: "ACTIVE",
      phone,
      email,
      normalizedPhone: normalizePhoneKey(phone),
      phonesRaw: [phone, additionalPhone].filter(Boolean),
      companyType,
      counterpartyTypeName,
      legalTitle,
      legalLastName,
      legalFirstName,
      legalMiddleName,
      legalAddress,
      inn,
      kpp,
      okpo,
      fax,
      bik,
      bankName,
      bankLocation,
      correspondentAccount,
      checkingAccount,
      ogrn,
      ogrnip,
      certificateNumber,
      certificateDate,
      searchText: buildCounterpartySearchText({
        fullName,
        name,
        phone,
        email,
        legalTitle,
        legalLastName,
        legalFirstName,
        legalMiddleName,
        legalAddress,
        actualAddress,
        contactPerson,
        contactPhone,
        inn,
        kpp,
        okpo,
        fax,
        bik,
        bankName,
        bankLocation,
        correspondentAccount,
        checkingAccount,
        ogrn,
        ogrnip,
        certificateNumber,
        counterpartyTypeName,
        companyType,
        extraSearchText: buildSearchText([
          additionalPhone,
          normalizePhoneKey(additionalPhone),
          comment,
          vehiclePlate,
          vehicleVin,
          vehicleModel,
          vehicleYear,
        ]),
      }),
      raw: toJson(rawPayload),
      syncedAt: new Date(),
    },
  });
  invalidateCounterpartyRows();
  return { ok: true as const, counterparty: mapCounterparty(counterparty) };
}

export async function updateLocalAdminCounterparty(id: string, body: CounterpartyInput, branchId: string) {
  const current = await prisma.localCounterparty.findFirst({ where: { branchId, OR: [{ id }, { id: id }] } });
  if (!current) return { ok: false as const, error: "Контрагент не найден", notFound: true };
  const name = body.name == null ? current.name : body.name.trim();
  if (!name) return { ok: false as const, error: "Укажите имя или название контрагента" };
  const category = body.category === undefined
    ? normalizeCounterpartyCategory(current.category)
    : normalizeCounterpartyCategory(body.category);
  const legalForm = category === "SUPPLIER"
    ? (body.legalForm === undefined ? current.legalForm : normalizeSupplierLegalForm(body.legalForm))
    : null;
  const fullName = body.fullName === undefined ? current.fullName : cleanText(body.fullName);
  const currentExtra = counterpartyRawExtra(current.raw);
  const phone = body.phone == null ? current.phone : body.phone.trim() || null;
  const additionalPhone =
    body.additionalPhone === undefined ? currentExtra.additionalPhone || null : body.additionalPhone.trim() || null;
  const email = body.email == null ? current.email : body.email.trim() || null;
  const companyType = category === "SUPPLIER" ? "supplier" : "individual";
  const legalTitle = body.legalTitle == null ? current.legalTitle : body.legalTitle.trim() || null;
  const counterpartyTypeName =
    body.counterpartyTypeName === undefined ? current.counterpartyTypeName : cleanText(body.counterpartyTypeName);
  const legalLastName = body.legalLastName === undefined ? current.legalLastName : cleanText(body.legalLastName);
  const legalFirstName = body.legalFirstName === undefined ? current.legalFirstName : cleanText(body.legalFirstName);
  const legalMiddleName = body.legalMiddleName === undefined ? current.legalMiddleName : cleanText(body.legalMiddleName);
  const legalAddress = body.legalAddress === undefined ? current.legalAddress : cleanText(body.legalAddress);
  const actualAddress = body.actualAddress === undefined ? current.actualAddress : cleanText(body.actualAddress);
  const contactPerson = body.contactPerson === undefined ? current.contactPerson : cleanText(body.contactPerson);
  const contactPhone = body.contactPhone === undefined ? current.contactPhone : cleanText(body.contactPhone);
  const bankDetailsJson = body.bankDetailsJson === undefined
    ? undefined
    : body.bankDetailsJson == null ? Prisma.JsonNull : toJson(body.bankDetailsJson);
  const inn = body.inn === undefined ? current.inn : cleanText(body.inn);
  const kpp = body.kpp === undefined ? current.kpp : cleanText(body.kpp);
  const okpo = body.okpo === undefined ? current.okpo : cleanText(body.okpo);
  const fax = body.fax === undefined ? current.fax : cleanText(body.fax);
  const bik = body.bik === undefined ? current.bik : cleanText(body.bik);
  const bankName = body.bankName === undefined ? current.bankName : cleanText(body.bankName);
  const bankLocation = body.bankLocation === undefined ? current.bankLocation : cleanText(body.bankLocation);
  const correspondentAccount =
    body.correspondentAccount === undefined ? current.correspondentAccount : cleanText(body.correspondentAccount);
  const checkingAccount = body.checkingAccount === undefined ? current.checkingAccount : cleanText(body.checkingAccount);
  const ogrn = body.ogrn === undefined ? current.ogrn : cleanText(body.ogrn);
  const ogrnip = body.ogrnip === undefined ? current.ogrnip : cleanText(body.ogrnip);
  const certificateNumber =
    body.certificateNumber === undefined ? current.certificateNumber : cleanText(body.certificateNumber);
  const certificateDate = body.certificateDate === undefined ? current.certificateDate : dateFromInput(body.certificateDate);
  const comment = body.comment === undefined ? currentExtra.comment || null : cleanText(body.comment);
  const vehiclePlate = body.vehiclePlate === undefined ? currentExtra.vehiclePlate || null : cleanText(body.vehiclePlate);
  const vehicleVin = body.vehicleVin === undefined ? currentExtra.vehicleVin || null : cleanText(body.vehicleVin);
  const vehicleModel = body.vehicleModel === undefined ? currentExtra.vehicleModel || null : cleanText(body.vehicleModel);
  const vehicleYear = body.vehicleYear === undefined ? currentExtra.vehicleYear || null : cleanText(body.vehicleYear);
  const currentRaw = jsonRecord(current.raw);
  const rawPayload = {
    ...currentRaw,
    additionalPhone,
    comment,
    vehicle: {
      ...jsonRecord(currentRaw.vehicle),
      plate: vehiclePlate,
      vin: vehicleVin,
      model: vehicleModel,
      year: vehicleYear,
    },
    lastLocalUpdate: new Date().toISOString(),
  };
  const counterparty = await prisma.localCounterparty.update({
    where: { id: current.id },
    data: {
      name,
      displayName: name,
      category,
      legalForm,
      fullName,
      actualAddress,
      contactPerson,
      contactPhone,
      bankDetailsJson,
      phone,
      email,
      normalizedPhone: normalizePhoneKey(phone),
      phonesRaw: [phone, additionalPhone].filter(Boolean),
      companyType,
      legalTitle,
      counterpartyTypeName,
      legalLastName,
      legalFirstName,
      legalMiddleName,
      legalAddress,
      inn,
      kpp,
      okpo,
      fax,
      bik,
      bankName,
      bankLocation,
      correspondentAccount,
      checkingAccount,
      ogrn,
      ogrnip,
      certificateNumber,
      certificateDate,
      archived: body.archived === undefined ? current.archived : Boolean(body.archived),
      status: (body.archived === undefined ? current.archived : Boolean(body.archived)) ? "ARCHIVED" : "ACTIVE",
      searchText: buildCounterpartySearchText({
        fullName,
        name,
        phone,
        email,
        legalTitle,
        legalLastName,
        legalFirstName,
        legalMiddleName,
        legalAddress,
        actualAddress,
        contactPerson,
        contactPhone,
        inn,
        kpp,
        okpo,
        fax,
        bik,
        bankName,
        bankLocation,
        correspondentAccount,
        checkingAccount,
        ogrn,
        ogrnip,
        certificateNumber,
        counterpartyTypeName,
        companyType,
        extraSearchText: buildSearchText([
          additionalPhone,
          normalizePhoneKey(additionalPhone),
          comment,
          vehiclePlate,
          vehicleVin,
          vehicleModel,
          vehicleYear,
        ]),
      }),
      raw: toJson(rawPayload),
      syncedAt: new Date(),
    },
  });
  invalidateCounterpartyRows();
  return { ok: true as const, counterparty: mapCounterparty(counterparty) };
}

export async function listLocalStoresForAdmin(options: { branchIds?: string[] } = {}): Promise<StoreAdminList> {
  const branchIds = trustedReadableBranchIds(options.branchIds);
  const cacheKey = JSON.stringify({ branchIds });
  const now = Date.now();
  const cached = inventoryListsCache.stores.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.value;

  const stores = await prisma.localStore.findMany({
    where: { branchId: { in: branchIds }, archived: false },
    orderBy: [{ isMain: "desc" }, { name: "asc" }],
  });
  const value = {
    stores: stores.map((store) => ({
      id: store.id,
      branchId: store.branchId,
      name: store.name,
      isMain: store.isMain,
      archived: store.archived,
      meta: localMeta("store", store.id),
    })),
  };
  inventoryListsCache.stores.set(cacheKey, { key: cacheKey, expiresAt: now + STORE_ROWS_CACHE_MS, value });
  return value;
}

async function nextStockDocumentName(
  type: LocalStockDocumentType,
  documentDate: string,
  adjustmentType?: LocalAdjustmentType | null,
  transaction?: Prisma.TransactionClient,
) {
  const prefix = type === "receipt" ? "ПР" : adjustmentType === "technical" ? "ТК" : "СП";
  const where: Prisma.LocalInventoryDocumentWhereInput = { type, documentDate };
  if (type === "writeoff") {
    if (adjustmentType === "technical") {
      where.adjustmentType = "technical";
    } else {
      where.OR = [{ adjustmentType: "expense" }, { adjustmentType: null }];
    }
  }
  const client = transaction ?? prisma;
  const count = await client.localInventoryDocument.count({
    where,
  });
  return `${prefix}-${documentDate.replaceAll("-", "")}-${String(count + 1).padStart(3, "0")}`;
}

async function nextSupplierInvoiceNumber(invoiceDate: string, transaction?: Prisma.TransactionClient) {
  const client = transaction ?? prisma;
  const count = await client.localSupplierInvoice.count({ where: { invoiceDate } });
  return `СЧ-${invoiceDate.replaceAll("-", "")}-${String(count + 1).padStart(3, "0")}`;
}

function normalizeStockDocumentStatus(value: unknown, applicable: boolean): LocalReceiptStatus {
  if (value === "draft" || value === "posted" || value === "cancelled" || value === "needs_review" || value === "blocked") return value;
  return applicable ? "posted" : "draft";
}

function isReceiptDraft(document: { status?: string | null; applicable: boolean; isDeleted?: boolean | null }) {
  return !document.isDeleted && normalizeStockDocumentStatus(document.status, document.applicable) === "draft" && !document.applicable;
}

function isReceiptPosted(document: { status?: string | null; applicable: boolean; isDeleted?: boolean | null }) {
  return !document.isDeleted && normalizeStockDocumentStatus(document.status, document.applicable) === "posted" && document.applicable;
}

function canManageReceiptDangerousActions(user?: ActingUser | null) {
  return user?.role === "owner" || user?.role === "admin";
}

function receiptPermissionError(user?: ActingUser | null) {
  return canManageReceiptDangerousActions(user)
    ? null
    : "Недостаточно прав. Отменять, удалять и возвращать приёмки может только владелец или администратор.";
}

function stockDocumentSnapshot(document: {
  id: string;
  type: string;
  name: string;
  status?: string | null;
  applicable: boolean;
  documentDate: string;
  momentAt: Date;
  sumCents: number;
  description?: string | null;
  storeId?: string | null;
  storeNameSnapshot?: string | null;
  counterpartyId?: string | null;
  counterpartyNameSnapshot?: string | null;
  positions?: Array<{
    id: string;
    productId: string | null;
    productName: string;
    quantity: Prisma.Decimal | number;
    priceCentsPerUnit: number;
    slotName?: string | null;
  }>;
  supplierInvoice?: {
    id: string;
    number: string | null;
    status: string;
    sumCents: number;
    paidAmountCents: number;
  } | null;
}) {
  return {
    id: document.id,
    type: document.type,
    name: document.name,
    status: normalizeStockDocumentStatus(document.status, document.applicable),
    applicable: document.applicable,
    documentDate: document.documentDate,
    momentAt: document.momentAt.toISOString(),
    sumCents: document.sumCents,
    description: document.description ?? "",
    storeId: document.storeId ?? "",
    storeName: document.storeNameSnapshot ?? "",
    counterpartyId: document.counterpartyId ?? "",
    counterpartyName: document.counterpartyNameSnapshot ?? "",
    invoice: document.supplierInvoice
      ? {
          id: document.supplierInvoice.id,
          number: document.supplierInvoice.number ?? "",
          status: document.supplierInvoice.status,
          sumCents: document.supplierInvoice.sumCents,
          paidAmountCents: document.supplierInvoice.paidAmountCents,
        }
      : null,
    positions: (document.positions ?? []).map((position) => ({
      id: position.id,
      productId: position.productId,
      productName: position.productName,
      quantity: decimalToNumber(position.quantity),
      priceCentsPerUnit: position.priceCentsPerUnit,
      slotName: position.slotName ?? "",
    })),
  };
}

async function writeStockDocumentAudit(
  tx: Prisma.TransactionClient,
  input: {
    documentId: string;
    action: string;
    statusBefore?: string | null;
    statusAfter?: string | null;
    message?: string | null;
    oldValue?: unknown;
    newValue?: unknown;
    user?: ActingUser | null;
  }
) {
  await tx.localInventoryDocumentAuditLog.create({
    data: {
      documentId: input.documentId,
      action: input.action,
      statusBefore: input.statusBefore ?? null,
      statusAfter: input.statusAfter ?? null,
      message: input.message ?? null,
      oldValue: input.oldValue === undefined ? Prisma.JsonNull : toJson(input.oldValue),
      newValue: input.newValue === undefined ? Prisma.JsonNull : toJson(input.newValue),
      createdById: input.user?.login ?? null,
      createdByName: input.user?.name ?? null,
    },
  });
}

function normalizeSupplierInvoiceStatus(value?: string): "draft" | "unpaid" | "paid" | "partial" | "cancelled" | "requisites_review" | "ready_to_pay" | "tbank_draft_created" | "tbank_waiting_confirmation" | "tbank_confirmed" | "tbank_sent" | "tbank_processing" | "payment_error" | "bank_rejected" | "payment_cancelled" | "requires_review" | "paid_manually" {
  if (
    value === "draft" ||
    value === "paid" ||
    value === "partial" ||
    value === "cancelled" ||
    value === "requisites_review" ||
    value === "ready_to_pay" ||
    value === "tbank_draft_created" ||
    value === "tbank_waiting_confirmation" ||
    value === "tbank_confirmed" ||
    value === "tbank_sent" ||
    value === "tbank_processing" ||
    value === "payment_error" ||
    value === "bank_rejected" ||
    value === "payment_cancelled" ||
    value === "requires_review" ||
    value === "paid_manually"
  ) return value;
  if (value === "partially_paid") return "partial";
  return "unpaid";
}

function normalizeSupplierInvoicePaymentType(value?: string): "cash" | "card" | "bank_transfer" {
  if (value === "card" || value === "bank_transfer") return value;
  return "cash";
}

function initialPaidCentsForStatus(status: string, sumCents: number) {
  return status === "paid" ? sumCents : 0;
}

function effectivePaidCents(invoice: Pick<SupplierInvoiceWithDocument, "status" | "sumCents" | "paidAmountCents">) {
  const fallbackPaid = invoice.status === "paid" && invoice.paidAmountCents === 0 ? invoice.sumCents : invoice.paidAmountCents;
  return Math.min(invoice.sumCents, Math.max(0, fallbackPaid));
}

function effectiveInvoiceStatus(invoice: Pick<SupplierInvoiceWithDocument, "status" | "dueDate" | "sumCents" | "paidAmountCents">) {
  const status = normalizeSupplierInvoiceStatus(invoice.status);
  if (
    status === "cancelled" ||
    status === "draft" ||
    status === "requisites_review" ||
    status === "ready_to_pay" ||
    status === "tbank_draft_created" ||
    status === "tbank_waiting_confirmation" ||
    status === "tbank_confirmed" ||
    status === "tbank_sent" ||
    status === "tbank_processing" ||
    status === "payment_error" ||
    status === "bank_rejected" ||
    status === "payment_cancelled" ||
    status === "requires_review"
  ) return status;
  if (status === "paid_manually") return status;
  const remainingCents = Math.max(0, invoice.sumCents - effectivePaidCents(invoice));
  if (remainingCents <= 0) return "paid";
  const today = toServiceDateInput(new Date());
  if (invoice.dueDate && invoice.dueDate < today) return "overdue";
  if (effectivePaidCents(invoice) > 0) return "partial";
  return "unpaid";
}

function supplierInvoiceHasPaymentRisk(invoice?: { status: string; sumCents: number; paidAmountCents: number } | null) {
  if (!invoice) return false;
  const status = normalizeSupplierInvoiceStatus(invoice.status);
  return invoice.paidAmountCents > 0 || status === "paid" || status === "partial" || status === "paid_manually";
}

export function mapSupplierInvoice(invoice: SupplierInvoiceWithDocument) {
  const document = invoice.document;
  const counterparty = document.counterparty;
  const paidAmountCents = effectivePaidCents(invoice);
  const remainingAmountCents = normalizeSupplierInvoiceStatus(invoice.status) === "cancelled"
    ? 0
    : Math.max(0, invoice.sumCents - paidAmountCents);
  return {
    id: invoice.id,
    branchId: invoice.branchId,
    number: invoice.number ?? "",
    invoiceDate: invoice.invoiceDate,
    dueDate: invoice.dueDate ?? "",
    status: effectiveInvoiceStatus(invoice),
    storedStatus: invoice.status,
    sum: invoice.sumCents / 100,
    totalAmountCents: invoice.sumCents,
    paidAmountCents,
    remainingAmountCents,
    paid: paidAmountCents / 100,
    remaining: remainingAmountCents / 100,
    source: invoice.source ?? "receipt",
    comment: invoice.comment ?? "",
    attachmentUrl: invoice.attachmentUrl ?? "",
    counterpartyName: invoice.counterpartyNameSnapshot ?? counterparty?.name ?? document.counterpartyNameSnapshot ?? "",
    supplierRequisites: {
      id: counterparty?.id ?? "",
      name: counterparty?.name ?? document.counterpartyNameSnapshot ?? invoice.counterpartyNameSnapshot ?? "",
      legalTitle: counterparty?.legalTitle ?? "",
      inn: counterparty?.inn ?? "",
      kpp: counterparty?.kpp ?? "",
      checkingAccount: counterparty?.checkingAccount ?? "",
      bik: counterparty?.bik ?? "",
      correspondentAccount: counterparty?.correspondentAccount ?? "",
      bankName: counterparty?.bankName ?? "",
      bankLocation: counterparty?.bankLocation ?? "",
      companyType: counterparty?.companyType ?? "",
      archived: counterparty?.archived ?? false,
    },
    createdAt: invoice.createdAt.toISOString(),
    updatedAt: invoice.updatedAt.toISOString(),
    document: {
      id: document.id,
      branchId: document.branchId,
      name: document.name,
      type: document.type,
      documentDate: document.documentDate,
      moment: document.momentAt.toISOString(),
      applicable: document.applicable,
      storeName: document.store?.name ?? document.storeNameSnapshot ?? "",
      counterpartyName: document.counterparty?.name ?? document.counterpartyNameSnapshot ?? "",
      sum: document.sumCents / 100,
      positions: document.positions.map((position) => ({
        id: position.id,
        name: position.productName,
        quantity: position.quantity.toNumber(),
        price: position.priceCentsPerUnit / 100,
        sum: Math.round(position.quantity.toNumber() * position.priceCentsPerUnit) / 100,
        slotName: position.slotName ?? "",
      })),
    },
    tbankPayments: invoice.tbankPayments.map((payment) => ({
      id: payment.id,
      provider: payment.provider,
      mode: payment.mode,
      status: payment.status,
      providerStatus: payment.providerStatus ?? "",
      tbankDocumentId: payment.tbankDocumentId ?? "",
      tbankPaymentId: payment.tbankPaymentId ?? "",
      tbankRequestId: payment.tbankRequestId ?? "",
      amount: payment.amountCents / 100,
      amountCents: payment.amountCents,
      fromAccountNumberMasked: payment.fromAccountNumberMasked ?? "",
      recipientName: payment.recipientName,
      recipientInn: payment.recipientInn,
      recipientKpp: payment.recipientKpp ?? "",
      recipientAccount: payment.recipientAccount,
      recipientBik: payment.recipientBik,
      paymentPurpose: payment.paymentPurpose,
      confirmationUrl: payment.confirmationUrl ?? "",
      createdAt: payment.createdAt.toISOString(),
      sentAt: payment.sentAt?.toISOString() ?? "",
      confirmedAt: payment.confirmedAt?.toISOString() ?? "",
      paidAt: payment.paidAt?.toISOString() ?? "",
      failedAt: payment.failedAt?.toISOString() ?? "",
      errorMessage: payment.errorMessage ?? "",
    })),
    payments: invoice.payments.map((payment) => ({
      id: payment.id,
      amount: payment.amountCents / 100,
      amountCents: payment.amountCents,
      paymentDate: payment.paymentDate,
      paymentType: normalizeSupplierInvoicePaymentType(payment.paymentType),
      comment: payment.comment ?? "",
      createdAt: payment.createdAt.toISOString(),
      createdBy: payment.createdBy,
      createdByName: payment.createdByName ?? "",
      cashExpenseOrder: payment.cashExpenseOrder
        ? {
            id: payment.cashExpenseOrder.id,
            number: payment.cashExpenseOrder.number,
            status: payment.cashExpenseOrder.status,
          }
        : null,
    })),
  };
}

export async function createLocalSupplierInvoiceForReceipt(body: SupplierInvoiceInput, user?: ActingUser) {
  getScopedBranchId();
  const documentId = body.documentId?.trim() ?? "";
  if (!documentId) return { ok: false as const, error: "Не выбрана приёмка" };
  const document = await prisma.localInventoryDocument.findFirst({
    where: { id: documentId, type: "receipt" },
    include: {
      counterparty: true,
      supplierInvoice: true,
    },
  });
  if (!document) return { ok: false as const, error: "Приёмка не найдена", notFound: true };
  if (document.supplierInvoice) return { ok: false as const, error: "По этой приёмке уже создан счёт" };

  const invoiceDate = documentDateFromInput(body.invoiceDate || document.documentDate);
  const dueDate = optionalDocumentDateFromInput(body.dueDate);
  const status = normalizeSupplierInvoiceStatus(body.status);
  const number = body.number?.trim() || await nextSupplierInvoiceNumber(invoiceDate);
  const created = await prisma.localSupplierInvoice.create({
    data: {
      documentId: document.id,
      number,
      invoiceDate,
      dueDate,
      status,
      sumCents: document.sumCents,
      paidAmountCents: initialPaidCentsForStatus(status, document.sumCents),
      source: "receipt",
      createdBy: user?.login ?? null,
      counterpartyNameSnapshot: document.counterparty?.name ?? document.counterpartyNameSnapshot,
      raw: toJson(body),
    },
    include: supplierInvoiceInclude,
  });

  invalidateSupplierInvoiceLists();
  invalidateStockDocumentLists();
  return { ok: true as const, invoice: mapSupplierInvoice(created) };
}

export async function listLocalSupplierInvoices(params: {
  search?: string;
  status?: string;
  supplier?: string;
  dateFrom?: string;
  dateTo?: string;
  minAmount?: number;
  maxAmount?: number;
  document?: string;
  withoutReceipt?: boolean;
  overdueOnly?: boolean;
  source?: string;
  sortBy?: string;
  sortDir?: string;
  limit?: number;
  offset?: number;
  /** Trusted branch scope from the server resolver; never accepted from the client. */
  branchIds?: string[];
}): Promise<SupplierInvoiceAdminList> {
  const branchIds = trustedReadableBranchIds(params.branchIds);
  const limit = Math.min(100, Math.max(1, params.limit ?? 50));
  const offset = Math.max(0, params.offset ?? 0);
  const search = params.search?.trim() ?? "";
  const status = params.status === "unpaid" ||
    params.status === "partial" ||
    params.status === "partially_paid" ||
    params.status === "paid" ||
    params.status === "draft" ||
    params.status === "cancelled" ||
    params.status === "overdue"
    ? params.status
    : "";
  const supplier = params.supplier?.trim() ?? "";
  const dateFrom = optionalDocumentDateFromInput(params.dateFrom);
  const dateTo = optionalDocumentDateFromInput(params.dateTo);
  const minAmount = Number.isFinite(params.minAmount) ? centsFromRub(params.minAmount) : null;
  const maxAmount = Number.isFinite(params.maxAmount) ? centsFromRub(params.maxAmount) : null;
  const documentSearch = params.document?.trim() ?? "";
  const source = params.source === "local" ||
    params.source === "receipt" ||
    params.source === "import" ||
    params.source === "legacy_import"
    ? params.source
    : "";
  const sortBy = ["invoiceDate", "dueDate", "sum", "supplier", "status"].includes(params.sortBy ?? "")
    ? params.sortBy!
    : "invoiceDate";
  const sortDir = params.sortDir === "asc" ? "asc" : "desc";
  const cacheKey = JSON.stringify({
    search,
    status,
    supplier,
    dateFrom,
    dateTo,
    minAmount,
    maxAmount,
    documentSearch,
    withoutReceipt: params.withoutReceipt === true,
    overdueOnly: params.overdueOnly === true,
    source,
    sortBy,
    sortDir,
    limit,
    offset,
    branchIds,
  });
  const now = Date.now();
  const cached = inventoryListsCache.supplierInvoices.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.value;

  const today = toServiceDateInput(new Date());
  const amountFromSearch = centsFromRub(search.replace(/[^\d,.]/g, "").replace(",", "."));
  const and: Prisma.LocalSupplierInvoiceWhereInput[] = [];
  if (status === "overdue" || params.overdueOnly) {
    and.push({
      dueDate: { lt: today },
      status: { in: ["unpaid", "partial"] },
    });
  } else if (status) {
    and.push({ status: status === "partially_paid" ? "partial" : status });
  }
  if (supplier) {
    and.push({
      OR: [
        { counterpartyNameSnapshot: { contains: supplier, mode: "insensitive" } },
        { document: { counterpartyNameSnapshot: { contains: supplier, mode: "insensitive" } } },
        { document: { counterparty: { name: { contains: supplier, mode: "insensitive" } } } },
      ],
    });
  }
  if (dateFrom || dateTo) {
    and.push({
      invoiceDate: {
        ...(dateFrom ? { gte: dateFrom } : {}),
        ...(dateTo ? { lte: dateTo } : {}),
      },
    });
  }
  if (minAmount != null || maxAmount != null) {
    and.push({
      sumCents: {
        ...(minAmount != null ? { gte: minAmount } : {}),
        ...(maxAmount != null ? { lte: maxAmount } : {}),
      },
    });
  }
  if (documentSearch) {
    and.push({ document: { name: { contains: documentSearch, mode: "insensitive" } } });
  }
  if (source) {
    and.push({ source });
  }
  if (params.withoutReceipt) {
    and.push({ documentId: "__missing_receipt__" });
  }
  if (search) {
    and.push({
      OR: [
        { number: { contains: search, mode: "insensitive" } },
        { counterpartyNameSnapshot: { contains: search, mode: "insensitive" } },
        { document: { name: { contains: search, mode: "insensitive" } } },
        { document: { counterpartyNameSnapshot: { contains: search, mode: "insensitive" } } },
        ...(amountFromSearch > 0 ? [{ sumCents: amountFromSearch }] : []),
      ],
    });
  }

  const where: Prisma.LocalSupplierInvoiceWhereInput = {
    branchId: { in: branchIds },
    ...(and.length ? { AND: and } : {}),
  };
  const orderBy: Prisma.LocalSupplierInvoiceOrderByWithRelationInput[] =
    sortBy === "sum"
      ? [{ sumCents: sortDir }, { createdAt: "desc" }]
      : sortBy === "dueDate"
        ? [{ dueDate: sortDir }, { createdAt: "desc" }]
        : sortBy === "supplier"
          ? [{ counterpartyNameSnapshot: sortDir }, { createdAt: "desc" }]
          : sortBy === "status"
            ? [{ status: sortDir }, { createdAt: "desc" }]
            : [{ invoiceDate: sortDir }, { createdAt: "desc" }];
  const [total, invoices] = await Promise.all([
    prisma.localSupplierInvoice.count({ where }),
    prisma.localSupplierInvoice.findMany({
      where,
      include: supplierInvoiceInclude,
      orderBy,
      skip: offset,
      take: limit,
    }),
  ]);
  const value = {
    meta: { total, limit, offset },
    invoices: invoices.map(mapSupplierInvoice),
  };
  inventoryListsCache.supplierInvoices.set(cacheKey, {
    key: cacheKey,
    expiresAt: now + SUPPLIER_INVOICES_CACHE_MS,
    value,
  });
  return value;
}

export async function createLocalSupplierInvoicePayment(
  invoiceId: string,
  body: SupplierInvoicePaymentInput,
  user: User
) {
  getScopedBranchId();
  const id = invoiceId?.trim();
  if (!id) return { ok: false as const, error: "Не выбран счёт поставщика" };

  const amountCents = centsFromRub(body.amount);
  if (amountCents <= 0) return { ok: false as const, error: "Сумма оплаты должна быть больше нуля" };

  const paymentDate = documentDateFromInput(body.paymentDate || toServiceDateInput(new Date()));
  const paymentType = normalizeSupplierInvoicePaymentType(body.paymentType);
  const invoice = await prisma.localSupplierInvoice.findUnique({
    where: { id },
    include: supplierInvoiceInclude,
  });
  if (!invoice) return { ok: false as const, error: "Счёт поставщика не найден", notFound: true };
  const storedStatus = normalizeSupplierInvoiceStatus(invoice.status);
  if (storedStatus === "cancelled") return { ok: false as const, error: "Отменённый счёт нельзя оплатить" };

  const currentPaidCents = effectivePaidCents(invoice);
  const remainingCents = Math.max(0, invoice.sumCents - currentPaidCents);
  if (remainingCents <= 0) return { ok: false as const, error: "Счёт уже оплачен" };
  if (amountCents > remainingCents && body.allowOverpay !== true) {
    return { ok: false as const, error: "Сумма оплаты больше остатка по счёту" };
  }

  const supplierName =
    invoice.counterpartyNameSnapshot ??
    invoice.document.counterparty?.name ??
    invoice.document.counterpartyNameSnapshot ??
    "Поставщик";
  let cashExpenseOrderId: string | null = null;

  if (paymentType === "cash") {
    const shift = await getCurrentShift();
    if (!shift) {
      return {
        ok: false as const,
        error: "Кассовая смена не открыта. Наличную оплату нельзя провести через кассу.",
        cashShiftClosed: true,
      };
    }
    try {
      const expense = await addExpense({
        shiftId: shift.id,
        amount: amountCents / 100,
        article: `Оплата счёта поставщика ${invoice.number || invoice.document.name}`,
        expenseDate: paymentDate,
        expenseItemName: "Оплата поставщику",
        counterpartyId: invoice.document.counterpartyId ?? undefined,
        counterpartyName: supplierName,
        paymentType: "cash",
        status: "posted",
        comment: body.comment?.trim() || `Счёт ${invoice.number || invoice.document.name}`,
      });
      cashExpenseOrderId = expense.orderId ?? null;
    } catch (error) {
      return {
        ok: false as const,
        error: error instanceof Error ? error.message : "Не удалось создать расходный ордер кассы",
      };
    }
  }

  const nextPaidCents = Math.min(invoice.sumCents, currentPaidCents + amountCents);
  const nextStatus = nextPaidCents >= invoice.sumCents ? "paid" : "partial";
  const updated = await prisma.$transaction(async (tx) => {
    await tx.localSupplierInvoicePayment.create({
      data: {
        invoiceId: invoice.id,
        amountCents,
        paymentDate,
        paymentType,
        cashExpenseOrderId,
        comment: body.comment?.trim() || null,
        createdBy: user.login,
        createdByName: user.name,
        raw: toJson(body),
      },
    });
    return tx.localSupplierInvoice.update({
      where: { id: invoice.id },
      data: {
        paidAmountCents: nextPaidCents,
        status: nextStatus,
      },
      include: supplierInvoiceInclude,
    });
  });

  invalidateSupplierInvoiceLists();
  return { ok: true as const, invoice: mapSupplierInvoice(updated) };
}

export async function updateLocalSupplierInvoiceStatus(invoiceId: string, status: string, user?: ActingUser) {
  getScopedBranchId();
  const id = invoiceId?.trim();
  if (!id) return { ok: false as const, error: "Не выбран счёт поставщика" };
  const nextStatus = normalizeSupplierInvoiceStatus(status);
  if (nextStatus !== "cancelled" && nextStatus !== "draft" && nextStatus !== "unpaid") {
    return { ok: false as const, error: "Этот статус изменяется через оплату счёта" };
  }

  const current = await prisma.localSupplierInvoice.findUnique({
    where: { id },
    include: supplierInvoiceInclude,
  });
  if (!current) return { ok: false as const, error: "Счёт поставщика не найден", notFound: true };
  if (current.payments.length > 0 && nextStatus === "cancelled") {
    return { ok: false as const, error: "Нельзя отменить счёт с сохранёнными оплатами" };
  }

  const updated = await prisma.localSupplierInvoice.update({
    where: { id: current.id },
    data: {
      status: nextStatus,
      paidAmountCents: nextStatus === "unpaid" || nextStatus === "draft" || nextStatus === "cancelled"
        ? 0
        : current.paidAmountCents,
      raw: toJson({
        ...jsonRecord(current.raw),
        statusChangedAt: new Date().toISOString(),
        statusChangedBy: user?.login ?? null,
      }),
    },
    include: supplierInvoiceInclude,
  });

  invalidateSupplierInvoiceLists();
  return { ok: true as const, invoice: mapSupplierInvoice(updated) };
}

export async function createLocalStockDocument(body: StockDocumentInput, user?: ActingUser, options?: StockDocumentCreateOptions) {
  getScopedBranchId();
  const type = body.type === "receipt" || body.type === "writeoff" ? body.type : null;
  const client = options?.transaction ?? prisma;
  if (!type) return { ok: false as const, error: "Неизвестный тип складского документа" };
  const storeId = body.storeId?.trim() ?? "";
  const applicable = body.applicable !== false;
  const adjustmentType = type === "writeoff" ? normalizeAdjustmentType(body.adjustmentType) : null;
  const adjustmentMethod = type === "writeoff" ? normalizeAdjustmentMethod(body.adjustmentMethod) : null;
  const adjustmentReason = type === "writeoff" ? cleanText(body.adjustmentReason) ?? cleanText(body.description) : null;
  const affectsManagementProfit = type !== "writeoff" || adjustmentType !== "technical";
  if (type === "writeoff") {
    const reasonError = validateWriteoffReason(adjustmentType ?? "expense", adjustmentReason, applicable);
    if (reasonError) return { ok: false as const, error: reasonError };
  }
  const store = storeId
    ? await client.localStore.findFirst({ where: { OR: [{ id: storeId }, { id: storeId }] } })
    : null;
  if (storeId && !store) return { ok: false as const, error: "Склад не найден в локальной БД" };
  if (applicable && !store) return { ok: false as const, error: "Выберите склад" };
  const documentDate = documentDateFromInput(body.documentDate);
  const momentAt = momentFromInput(body.moment, documentDate);
  const inputPositions = (body.positions ?? []).filter(
    (position) => position.productId?.trim() && Number(position.quantity) > 0
  );
  if (inputPositions.length === 0) {
    return { ok: false as const, error: "Добавьте хотя бы одну позицию с количеством больше нуля" };
  }
  if (options?.sourceMetadata && options.sourceMetadata.positions.length !== inputPositions.length) {
    return { ok: false as const, error: "Source metadata не соответствует позициям складского документа" };
  }

  const productIds = [...new Set(inputPositions.map((position) => position.productId!.trim()))];
  const products = await client.localProduct.findMany({
    where: { OR: [{ id: { in: productIds } }, { id: { in: productIds } }] },
  });
  const productByAnyId = new Map<string, (typeof products)[number]>();
  for (const product of products) {
    productByAnyId.set(product.id, product);
    if (product.id) productByAnyId.set(product.id, product);
  }

  const positions = inputPositions.map((position, index) => {
    const product = productByAnyId.get(position.productId!.trim());
    if (!product) return { error: `Товар не найден: ${position.productId}` as const };
    if (!isStockTrackedType(product.entityType)) return { error: `Позиция не является складским товаром: ${product.name}` as const };
    const quantity = Number(position.quantity) || 0;
    const inputPriceCents = centsFromRub(position.price);
    const priceCents = type === "writeoff" && inputPriceCents <= 0
      ? product.buyPriceCents ?? 0
      : inputPriceCents;
    const salePriceCents = type === "receipt" && position.salePrice !== undefined
      ? Math.max(0, centsFromRub(position.salePrice))
      : null;
    return {
      product,
      quantity: new Prisma.Decimal(quantity),
      priceCents,
      salePriceCents,
      slotName: position.slotName?.trim() || null,
      makeDefaultCell: position.makeDefaultCell === true,
      raw: position,
      sourceMetadata: options?.sourceMetadata?.positions[index] ?? null,
    };
  });
  const positionError = positions.find((position) => "error" in position);
  if (positionError && "error" in positionError) {
    return { ok: false as const, error: positionError.error };
  }

  const counterpartyId = body.counterpartyId?.trim();
  const supplierSnapshotName = supplierSnapshotNameFromId(counterpartyId);
  const counterparty = counterpartyId && !supplierSnapshotName
    ? await client.localCounterparty.findFirst({ where: { OR: [{ id: counterpartyId }, { id: counterpartyId }] } })
    : null;
  const sumCents = positions.reduce((sum, position) => {
    if ("error" in position) return sum;
    return sum + Math.round(position.quantity.toNumber() * position.priceCents);
  }, 0);
  const name = await nextStockDocumentName(type, documentDate, adjustmentType, options?.transaction);
  const invoiceRequested = type === "receipt" && body.invoice?.create === true;
  const invoiceDate = invoiceRequested ? documentDateFromInput(body.invoice?.invoiceDate || documentDate) : null;
  const invoiceDueDate = invoiceRequested ? optionalDocumentDateFromInput(body.invoice?.dueDate) : null;
  const invoiceStatus = invoiceRequested ? normalizeSupplierInvoiceStatus(body.invoice?.status) : null;
  const invoiceNumber = invoiceRequested
    ? body.invoice?.number?.trim() || await nextSupplierInvoiceNumber(invoiceDate!, options?.transaction)
    : null;

  let created: {
    id: string;
    name: string;
    type: string;
    status: string;
    applicable: boolean;
    adjustmentType: string | null;
    adjustmentMethod: string | null;
    adjustmentReason: string | null;
    affectsManagementProfit: boolean;
  };
  try {
    const createDocument = async (tx: Prisma.TransactionClient) => {
      const document = await tx.localInventoryDocument.create({
      data: {
        type,
        name,
        momentAt,
        documentDate,
        status: applicable ? "posted" : "draft",
        applicable,
        sumCents,
        description: body.description?.trim() || null,
        adjustmentType,
        adjustmentMethod,
        adjustmentReason,
        affectsManagementProfit,
        counterpartyId: counterparty?.id ?? null,
        counterpartyNameSnapshot: counterparty?.name ?? supplierSnapshotName,
        storeId: store?.id ?? null,
        storeNameSnapshot: store?.name ?? null,
        createdByLogin: user?.login ?? null,
        createdByName: user?.name ?? null,
        source: options?.sourceMetadata?.source ?? "local",
        externalCode: options?.sourceMetadata?.externalCode ?? null,
        raw: toJson(options?.sourceMetadata?.raw ?? body),
      },
    });

    await tx.localInventoryDocumentPosition.createMany({
      data: positions.map((position) => {
        if ("error" in position) throw new Error(position.error);
        return {
          documentId: document.id,
          productId: position.product.id,
          productName: position.product.name,
          quantity: position.quantity,
          priceCentsPerUnit: position.priceCents,
          slotName: position.slotName,
          source: position.sourceMetadata?.source ?? "local",
          externalCode: position.sourceMetadata?.externalCode ?? null,
          raw: toJson(position.sourceMetadata?.raw ?? position.raw),
        };
      }),
    });

    if (type === "receipt") {
      for (const position of positions) {
        if ("error" in position) throw new Error(position.error);
        if (position.salePriceCents === null || position.salePriceCents === position.product.salePriceCents) continue;
        await tx.localProduct.update({
          where: { id: position.product.id },
          data: { salePriceCents: position.salePriceCents, syncedAt: new Date() },
        });
      }
    }

    if (invoiceRequested) {
      await tx.localSupplierInvoice.create({
        data: {
          documentId: document.id,
          number: invoiceNumber,
          invoiceDate: invoiceDate!,
          dueDate: invoiceDueDate,
          status: invoiceStatus!,
          sumCents,
          paidAmountCents: initialPaidCentsForStatus(invoiceStatus!, sumCents),
          source: "receipt",
          createdBy: user?.login ?? null,
          counterpartyNameSnapshot: counterparty?.name ?? supplierSnapshotName,
          raw: toJson(body.invoice),
        },
      });
    }

    if (applicable) {
      if (!store) throw new Error("Выберите склад");
      await assertNoActiveInventoryLocks(tx, {
        organizationId: store.organizationId,
        warehouseId: store.id,
        productIds: positions.map((position) => "error" in position ? null : position.product.id),
      });
      for (const position of positions) {
        if ("error" in position) throw new Error(position.error);
        const delta = position.quantity.toNumber() * (type === "receipt" ? 1 : -1);
        const current = await tx.localStockBalance.findUnique({
          where: { productId_storeId: { productId: position.product.id, storeId: store.id } },
        });
        const currentQuantity = current?.quantity.toNumber() ?? 0;
        const reserve = current?.reserve.toNumber() ?? 0;
        const currentAvailable = current?.available.toNumber() ?? currentQuantity - reserve;
        if (type === "writeoff") {
          if (currentQuantity < 0) {
            throw new Error(`Остаток товара «${position.product.name}» уже отрицательный. Используйте корректировку фактического остатка.`);
          }
          if (position.quantity.toNumber() > currentQuantity + 0.000001) {
            throw new Error(`Нельзя списать ${position.quantity.toNumber()} шт. товара «${position.product.name}»: на складе ${currentQuantity} шт.`);
          }
          if (position.quantity.toNumber() > currentAvailable + 0.000001) {
            throw new Error(`Из ${currentQuantity} шт. товара «${position.product.name}» ${reserve} шт. находятся в резерве. Сначала снимите резерв или выберите меньшее количество.`);
          }
        }
        const nextQuantity = currentQuantity + delta;
        const nextAvailable = nextQuantity - reserve;
        if (nextQuantity < -0.000001 || nextAvailable < -0.000001) {
          throw new Error(`Операция создаёт отрицательный остаток по товару «${position.product.name}»`);
        }
        if (current) {
          await tx.localStockBalance.update({
            where: { id: current.id },
            data: {
              quantity: new Prisma.Decimal(nextQuantity),
              available: new Prisma.Decimal(nextAvailable),
              slotName: position.slotName ?? current.slotName,
              syncedAt: new Date(),
            },
          });
        } else {
          await tx.localStockBalance.create({
            data: {
              productId: position.product.id,
              storeId: store.id,
              quantity: new Prisma.Decimal(nextQuantity),
              reserve: new Prisma.Decimal(0),
              available: new Prisma.Decimal(nextAvailable),
              slotName: position.slotName,
              syncedAt: new Date(),
            },
          });
        }
        if (type === "receipt") {
          const productUpdate: Prisma.LocalProductUpdateInput = { syncedAt: new Date() };
          let shouldUpdateProduct = false;
          if (position.priceCents > 0) {
            productUpdate.buyPriceCents = position.priceCents;
            shouldUpdateProduct = true;
          }
          if (position.makeDefaultCell && position.slotName) {
            productUpdate.cell = position.slotName;
            shouldUpdateProduct = true;
          }
          if (shouldUpdateProduct) {
            await tx.localProduct.update({
              where: { id: position.product.id },
              data: productUpdate,
            });
          }
        }
      }
    }

    await writeStockDocumentAudit(tx, {
      documentId: document.id,
      action: applicable ? "create_posted" : "create_draft",
      statusAfter: applicable ? "posted" : "draft",
      message: applicable ? "Документ создан и проведён. Остатки обновлены." : "Документ создан как черновик.",
      newValue: {
        type,
        name,
        documentDate,
        sumCents,
        positionsCount: positions.length,
        invoiceCreated: invoiceRequested,
      },
      user,
    });

      return document;
    };
    created = options?.transaction
      ? await createDocument(options.transaction)
      : await prisma.$transaction(createDocument);
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Не удалось провести складской документ" };
  }

  invalidateWarehouseReadCaches();

  return {
    ok: true as const,
    document: {
      id: created.id,
      name: created.name,
      type: created.type,
      status: normalizeStockDocumentStatus(created.status, created.applicable),
      applicable: created.applicable,
      adjustmentType: created.adjustmentType,
      adjustmentMethod: created.adjustmentMethod,
      adjustmentReason: created.adjustmentReason,
      affectsManagementProfit: created.affectsManagementProfit,
      invoice: invoiceRequested
        ? {
            number: invoiceNumber,
            invoiceDate,
            dueDate: invoiceDueDate,
            status: invoiceStatus,
            sum: sumCents / 100,
          }
        : null,
    },
  };
}

export async function updateLocalStockDocument(documentId: string, body: StockDocumentInput, user?: ActingUser) {
  getScopedBranchId();
  const id = documentId?.trim();
  if (!id) return { ok: false as const, error: "Не выбран складской документ" };

  const current = await prisma.localInventoryDocument.findUnique({
    where: { id },
    include: {
      positions: { orderBy: { id: "asc" } },
      supplierInvoice: true,
    },
  });
  if (!current) return { ok: false as const, error: "Складской документ не найден", notFound: true };
  if (current.isDeleted) return { ok: false as const, error: "Удалённый документ нельзя редактировать" };
  if (current.type !== "receipt" && current.type !== "writeoff") {
    return { ok: false as const, error: "Неизвестный тип складского документа" };
  }
  if (body.type && body.type !== current.type) {
    return { ok: false as const, error: "Тип складского документа нельзя изменить" };
  }
  if (!isReceiptDraft(current)) {
    return { ok: false as const, error: "Проведённый документ нельзя редактировать. Создайте документ на основе." };
  }

  const type = current.type as LocalStockDocumentType;
  const storeId = body.storeId?.trim() ?? "";
  const applicable = body.applicable === true;
  const adjustmentType = type === "writeoff" ? normalizeAdjustmentType(body.adjustmentType ?? current.adjustmentType) : null;
  const adjustmentMethod = type === "writeoff" ? normalizeAdjustmentMethod(body.adjustmentMethod ?? current.adjustmentMethod) : null;
  const adjustmentReason = type === "writeoff"
    ? cleanText(body.adjustmentReason) ?? cleanText(current.adjustmentReason) ?? cleanText(body.description) ?? cleanText(current.description)
    : null;
  const affectsManagementProfit = type !== "writeoff" || adjustmentType !== "technical";
  if (type === "writeoff") {
    const reasonError = validateWriteoffReason(adjustmentType ?? "expense", adjustmentReason, applicable);
    if (reasonError) return { ok: false as const, error: reasonError };
  }
  const store = storeId
    ? await prisma.localStore.findFirst({ where: { OR: [{ id: storeId }, { id: storeId }] } })
    : null;
  if (storeId && !store) return { ok: false as const, error: "Склад не найден в локальной БД" };
  if (applicable && !store) return { ok: false as const, error: "Выберите склад" };

  const documentDate = documentDateFromInput(body.documentDate || current.documentDate);
  const momentAt = momentFromInput(body.moment, documentDate);
  const inputPositions = (body.positions ?? []).filter(
    (position) => position.productId?.trim() && Number(position.quantity) > 0
  );
  if (inputPositions.length === 0) {
    return { ok: false as const, error: "Добавьте хотя бы одну позицию с количеством больше нуля" };
  }

  const productIds = [...new Set(inputPositions.map((position) => position.productId!.trim()))];
  const products = await prisma.localProduct.findMany({
    where: { OR: [{ id: { in: productIds } }, { id: { in: productIds } }] },
  });
  const productByAnyId = new Map<string, (typeof products)[number]>();
  for (const product of products) {
    productByAnyId.set(product.id, product);
    if (product.id) productByAnyId.set(product.id, product);
  }
  const currentPositionById = new Map(current.positions.map((position) => [position.id, position]));
  const currentPositionsByProduct = new Map<string, typeof current.positions>();
  for (const position of current.positions) {
    if (!position.productId) continue;
    currentPositionsByProduct.set(position.productId, [...(currentPositionsByProduct.get(position.productId) ?? []), position]);
  }
  const inputCountByProduct = new Map<string, number>();
  for (const position of inputPositions) {
    const productId = position.productId!.trim();
    inputCountByProduct.set(productId, (inputCountByProduct.get(productId) ?? 0) + 1);
  }

  const positions = inputPositions.map((position) => {
    const sourcePositionId = position.id?.trim() ?? "";
    const productId = position.productId!.trim();
    const sourcePosition = sourcePositionId
      ? currentPositionById.get(sourcePositionId) ?? null
      : current.source === "rossko" && inputCountByProduct.get(productId) === 1 && currentPositionsByProduct.get(productId)?.length === 1
        ? currentPositionsByProduct.get(productId)![0]
        : null;
    if (sourcePositionId && !sourcePosition) {
      return { error: "Позиция складского документа не найдена" as const };
    }
    const product = productByAnyId.get(productId);
    if (!product) return { error: `Товар не найден: ${position.productId}` as const };
    if (!isStockTrackedType(product.entityType)) return { error: `Позиция не является складским товаром: ${product.name}` as const };
    const quantity = Number(position.quantity) || 0;
    const inputPriceCents = centsFromRub(position.price);
    const priceCents = type === "writeoff" && inputPriceCents <= 0
      ? product.buyPriceCents ?? 0
      : inputPriceCents;
    const salePriceCents = type === "receipt" && position.salePrice !== undefined
      ? Math.max(0, centsFromRub(position.salePrice))
      : null;
    return {
      product,
      quantity: new Prisma.Decimal(quantity),
      priceCents,
      salePriceCents,
      slotName: position.slotName?.trim() || null,
      makeDefaultCell: position.makeDefaultCell === true,
      raw: position,
      sourcePosition,
    };
  });
  const positionError = positions.find((position) => "error" in position);
  if (positionError && "error" in positionError) {
    return { ok: false as const, error: positionError.error };
  }

  const counterpartyId = body.counterpartyId?.trim();
  const supplierSnapshotName = supplierSnapshotNameFromId(counterpartyId);
  const counterparty = counterpartyId && !supplierSnapshotName
    ? await prisma.localCounterparty.findFirst({ where: { OR: [{ id: counterpartyId }, { id: counterpartyId }] } })
    : null;
  const sumCents = positions.reduce((sum, position) => {
    if ("error" in position) return sum;
    return sum + Math.round(position.quantity.toNumber() * position.priceCents);
  }, 0);
  const invoiceRequested = type === "receipt" && body.invoice?.create === true;
  const paidInvoiceLocked = supplierInvoiceHasPaymentRisk(current.supplierInvoice);
  if (!invoiceRequested && paidInvoiceLocked) {
    return {
      ok: false as const,
      error: "У этой приёмки есть оплаченный счёт поставщика. Счёт нельзя удалить при редактировании черновика, переведите его в проверку отдельно.",
    };
  }
  const invoiceDate = invoiceRequested ? documentDateFromInput(body.invoice?.invoiceDate || documentDate) : null;
  const invoiceDueDate = invoiceRequested ? optionalDocumentDateFromInput(body.invoice?.dueDate) : null;
  const invoiceStatus = invoiceRequested ? normalizeSupplierInvoiceStatus(body.invoice?.status) : null;
  const invoiceNumber = invoiceRequested
    ? body.invoice?.number?.trim() || current.supplierInvoice?.number || await nextSupplierInvoiceNumber(invoiceDate!)
    : null;
  const shouldRefreshWriteoffName = type === "writeoff" && (current.adjustmentType ?? "expense") !== adjustmentType;
  const nextName = shouldRefreshWriteoffName
    ? await nextStockDocumentName(type, documentDate, adjustmentType)
    : current.name;

  let updated: {
    id: string;
    name: string;
    type: string;
    status: string;
    applicable: boolean;
    adjustmentType: string | null;
    adjustmentMethod: string | null;
    adjustmentReason: string | null;
    affectsManagementProfit: boolean;
  };
  try {
    const oldSnapshot = stockDocumentSnapshot(current);
    updated = await prisma.$transaction(async (tx) => {
      const document = await tx.localInventoryDocument.update({
      where: { id: current.id },
      data: {
        name: nextName,
        momentAt,
        documentDate,
        status: applicable ? "posted" : "draft",
        applicable,
        sumCents,
        description: body.description?.trim() || null,
        adjustmentType,
        adjustmentMethod,
        adjustmentReason,
        affectsManagementProfit,
        counterpartyId: counterparty?.id ?? null,
        counterpartyNameSnapshot: counterparty?.name ?? supplierSnapshotName,
        storeId: store?.id ?? null,
        storeNameSnapshot: store?.name ?? null,
        createdByLogin: user?.login ?? current.createdByLogin,
        createdByName: user?.name ?? current.createdByName,
        raw: current.source === "rossko"
          ? toJson({
              ...jsonRecord(current.raw),
              lastEditedAt: new Date().toISOString(),
              lastEditedBy: user?.login ?? null,
            })
          : toJson(body),
      },
    });

    await tx.localInventoryDocumentPosition.deleteMany({ where: { documentId: document.id } });
    await tx.localInventoryDocumentPosition.createMany({
      data: positions.map((position) => {
        if ("error" in position) throw new Error(position.error);
        return {
          documentId: document.id,
          productId: position.product.id,
          productName: position.product.name,
          quantity: position.quantity,
          priceCentsPerUnit: position.priceCents,
          slotName: position.slotName,
          source: position.sourcePosition?.source ?? "local",
          externalCode: position.sourcePosition?.externalCode ?? null,
          raw: position.sourcePosition
            ? toJson({
                ...jsonRecord(position.sourcePosition.raw),
                salePrice: position.raw.salePrice,
                makeDefaultCell: position.raw.makeDefaultCell,
              })
            : toJson(position.raw),
        };
      }),
    });

    if (type === "receipt") {
      for (const position of positions) {
        if ("error" in position) throw new Error(position.error);
        if (position.salePriceCents === null || position.salePriceCents === position.product.salePriceCents) continue;
        await tx.localProduct.update({
          where: { id: position.product.id },
          data: { salePriceCents: position.salePriceCents, syncedAt: new Date() },
        });
      }
    }

    if (invoiceRequested) {
      await tx.localSupplierInvoice.upsert({
        where: { documentId: document.id },
        create: {
          documentId: document.id,
          number: invoiceNumber,
          invoiceDate: invoiceDate!,
          dueDate: invoiceDueDate,
          status: invoiceStatus!,
          sumCents,
          paidAmountCents: initialPaidCentsForStatus(invoiceStatus!, sumCents),
          source: "receipt",
          createdBy: user?.login ?? null,
          counterpartyNameSnapshot: counterparty?.name ?? supplierSnapshotName,
          raw: toJson(body.invoice),
        },
        update: {
          number: invoiceNumber,
          invoiceDate: invoiceDate!,
          dueDate: invoiceDueDate,
          status: paidInvoiceLocked ? "requires_review" : invoiceStatus!,
          sumCents,
          paidAmountCents: paidInvoiceLocked
            ? current.supplierInvoice?.paidAmountCents ?? 0
            : initialPaidCentsForStatus(invoiceStatus!, sumCents),
          counterpartyNameSnapshot: counterparty?.name ?? supplierSnapshotName,
          raw: toJson(body.invoice),
        },
      });
    } else {
      await tx.localSupplierInvoice.deleteMany({ where: { documentId: document.id } });
    }

    if (applicable) {
      if (!store) throw new Error("Выберите склад");
      await assertNoActiveInventoryLocks(tx, {
        organizationId: store.organizationId,
        warehouseId: store.id,
        productIds: positions.map((position) => "error" in position ? null : position.product.id),
      });
      for (const position of positions) {
        if ("error" in position) throw new Error(position.error);
        const delta = position.quantity.toNumber() * (type === "receipt" ? 1 : -1);
        const currentBalance = await tx.localStockBalance.findUnique({
          where: { productId_storeId: { productId: position.product.id, storeId: store.id } },
        });
        const currentQuantity = currentBalance?.quantity.toNumber() ?? 0;
        const reserve = currentBalance?.reserve.toNumber() ?? 0;
        const currentAvailable = currentBalance?.available.toNumber() ?? currentQuantity - reserve;
        if (type === "writeoff") {
          if (currentQuantity < 0) {
            throw new Error(`Остаток товара «${position.product.name}» уже отрицательный. Используйте корректировку фактического остатка.`);
          }
          if (position.quantity.toNumber() > currentQuantity + 0.000001) {
            throw new Error(`Нельзя списать ${position.quantity.toNumber()} шт. товара «${position.product.name}»: на складе ${currentQuantity} шт.`);
          }
          if (position.quantity.toNumber() > currentAvailable + 0.000001) {
            throw new Error(`Из ${currentQuantity} шт. товара «${position.product.name}» ${reserve} шт. находятся в резерве. Сначала снимите резерв или выберите меньшее количество.`);
          }
        }
        const nextQuantity = currentQuantity + delta;
        const nextAvailable = nextQuantity - reserve;
        if (nextQuantity < -0.000001 || nextAvailable < -0.000001) {
          throw new Error(`Операция создаёт отрицательный остаток по товару «${position.product.name}»`);
        }
        if (currentBalance) {
          await tx.localStockBalance.update({
            where: { id: currentBalance.id },
            data: {
              quantity: new Prisma.Decimal(nextQuantity),
              available: new Prisma.Decimal(nextAvailable),
              slotName: position.slotName ?? currentBalance.slotName,
              syncedAt: new Date(),
            },
          });
        } else {
          await tx.localStockBalance.create({
            data: {
              productId: position.product.id,
              storeId: store.id,
              quantity: new Prisma.Decimal(nextQuantity),
              reserve: new Prisma.Decimal(0),
              available: new Prisma.Decimal(nextAvailable),
              slotName: position.slotName,
              syncedAt: new Date(),
            },
          });
        }
        if (type === "receipt") {
          const productUpdate: Prisma.LocalProductUpdateInput = { syncedAt: new Date() };
          let shouldUpdateProduct = false;
          if (position.priceCents > 0) {
            productUpdate.buyPriceCents = position.priceCents;
            shouldUpdateProduct = true;
          }
          if (position.makeDefaultCell && position.slotName) {
            productUpdate.cell = position.slotName;
            shouldUpdateProduct = true;
          }
          if (shouldUpdateProduct) {
            await tx.localProduct.update({
              where: { id: position.product.id },
              data: productUpdate,
            });
          }
        }
      }
    }

    await writeStockDocumentAudit(tx, {
      documentId: document.id,
      action: applicable ? "post" : "update_draft",
      statusBefore: normalizeStockDocumentStatus(current.status, current.applicable),
      statusAfter: applicable ? "posted" : "draft",
      message: applicable ? "Черновик проведён. Остатки обновлены." : "Черновик приёмки сохранён.",
      oldValue: oldSnapshot,
      newValue: {
        ...stockDocumentSnapshot({
          ...document,
          positions: positions.map((position, index) => {
            if ("error" in position) throw new Error(position.error);
            return {
              id: `${document.id}:${index}`,
              productId: position.product.id,
              productName: position.product.name,
              quantity: position.quantity,
              priceCentsPerUnit: position.priceCents,
              slotName: position.slotName,
            };
          }),
          supplierInvoice: invoiceRequested
            ? {
                id: current.supplierInvoice?.id ?? "",
                number: invoiceNumber,
                status: paidInvoiceLocked ? "requires_review" : invoiceStatus!,
                sumCents,
                paidAmountCents: paidInvoiceLocked ? current.supplierInvoice?.paidAmountCents ?? 0 : initialPaidCentsForStatus(invoiceStatus!, sumCents),
              }
            : null,
        }),
        invoiceRequiresReview: paidInvoiceLocked,
      },
      user,
    });

      return document;
    });
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Не удалось провести складской документ" };
  }

  invalidateWarehouseReadCaches();

  return {
    ok: true as const,
    document: {
      id: updated.id,
      name: updated.name,
      type: updated.type,
      status: normalizeStockDocumentStatus(updated.status, updated.applicable),
      applicable: updated.applicable,
      adjustmentType: updated.adjustmentType,
      adjustmentMethod: updated.adjustmentMethod,
      adjustmentReason: updated.adjustmentReason,
      affectsManagementProfit: updated.affectsManagementProfit,
      invoice: invoiceRequested
        ? {
            number: invoiceNumber,
            invoiceDate,
            dueDate: invoiceDueDate,
            status: invoiceStatus,
            sum: sumCents / 100,
          }
        : null,
    },
  };
}

type ReceiptActionProblem = {
  productId?: string | null;
  productName?: string;
  message: string;
  currentQuantity?: number;
  currentAvailable?: number;
  rollbackQuantity?: number;
  projectedQuantity?: number;
  projectedAvailable?: number;
};

type ReceiptActionWarning = {
  message: string;
};

function receiptActionLabel(action: ReceiptDangerAction) {
  return action === "unpost" ? "вернуть приёмку в черновик" : "отменить приёмку";
}

function receiptActionSuccessMessage(action: ReceiptDangerAction) {
  return action === "unpost"
    ? "Приёмка возвращена в черновик. Складские движения отменены."
    : "Приёмка отменена. Документ сохранён в истории.";
}

function receiptPositionsByProduct(document: StockDocumentForAction) {
  const map = new Map<string, {
    productId: string;
    productName: string;
    quantity: number;
    priceCentsPerUnit: number;
  }>();
  for (const position of document.positions) {
    if (!position.productId) continue;
    const current = map.get(position.productId) ?? {
      productId: position.productId,
      productName: position.productName,
      quantity: 0,
      priceCentsPerUnit: position.priceCentsPerUnit,
    };
    current.quantity += position.quantity.toNumber();
    current.priceCentsPerUnit = position.priceCentsPerUnit || current.priceCentsPerUnit;
    map.set(position.productId, current);
  }
  return [...map.values()];
}

async function loadReceiptForAction(documentId: string) {
  getScopedBranchId();
  const id = documentId?.trim();
  if (!id) return null;
  return prisma.localInventoryDocument.findFirst({
    where: { id, type: "receipt" },
    include: stockDocumentActionInclude,
  });
}

export async function checkReceiptRollbackSafety(documentId: string, action: ReceiptDangerAction, user?: ActingUser) {
  const document = await loadReceiptForAction(documentId);
  if (!document) return { ok: false as const, error: "Приёмка не найдена", notFound: true };

  const permissionError = receiptPermissionError(user);
  if (permissionError) return { ok: false as const, error: permissionError, status: 403 };

  const problems: ReceiptActionProblem[] = [];
  const warnings: ReceiptActionWarning[] = [];
  const status = normalizeStockDocumentStatus(document.status, document.applicable);
  if (document.isDeleted) {
    problems.push({ message: "Удалённую приёмку нельзя изменить." });
  }
  if (!isReceiptPosted(document)) {
    problems.push({
      message: status === "cancelled"
        ? "Эта приёмка уже отменена."
        : "Операция доступна только для проведённой приёмки.",
    });
  }
  if (!document.storeId || !document.store) {
    problems.push({ message: "У приёмки не указан склад. Без склада нельзя безопасно отменить движение." });
  }
  const positions = receiptPositionsByProduct(document);
  if (positions.length === 0) {
    problems.push({ message: "В приёмке нет товарных позиций для отката." });
  }
  const productIds = positions.map((position) => position.productId);
  const productNames = new Map(positions.map((position) => [position.productId, position.productName]));

  if (document.storeId && productIds.length > 0) {
    const [balances, salesAfter, writeoffsAfter, inventoryAfter] = await Promise.all([
      prisma.localStockBalance.findMany({
        where: { storeId: document.storeId, productId: { in: productIds } },
      }),
      prisma.localDemandPosition.findMany({
        where: {
          productId: { in: productIds },
          demand: {
            is: {
              applicable: true,
              storeId: document.storeId,
              momentAt: { gt: document.momentAt },
            },
          },
        },
        include: { demand: { select: { id: true, name: true, momentAt: true } } },
        take: 20,
      }),
      prisma.localInventoryDocument.findMany({
        where: {
          id: { not: document.id },
          type: "writeoff",
          applicable: true,
          isDeleted: false,
          status: { not: "cancelled" },
          storeId: document.storeId,
          momentAt: { gt: document.momentAt },
          positions: { some: { productId: { in: productIds } } },
        },
        include: { positions: true },
        take: 20,
      }),
      prisma.inventoryLine.findMany({
        where: {
          productId: { in: productIds },
          warehouseId: document.storeId,
          session: {
            is: {
              postedAt: { gt: document.momentAt },
            },
          },
        },
        include: { session: { select: { number: true, postedAt: true } } },
        take: 20,
      }),
    ]);

    const balanceByProduct = new Map(balances.map((balance) => [balance.productId, balance]));
    for (const position of positions) {
      const balance = balanceByProduct.get(position.productId);
      if (!balance) {
        problems.push({
          productId: position.productId,
          productName: position.productName,
          message: `Нельзя ${receiptActionLabel(action)}: по товару «${position.productName}» нет текущего остатка на складе.`,
          rollbackQuantity: position.quantity,
        });
        continue;
      }
      const currentQuantity = balance.quantity.toNumber();
      const currentAvailable = balance.available.toNumber();
      const reserve = balance.reserve.toNumber();
      const projectedQuantity = currentQuantity - position.quantity;
      const projectedAvailable = projectedQuantity - reserve;
      if (projectedQuantity < -0.000001 || projectedAvailable < -0.000001) {
        problems.push({
          productId: position.productId,
          productName: position.productName,
          message: `Нельзя ${receiptActionLabel(action)}: товар «${position.productName}» уйдёт в отрицательный остаток.`,
          currentQuantity,
          currentAvailable,
          rollbackQuantity: position.quantity,
          projectedQuantity,
          projectedAvailable,
        });
      }
      if (reserve > 0 && currentAvailable < position.quantity - 0.000001) {
        problems.push({
          productId: position.productId,
          productName: position.productName,
          message: `Нельзя ${receiptActionLabel(action)}: по товару «${position.productName}» есть резерв ${formatQtyForError(reserve)} шт.`,
          currentQuantity,
          currentAvailable,
          rollbackQuantity: position.quantity,
          projectedQuantity,
          projectedAvailable,
        });
      }
    }

    const salesByProduct = new Map<string, string>();
    for (const sale of salesAfter) {
      if (!sale.productId || salesByProduct.has(sale.productId)) continue;
      salesByProduct.set(sale.productId, sale.demand.name);
    }
    for (const [productId, demandName] of salesByProduct) {
      const productName = productNames.get(productId) ?? "товар";
      problems.push({
        productId,
        productName,
        message: `Нельзя ${receiptActionLabel(action)}: товар «${productName}» уже был продан после этой приёмки (${demandName}).`,
      });
    }

    const writeoffProductIds = new Set<string>();
    for (const writeoff of writeoffsAfter) {
      for (const position of writeoff.positions) {
        if (position.productId && productIds.includes(position.productId)) writeoffProductIds.add(position.productId);
      }
    }
    for (const productId of writeoffProductIds) {
      const productName = productNames.get(productId) ?? "товар";
      problems.push({
        productId,
        productName,
        message: `Нельзя ${receiptActionLabel(action)}: товар «${productName}» уже участвовал в списании после этой приёмки.`,
      });
    }

    const inventoryProductIds = new Set(inventoryAfter.map((line) => line.productId).filter(Boolean) as string[]);
    for (const productId of inventoryProductIds) {
      const productName = productNames.get(productId) ?? "товар";
      problems.push({
        productId,
        productName,
        message: `Нельзя ${receiptActionLabel(action)}: товар «${productName}» уже участвовал в проведённой инвентаризации после этой приёмки.`,
      });
    }
  }

  if (supplierInvoiceHasPaymentRisk(document.supplierInvoice)) {
    warnings.push({
      message: "Счёт поставщика уже оплачен или частично оплачен. Приёмку можно изменить только с последующей проверкой счёта в финансах.",
    });
  } else if (document.supplierInvoice) {
    warnings.push({
      message: "Связанный счёт поставщика останется в системе и будет помечен как требующий проверки.",
    });
  }

  return {
    ok: true as const,
    documentId: document.id,
    action,
    canProceed: problems.length === 0,
    status,
    problems,
    warnings,
  };
}

function formatQtyForError(value: number) {
  return value.toLocaleString("ru-RU", { maximumFractionDigits: 3 });
}

async function rollbackPostedReceiptStock(
  tx: Prisma.TransactionClient,
  document: StockDocumentForAction
) {
  if (!document.storeId || !document.store) throw new Error("У приёмки не указан склад");
  const positions = receiptPositionsByProduct(document);
  await assertNoActiveInventoryLocks(tx, {
    organizationId: document.store.organizationId,
    warehouseId: document.store.id,
    productIds: positions.map((position) => position.productId),
  });
  for (const position of positions) {
    const balance = await tx.localStockBalance.findUnique({
      where: { productId_storeId: { productId: position.productId, storeId: document.store.id } },
    });
    if (!balance) throw new Error(`Нет текущего остатка по товару «${position.productName}»`);
    const currentQuantity = balance.quantity.toNumber();
    const reserve = balance.reserve.toNumber();
    const nextQuantity = currentQuantity - position.quantity;
    const nextAvailable = nextQuantity - reserve;
    if (nextQuantity < -0.000001 || nextAvailable < -0.000001) {
      throw new Error(`Откат создаёт отрицательный остаток по товару «${position.productName}»`);
    }
    await tx.localStockBalance.update({
      where: { id: balance.id },
      data: {
        quantity: new Prisma.Decimal(nextQuantity),
        available: new Prisma.Decimal(nextAvailable),
        syncedAt: new Date(),
      },
    });
  }
}

async function postDraftReceiptStock(
  tx: Prisma.TransactionClient,
  document: StockDocumentForAction
) {
  if (!document.storeId || !document.store) throw new Error("Выберите склад");
  const positions = document.positions.filter((position) => position.productId && position.product);
  if (positions.length === 0) throw new Error("Добавьте хотя бы одну позицию приёмки");
  await assertNoActiveInventoryLocks(tx, {
    organizationId: document.store.organizationId,
    warehouseId: document.store.id,
    productIds: positions.map((position) => position.productId),
  });
  for (const position of positions) {
    if (!position.productId || !position.product) continue;
    const quantity = position.quantity.toNumber();
    if (quantity <= 0) throw new Error(`Количество товара «${position.productName}» должно быть больше нуля`);
    if (position.priceCentsPerUnit <= 0) throw new Error(`Укажите закупочную цену товара «${position.productName}»`);
    const current = await tx.localStockBalance.findUnique({
      where: { productId_storeId: { productId: position.productId, storeId: document.store.id } },
    });
    const currentQuantity = current?.quantity.toNumber() ?? 0;
    const reserve = current?.reserve.toNumber() ?? 0;
    const nextQuantity = currentQuantity + quantity;
    const nextAvailable = nextQuantity - reserve;
    const raw = jsonRecord(position.raw);
    const makeDefaultCell = raw.makeDefaultCell === true;
    if (current) {
      await tx.localStockBalance.update({
        where: { id: current.id },
        data: {
          quantity: new Prisma.Decimal(nextQuantity),
          available: new Prisma.Decimal(nextAvailable),
          slotName: position.slotName ?? current.slotName,
          syncedAt: new Date(),
        },
      });
    } else {
      await tx.localStockBalance.create({
        data: {
          productId: position.productId,
          storeId: document.store.id,
          quantity: new Prisma.Decimal(nextQuantity),
          reserve: new Prisma.Decimal(0),
          available: new Prisma.Decimal(nextAvailable),
          slotName: position.slotName,
          syncedAt: new Date(),
        },
      });
    }
    const productUpdate: Prisma.LocalProductUpdateInput = { syncedAt: new Date() };
    let shouldUpdateProduct = false;
    if (position.priceCentsPerUnit > 0) {
      productUpdate.buyPriceCents = position.priceCentsPerUnit;
      shouldUpdateProduct = true;
    }
    if (makeDefaultCell && position.slotName) {
      productUpdate.cell = position.slotName;
      shouldUpdateProduct = true;
    }
    if (shouldUpdateProduct) {
      await tx.localProduct.update({
        where: { id: position.productId },
        data: productUpdate,
      });
    }
  }
}

export async function postLocalReceipt(documentId: string, user?: ActingUser) {
  const document = await loadReceiptForAction(documentId);
  if (!document) return { ok: false as const, error: "Приёмка не найдена", notFound: true };
  if (document.isDeleted) return { ok: false as const, error: "Удалённую приёмку нельзя провести" };
  if (!isReceiptDraft(document)) return { ok: false as const, error: "Провести можно только черновик приёмки" };
  const oldSnapshot = stockDocumentSnapshot(document);
  try {
    const updated = await prisma.$transaction(async (tx) => {
      await postDraftReceiptStock(tx, document);
      const next = await tx.localInventoryDocument.update({
        where: { id: document.id },
        data: {
          applicable: true,
          status: "posted",
          raw: toJson({
            ...jsonRecord(document.raw),
            postedAt: new Date().toISOString(),
            postedBy: user?.login ?? null,
          }),
        },
        include: stockDocumentActionInclude,
      });
      await writeStockDocumentAudit(tx, {
        documentId: document.id,
        action: "post",
        statusBefore: "draft",
        statusAfter: "posted",
        message: "Приёмка проведена. Остатки обновлены.",
        oldValue: oldSnapshot,
        newValue: stockDocumentSnapshot(next),
        user,
      });
      return next;
    });
    invalidateWarehouseReadCaches();
    return { ok: true as const, message: "Приёмка проведена. Остатки обновлены.", document: stockDocumentSnapshot(updated) };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Не удалось провести приёмку" };
  }
}

async function markReceiptInvoiceRequiresReview(
  tx: Prisma.TransactionClient,
  document: StockDocumentForAction
) {
  if (!document.supplierInvoice) return;
  await tx.localSupplierInvoice.update({
    where: { id: document.supplierInvoice.id },
    data: {
      status: "requires_review",
      raw: toJson({
        ...jsonRecord(document.supplierInvoice.raw),
        receiptStatusChangedAt: new Date().toISOString(),
        receiptStatusChangedFrom: normalizeStockDocumentStatus(document.status, document.applicable),
      }),
    },
  });
}

export async function unpostLocalReceipt(documentId: string, user?: ActingUser) {
  const check = await checkReceiptRollbackSafety(documentId, "unpost", user);
  if (!check.ok) return check;
  if (!check.canProceed) {
    return { ok: false as const, error: "Нельзя вернуть приёмку в черновик", problems: check.problems, warnings: check.warnings };
  }
  const document = await loadReceiptForAction(documentId);
  if (!document) return { ok: false as const, error: "Приёмка не найдена", notFound: true };
  const oldSnapshot = stockDocumentSnapshot(document);

  const updated = await prisma.$transaction(async (tx) => {
    await rollbackPostedReceiptStock(tx, document);
    await markReceiptInvoiceRequiresReview(tx, document);
    const next = await tx.localInventoryDocument.update({
      where: { id: document.id },
      data: {
        applicable: false,
        status: "draft",
        raw: toJson({
          ...jsonRecord(document.raw),
          unpostedAt: new Date().toISOString(),
          unpostedBy: user?.login ?? null,
        }),
      },
      include: stockDocumentActionInclude,
    });
    await writeStockDocumentAudit(tx, {
      documentId: document.id,
      action: "unpost",
      statusBefore: normalizeStockDocumentStatus(document.status, document.applicable),
      statusAfter: "draft",
      message: receiptActionSuccessMessage("unpost"),
      oldValue: oldSnapshot,
      newValue: stockDocumentSnapshot(next),
      user,
    });
    return next;
  });

  invalidateWarehouseReadCaches();
  return { ok: true as const, message: receiptActionSuccessMessage("unpost"), document: stockDocumentSnapshot(updated), warnings: check.warnings };
}

export async function cancelLocalReceipt(documentId: string, user?: ActingUser) {
  const check = await checkReceiptRollbackSafety(documentId, "cancel", user);
  if (!check.ok) return check;
  if (!check.canProceed) {
    return { ok: false as const, error: "Нельзя отменить приёмку", problems: check.problems, warnings: check.warnings };
  }
  const document = await loadReceiptForAction(documentId);
  if (!document) return { ok: false as const, error: "Приёмка не найдена", notFound: true };
  const oldSnapshot = stockDocumentSnapshot(document);

  const updated = await prisma.$transaction(async (tx) => {
    await rollbackPostedReceiptStock(tx, document);
    await markReceiptInvoiceRequiresReview(tx, document);
    const next = await tx.localInventoryDocument.update({
      where: { id: document.id },
      data: {
        applicable: false,
        status: "cancelled",
        cancelledAt: new Date(),
        cancelledById: user?.login ?? null,
        cancelledByName: user?.name ?? null,
        raw: toJson({
          ...jsonRecord(document.raw),
          cancelledAt: new Date().toISOString(),
          cancelledBy: user?.login ?? null,
        }),
      },
      include: stockDocumentActionInclude,
    });
    await writeStockDocumentAudit(tx, {
      documentId: document.id,
      action: "cancel",
      statusBefore: normalizeStockDocumentStatus(document.status, document.applicable),
      statusAfter: "cancelled",
      message: receiptActionSuccessMessage("cancel"),
      oldValue: oldSnapshot,
      newValue: stockDocumentSnapshot(next),
      user,
    });
    return next;
  });

  invalidateWarehouseReadCaches();
  return { ok: true as const, message: receiptActionSuccessMessage("cancel"), document: stockDocumentSnapshot(updated), warnings: check.warnings };
}

export async function softDeleteDraftReceipt(documentId: string, body: { invoiceAction?: string } = {}, user?: ActingUser) {
  const permissionError = receiptPermissionError(user);
  if (permissionError) return { ok: false as const, error: permissionError, status: 403 };
  const document = await loadReceiptForAction(documentId);
  if (!document) return { ok: false as const, error: "Приёмка не найдена", notFound: true };
  if (!isReceiptDraft(document)) {
    return {
      ok: false as const,
      error: "Проведённую приёмку нельзя удалить напрямую. Можно отменить, вернуть в черновик или создать корректировку.",
      status: 400,
    };
  }
  const invoiceAction = body.invoiceAction === "delete" ? "delete" : "keep";
  if (invoiceAction === "delete" && supplierInvoiceHasPaymentRisk(document.supplierInvoice)) {
    return { ok: false as const, error: "Счёт уже оплачен. Его нельзя удалить вместе с черновиком.", status: 400 };
  }
  const oldSnapshot = stockDocumentSnapshot(document);
  await prisma.$transaction(async (tx) => {
    if (invoiceAction === "delete" && document.supplierInvoice) {
      await tx.localSupplierInvoice.delete({ where: { id: document.supplierInvoice.id } });
    } else if (document.supplierInvoice) {
      await tx.localSupplierInvoice.update({
        where: { id: document.supplierInvoice.id },
        data: { status: "requires_review" },
      });
    }
    const next = await tx.localInventoryDocument.update({
      where: { id: document.id },
      data: {
        isDeleted: true,
        deletedAt: new Date(),
        deletedById: user?.login ?? null,
        deletedByName: user?.name ?? null,
        raw: toJson({
          ...jsonRecord(document.raw),
          deletedAt: new Date().toISOString(),
          deletedBy: user?.login ?? null,
          invoiceAction,
        }),
      },
      include: stockDocumentActionInclude,
    });
    await writeStockDocumentAudit(tx, {
      documentId: document.id,
      action: "delete_draft",
      statusBefore: "draft",
      statusAfter: "draft",
      message: "Черновик приёмки удалён.",
      oldValue: oldSnapshot,
      newValue: stockDocumentSnapshot(next),
      user,
    });
  });
  invalidateWarehouseReadCaches();
  return { ok: true as const, message: "Черновик приёмки удалён." };
}

export async function createReceiptCorrection(documentId: string, body: { reason?: string } = {}, user?: ActingUser) {
  const permissionError = receiptPermissionError(user);
  if (permissionError) return { ok: false as const, error: permissionError, status: 403 };
  const document = await loadReceiptForAction(documentId);
  if (!document) return { ok: false as const, error: "Приёмка не найдена", notFound: true };
  if (document.isDeleted) return { ok: false as const, error: "По удалённой приёмке нельзя создать корректировку" };
  if (document.positions.length === 0) return { ok: false as const, error: "В приёмке нет позиций для корректировки" };
  const reason = cleanText(body.reason) ?? `Корректировка приёмки ${document.name}`;
  const result = await createLocalStockDocument(
    {
      type: "writeoff",
      storeId: document.storeId ?? undefined,
      counterpartyId: document.counterpartyId ?? undefined,
      documentDate: toServiceDateInput(new Date()),
      description: `${reason}. Исходная приёмка: ${document.name}.`,
      adjustmentType: "technical",
      adjustmentMethod: "WRITE_OFF_QUANTITY",
      adjustmentReason: "Дублирующий складской документ",
      applicable: false,
      positions: document.positions
        .filter((position) => position.productId)
        .map((position) => ({
          productId: position.productId!,
          quantity: position.quantity.toNumber(),
          price: position.priceCentsPerUnit / 100,
          slotName: position.slotName ?? undefined,
        })),
    },
    user
  );
  if (!result.ok) return result;

  await prisma.$transaction(async (tx) => {
    await tx.localInventoryDocument.update({
      where: { id: result.document.id },
      data: {
        correctionOfId: document.id,
        raw: toJson({
          sourceReceiptId: document.id,
          sourceReceiptName: document.name,
          reason,
        }),
      },
    });
    await writeStockDocumentAudit(tx, {
      documentId: document.id,
      action: "create_correction",
      statusBefore: normalizeStockDocumentStatus(document.status, document.applicable),
      statusAfter: normalizeStockDocumentStatus(document.status, document.applicable),
      message: `Создана корректировка ${result.document.name}.`,
      newValue: { correctionDocumentId: result.document.id, correctionDocumentName: result.document.name, reason },
      user,
    });
    await writeStockDocumentAudit(tx, {
      documentId: result.document.id,
      action: "correction_created_from_receipt",
      statusAfter: "draft",
      message: `Корректировка создана по приёмке ${document.name}.`,
      newValue: { sourceReceiptId: document.id, sourceReceiptName: document.name, reason },
      user,
    });
  });
  invalidateWarehouseReadCaches();
  return {
    ok: true as const,
    message: "Создана корректировка приёмки.",
    document: {
      id: result.document.id,
      name: result.document.name,
      href: `/inventory/writeoffs?document=${encodeURIComponent(result.document.id)}&open=edit`,
    },
  };
}

export async function listReceiptAudit(documentId: string, user?: ActingUser) {
  const permissionError = user ? null : "Необходима авторизация";
  if (permissionError) return { ok: false as const, error: permissionError, status: 401 };
  const document = await loadReceiptForAction(documentId);
  if (!document) return { ok: false as const, error: "Приёмка не найдена", notFound: true };
  const logs = await prisma.localInventoryDocumentAuditLog.findMany({
    where: { documentId: document.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return {
    ok: true as const,
    audit: logs.map((log) => ({
      id: log.id,
      action: log.action,
      statusBefore: log.statusBefore,
      statusAfter: log.statusAfter,
      message: log.message ?? "",
      oldValue: log.oldValue,
      newValue: log.newValue,
      createdById: log.createdById ?? "",
      createdByName: log.createdByName ?? "",
      createdAt: log.createdAt.toISOString(),
    })),
  };
}

export async function listLocalStockDocuments(params: {
  type?: string;
  search?: string;
  limit?: number;
  offset?: number;
  /** Trusted branch scope from the server resolver; never accepted from the client. */
  branchIds?: string[];
}): Promise<StockDocumentAdminList> {
  const branchIds = trustedReadableBranchIds(params.branchIds);
  const limit = Math.min(100, Math.max(1, params.limit ?? 30));
  const offset = Math.max(0, params.offset ?? 0);
  const search = params.search?.trim() ?? "";
  const type = params.type === "receipt" || params.type === "writeoff" ? params.type : "";
  const cacheKey = JSON.stringify({ type, search, limit, offset, branchIds });
  const now = Date.now();
  const cached = inventoryListsCache.stockDocuments.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.value;

  const where: Prisma.LocalInventoryDocumentWhereInput = {
    branchId: { in: branchIds },
    isDeleted: false,
    ...(type ? { type } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { counterpartyNameSnapshot: { contains: search, mode: "insensitive" } },
            { storeNameSnapshot: { contains: search, mode: "insensitive" } },
            { description: { contains: search, mode: "insensitive" } },
            { adjustmentReason: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const [total, documents] = await Promise.all([
    prisma.localInventoryDocument.count({ where }),
    prisma.localInventoryDocument.findMany({
      where,
      include: {
        store: true,
        counterparty: true,
        positions: {
          include: {
            product: {
              include: {
                stockBalances: { include: { store: true }, orderBy: { store: { name: "asc" } } },
              },
            },
          },
          orderBy: { id: "asc" },
        },
        supplierInvoice: true,
      },
      orderBy: [{ momentAt: "desc" }],
      skip: offset,
      take: limit,
    }),
  ]);
  const value = {
    meta: { total, limit, offset },
    documents: documents.map((document) => ({
      id: document.id,
      branchId: document.branchId,
      type: document.type,
      name: document.name,
      moment: document.momentAt.toISOString(),
      documentDate: document.documentDate,
      status: normalizeStockDocumentStatus(document.status, document.applicable),
      applicable: document.applicable,
      sum: document.sumCents / 100,
      description: document.description ?? "",
      adjustmentType: document.adjustmentType,
      adjustmentMethod: document.adjustmentMethod,
      adjustmentReason: document.adjustmentReason ?? "",
      affectsManagementProfit: document.affectsManagementProfit,
      correctionOfId: document.correctionOfId,
      isDeleted: document.isDeleted,
      cancelledAt: document.cancelledAt?.toISOString() ?? null,
      deletedAt: document.deletedAt?.toISOString() ?? null,
      source: document.source,
      externalCode: document.externalCode,
      storeId: document.storeId ?? "",
      storeName: document.store?.name ?? document.storeNameSnapshot ?? "",
      counterpartyId: document.counterpartyId ?? "",
      counterpartyName: document.counterparty?.name ?? document.counterpartyNameSnapshot ?? "",
      positionsCount: document.positions.length,
      totalQuantity: document.positions.reduce((sum, position) => sum + position.quantity.toNumber(), 0),
      invoice: document.supplierInvoice
        ? {
            id: document.supplierInvoice.id,
            number: document.supplierInvoice.number ?? "",
            invoiceDate: document.supplierInvoice.invoiceDate,
            dueDate: document.supplierInvoice.dueDate ?? "",
            status: document.supplierInvoice.status,
            sum: document.supplierInvoice.sumCents / 100,
          }
        : null,
      positions: document.positions.map((position) => {
        const raw = jsonRecord(position.raw);
        const knownCells = position.product?.stockBalances
          .map((balance) => ({
            storeId: balance.storeId,
            storeName: balance.store?.name ?? "",
            available: balance.available.toNumber(),
            slotName: balance.slotName ?? "",
          }))
          .filter((balance) => balance.slotName) ?? [];
        const slotStoreId = position.slotName && document.storeId && knownCells.some(
          (cell) => cell.storeId === document.storeId && cell.slotName === position.slotName
        )
          ? document.storeId
          : "";
        return {
          id: position.id,
          source: position.source,
          externalCode: position.externalCode,
          productId: position.productId,
          name: position.productName,
          article: position.product?.article ?? "",
          code: position.product?.code ?? "",
          brand: position.product?.brand ?? "",
          entityType: position.product?.entityType ?? "",
          quantity: position.quantity.toNumber(),
          price: position.priceCentsPerUnit / 100,
          salePrice: Number.isFinite(Number(raw.salePrice))
            ? Number(raw.salePrice)
            : (position.product?.salePriceCents ?? 0) / 100,
          slotName: position.slotName ?? "",
          defaultCell: position.product?.cell ?? "",
          slotStoreId,
          knownCells,
          makeDefaultCell: raw.makeDefaultCell === true,
        };
      }),
    })),
  };
  inventoryListsCache.stockDocuments.set(cacheKey, {
    key: cacheKey,
    expiresAt: now + STOCK_DOCUMENTS_CACHE_MS,
    value,
  });
  return value;
}
