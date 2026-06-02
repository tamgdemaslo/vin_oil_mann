import { Prisma, type LocalCounterparty } from "@prisma/client";
import type { User } from "@/lib/auth";
import { addExpense, getCurrentShift } from "@/lib/cashbox";
import { prisma } from "@/lib/db";
import { invalidateLocalInventoryFinanceCache } from "@/lib/local-inventory-finance";
import { normalizePhoneKey } from "@/lib/phone-normalize";

export type LocalStockDocumentType = "receipt" | "writeoff";

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
  supplierName?: string;
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
  archived?: boolean;
};

const productWithStockInclude = {
  stockBalances: { include: { store: true }, orderBy: { store: { name: "asc" as const } } },
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
  moyskladId: true,
  name: true,
  article: true,
  code: true,
  externalCode: true,
  groupPath: true,
  entityType: true,
  salePriceCents: true,
  buyPriceCents: true,
  barcodeEan13: true,
  barcodeEan8: true,
  barcodeCode128: true,
  description: true,
  supplierName: true,
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
  searchText: true,
  archived: true,
  updatedAt: true,
} satisfies Prisma.LocalProductSelect;
const restockProductInclude = {
  stockBalances: { include: { store: true }, orderBy: { store: { name: "asc" as const } } },
} satisfies Prisma.LocalProductInclude;

type CounterpartyInput = {
  name?: string;
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
  applicable?: boolean;
  positions?: {
    productId?: string;
    quantity?: number;
    price?: number;
    slotName?: string;
  }[];
  invoice?: {
    create?: boolean;
    number?: string;
    invoiceDate?: string;
    dueDate?: string;
    status?: string;
  } | null;
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
};

type ProductWithStock = Prisma.LocalProductGetPayload<{ include: typeof productWithStockInclude }>;
type ProductListIndexProduct = Prisma.LocalProductGetPayload<{ select: typeof productListIndexSelect }>;
type RestockProductWithStock = Prisma.LocalProductGetPayload<{ include: typeof restockProductInclude }>;
const supplierInvoiceInclude = {
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
} satisfies Prisma.LocalSupplierInvoiceInclude;
type SupplierInvoiceWithDocument = Prisma.LocalSupplierInvoiceGetPayload<{
  include: typeof supplierInvoiceInclude;
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
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return new Date(`${raw}T00:00:00`);
  const parts = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (parts) return new Date(`${parts[3]}-${parts[2].padStart(2, "0")}-${parts[1].padStart(2, "0")}T00:00:00`);
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function documentDateFromInput(value?: string): string {
  const raw = value?.trim();
  if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return new Date().toISOString().slice(0, 10);
}

function optionalDocumentDateFromInput(value?: string | null): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  return documentDateFromInput(raw);
}

function momentFromInput(value: string | undefined, documentDate: string): Date {
  const raw = value?.trim();
  const normalized = raw ? raw.replace(" ", "T") : `${documentDate}T00:00:00`;
  const parsed = new Date(normalized);
  return Number.isFinite(parsed.getTime()) ? parsed : new Date(`${documentDate}T00:00:00`);
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
  mannName?: string | null;
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
  return buildSearchText([
    input.name,
    input.article,
    input.code,
    input.externalCode,
    input.groupPath,
    input.barcodeEan13,
    input.barcodeEan8,
    input.barcodeCode128,
    input.description,
    input.supplierName,
    input.tnvedCode,
    input.sae,
    input.oem,
    input.acea,
    input.apiSpec,
    input.packageVolume,
    input.brand,
    input.atf,
    input.ilsac,
    input.aceaExtra,
    input.oemAtf,
    input.mannName,
    input.rosskoPartNumber,
    input.rosskoBrand,
    input.rosskoMin,
    input.supplierAttribute,
    input.oemParts,
    input.cell,
    input.mannCharacteristicName,
    input.entityType,
    input.currencyName,
  ]);
}

function buildCounterpartySearchText(input: {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  legalTitle?: string | null;
  legalLastName?: string | null;
  legalFirstName?: string | null;
  legalMiddleName?: string | null;
  legalAddress?: string | null;
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
    input.name,
    input.phone,
    normalizePhoneKey(input.phone),
    input.email,
    input.legalTitle,
    input.legalLastName,
    input.legalFirstName,
    input.legalMiddleName,
    input.legalAddress,
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
    moyskladId: product.moyskladId,
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
    supplierName: product.supplierName ?? "",
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
      supplierName: product.supplierName,
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
      mannName: product.mannName,
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
    entityType: product.entityType,
    salePrice: product.salePriceCents / 100,
    buyPrice: product.buyPriceCents == null ? null : product.buyPriceCents / 100,
    barcodeEan13: product.barcodeEan13 ?? "",
    barcodeEan8: product.barcodeEan8 ?? "",
    barcodeCode128: product.barcodeCode128 ?? "",
    description: product.description ?? "",
    supplierName: product.supplierName ?? "",
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
      supplierName: product.supplierName,
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
      mannName: product.mannName,
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
  | "entityType"
  | "salePrice"
  | "buyPrice"
  | "barcodeEan13"
  | "barcodeEan8"
  | "barcodeCode128"
  | "description"
  | "supplierName"
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
  stores: Array<{ id: string; name: string; archived: boolean; meta: ReturnType<typeof localMeta> }>;
};
type StockDocumentAdminList = {
  meta: { total: number; limit: number; offset: number };
  documents: Array<{
    id: string;
    type: string;
    name: string;
    moment: string;
    documentDate: string;
    applicable: boolean;
    sum: number;
    description: string;
    storeName: string;
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
  stores: { expiresAt: number; value: StoreAdminList } | null;
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
  stores: null,
  stockDocuments: new Map<string, CacheEntry<StockDocumentAdminList>>(),
  supplierInvoices: new Map<string, CacheEntry<SupplierInvoiceAdminList>>(),
  restockNeeds: new Map<string, CacheEntry<LocalRestockNeedsList>>(),
});
inventoryListsCache.stockDocuments ??= new Map<string, CacheEntry<StockDocumentAdminList>>();
inventoryListsCache.supplierInvoices ??= new Map<string, CacheEntry<SupplierInvoiceAdminList>>();
inventoryListsCache.restockNeeds ??= new Map<string, CacheEntry<LocalRestockNeedsList>>();

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
  invalidateStockDocumentLists();
  invalidateSupplierInvoiceLists();
  invalidateRestockNeedsLists();
  invalidateLocalInventoryFinanceCache();
}

async function getProductRowsForAdmin(includeArchived?: boolean) {
  const key = includeArchived ? "all" : "active";
  const now = Date.now();
  if (productAdminCache.rows?.key === key && productAdminCache.rows.expiresAt > now) {
    return productAdminCache.rows.rows;
  }

  const [products, balances] = await Promise.all([
    prisma.localProduct.findMany({
      where: includeArchived ? {} : { archived: false },
      select: productListIndexSelect,
      orderBy: [{ name: "asc" }],
    }),
    prisma.localStockBalance.findMany({
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

export async function getLocalAdminProduct(id: string) {
  const product = await prisma.localProduct.findFirst({
    where: { OR: [{ id }, { moyskladId: id }] },
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
    row.mannName,
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
    [row.mannName, 12],
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
  return true;
}

function mapCounterparty(counterparty: CounterpartyRow) {
  const rawExtra = counterpartyRawExtra(counterparty.raw);
  return {
    id: counterparty.id,
    moyskladId: counterparty.moyskladId,
    source: "local" as CounterpartySource,
    name: counterparty.name,
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
    vehiclePlate: rawExtra.vehiclePlate,
    vehicleVin: rawExtra.vehicleVin,
    vehicleModel: rawExtra.vehicleModel,
    vehicleYear: rawExtra.vehicleYear,
    vehicleLabel: compactCounterpartyVehicleLabel(rawExtra),
    createdAt: counterparty.createdAt.toISOString(),
    updatedAt: counterparty.updatedAt.toISOString(),
    searchText: buildCounterpartySearchText({
      name: counterparty.name,
      phone: counterparty.phone,
      email: counterparty.email,
      legalTitle: counterparty.legalTitle,
      legalLastName: counterparty.legalLastName,
      legalFirstName: counterparty.legalFirstName,
      legalMiddleName: counterparty.legalMiddleName,
      legalAddress: counterparty.legalAddress,
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
    moyskladId: null,
    source: "supplier",
    name,
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
  moyskladId: string | null;
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

function moyskladCounterpartyIdFromHref(href: string | null | undefined) {
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

function snapshotKey(input: { moyskladId?: string | null; normalizedPhone?: string | null; name?: string | null }) {
  if (input.moyskladId) return `moysklad:${input.moyskladId}`;
  if (input.normalizedPhone) return `phone:${input.normalizedPhone}`;
  const name = normalizeSearchText(input.name ?? "");
  return name ? `name:${name}` : "";
}

function ensureSnapshotBuilder(
  builders: Map<string, SnapshotCounterpartyBuilder>,
  input: { moyskladId?: string | null; name?: string | null; phone?: string | null; normalizedPhone?: string | null }
) {
  const name = input.name?.trim() ?? "";
  const phone = input.phone?.trim() ?? "";
  const normalizedPhone = input.normalizedPhone?.trim() || normalizePhoneKey(phone) || "";
  const key = snapshotKey({ moyskladId: input.moyskladId, normalizedPhone, name });
  if (!key || (!name && !phone && !normalizedPhone)) return null;

  const existing = builders.get(key);
  if (existing) {
    if (!existing.name && name) existing.name = name;
    if (!existing.phone && phone) existing.phone = phone;
    if (!existing.normalizedPhone && normalizedPhone) existing.normalizedPhone = normalizedPhone;
    if (!existing.moyskladId && input.moyskladId) existing.moyskladId = input.moyskladId;
    return existing;
  }

  const builder: SnapshotCounterpartyBuilder = {
    key,
    moyskladId: input.moyskladId ?? null,
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
    if (builder.moyskladId && row.moyskladId === builder.moyskladId) return true;
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
    moyskladId: builder.moyskladId,
    source: "snapshot",
    name: builder.name,
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

async function getDemandSnapshotCounterpartyRows(existingRows: CounterpartyListRow[]): Promise<CounterpartyCrmRow[]> {
  const builders = new Map<string, SnapshotCounterpartyBuilder>();

  try {
    const demands = await prisma.localDemand.findMany({
      where: {
        OR: [
          { agentMoyskladId: { not: null } },
          { agentNameSnapshot: { not: null } },
        ],
      },
      select: {
        name: true,
        momentAt: true,
        sumCents: true,
        description: true,
        agentMoyskladId: true,
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
        moyskladId: demand.agentMoyskladId,
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

  try {
    const analyticsDemands = await prisma.moySkladDemandSync.findMany({
      where: {
        applicable: true,
        OR: [
          { agentNameSnapshot: { not: null } },
          { normalizedPhone: { not: null } },
          { agentMetaHref: { not: null } },
        ],
      },
      select: {
        name: true,
        momentAt: true,
        sumCents: true,
        agentMetaHref: true,
        agentNameSnapshot: true,
        phonesRaw: true,
        normalizedPhone: true,
      },
      orderBy: { momentAt: "desc" },
      take: 20_000,
    });

    for (const demand of analyticsDemands) {
      const phones = phonesFromAnalyticsRaw(demand.phonesRaw);
      const phone = phones[0] ?? demand.normalizedPhone ?? "";
      const builder = ensureSnapshotBuilder(builders, {
        moyskladId: moyskladCounterpartyIdFromHref(demand.agentMetaHref),
        name: demand.agentNameSnapshot,
        phone,
        normalizedPhone: demand.normalizedPhone ?? normalizePhoneKey(phone),
      });
      if (!builder) continue;
      addSnapshotDemand(builder, {
        demandName: demand.name,
        momentAt: demand.momentAt,
        sumCents: demand.sumCents,
        searchParts: [phone, demand.normalizedPhone ?? "", demand.agentMetaHref ?? ""],
      });
    }
  } catch {
    // Historical analytics may be disabled on local/dev databases.
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

async function buildCounterpartyActivity(rows: CounterpartyListRow[]) {
  const ids = [...new Set(rows.map((row) => row.id).filter((id) => !supplierSnapshotNameFromId(id)))];
  const byId = new Map<string, ActivityBuilder>();
  for (const id of ids) {
    byId.set(id, { ...emptyCounterpartyActivity(), vehicleKeys: new Set<string>(), searchParts: [] });
  }
  if (ids.length === 0) return byId;

  const demands = await prisma.localDemand.findMany({
    where: { counterpartyId: { in: ids } },
    select: {
      counterpartyId: true,
      id: true,
      moyskladId: true,
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
        id: demand.moyskladId ?? demand.id,
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

async function enrichCounterpartyRows(rows: CounterpartyListRow[]): Promise<CounterpartyCrmRow[]> {
  const activityById = await buildCounterpartyActivity(rows);
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
    individuals: rows.filter((row) => row.companyType === "individual").length,
    companies: rows.filter((row) => row.companyType !== "individual").length,
    noPhone: rows.filter((row) => !row.phone && !row.additionalPhone).length,
    noRequisites: rows.filter((row) => !hasCounterpartyRequisites(row)).length,
  };
}

async function fastCounterpartyStats() {
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
    prisma.localCounterparty.count(),
    prisma.localCounterparty.count({ where: { archived: false } }),
    prisma.localCounterparty.count({ where: { archived: true } }),
    prisma.localCounterparty.count({ where: { companyType: "individual" } }),
    prisma.localCounterparty.count({ where: { AND: [{ OR: [{ phone: null }, { phone: "" }] }, { archived: false }] } }),
    prisma.localCounterparty.count({ where: { AND: [{ archived: false }, requisitesMissing] } }),
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
  };
  const allRows = await getProductRowsForAdmin(params.includeArchived);
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
        where: { id: { in: pageIds } },
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
    supplier: product.supplierName || product.supplierAttribute || null,
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

  const cacheKey = JSON.stringify({ mode, dateFrom, dateTo });
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

export async function createLocalAdminProduct(body: ProductInput) {
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
  const supplierName = cleanText(body.supplierName);
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
  const mannName = cleanText(body.mannName);
  const rosskoPartNumber = cleanText(body.rosskoPartNumber);
  const rosskoBrand = cleanText(body.rosskoBrand);
  const rosskoMin = cleanText(body.rosskoMin);
  const supplierAttribute = cleanText(body.supplierAttribute);
  const oemParts = cleanText(body.oemParts);
  const cell = cleanText(body.cell);
  const mannCharacteristicName = cleanText(body.mannCharacteristicName);
  const product = await prisma.localProduct.create({
    data: {
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
      supplierName,
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
      mannName,
      rosskoPartNumber,
      rosskoBrand,
      rosskoMin,
      supplierAttribute,
      oemParts,
      cell,
      mannCharacteristicName,
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
        supplierName,
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
        mannName,
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
  invalidateProductFilterOptions();
  invalidateRestockNeedsLists();
  invalidateLocalInventoryFinanceCache();
  return { ok: true as const, product: mapProduct(product) };
}

export async function updateLocalAdminProduct(id: string, body: ProductInput) {
  const current = await prisma.localProduct.findFirst({ where: { OR: [{ id }, { moyskladId: id }] } });
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
  const supplierName = body.supplierName === undefined ? current.supplierName : cleanText(body.supplierName);
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
  const mannName = body.mannName === undefined ? current.mannName : cleanText(body.mannName);
  const rosskoPartNumber =
    body.rosskoPartNumber === undefined ? current.rosskoPartNumber : cleanText(body.rosskoPartNumber);
  const rosskoBrand = body.rosskoBrand === undefined ? current.rosskoBrand : cleanText(body.rosskoBrand);
  const rosskoMin = body.rosskoMin === undefined ? current.rosskoMin : cleanText(body.rosskoMin);
  const supplierAttribute =
    body.supplierAttribute === undefined ? current.supplierAttribute : cleanText(body.supplierAttribute);
  const oemParts = body.oemParts === undefined ? current.oemParts : cleanText(body.oemParts);
  const cell = body.cell === undefined ? current.cell : cleanText(body.cell);
  const mannCharacteristicName =
    body.mannCharacteristicName === undefined ? current.mannCharacteristicName : cleanText(body.mannCharacteristicName);
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
      supplierName,
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
      mannName,
      rosskoPartNumber,
      rosskoBrand,
      rosskoMin,
      supplierAttribute,
      oemParts,
      cell,
      mannCharacteristicName,
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
        supplierName,
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
        mannName,
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
  invalidateProductFilterOptions();
  invalidateRestockNeedsLists();
  invalidateLocalInventoryFinanceCache();
  return { ok: true as const, product: mapProduct(product) };
}

function invalidateCounterpartyRows() {
  counterpartyAdminCache.rows = null;
}

async function getCounterpartyRowsForAdmin(includeArchived?: boolean) {
  const key = includeArchived ? "all" : "active";
  const now = Date.now();
  if (counterpartyAdminCache.rows?.key === key && counterpartyAdminCache.rows.expiresAt > now) {
    return counterpartyAdminCache.rows.rows;
  }

  const counterparties = await prisma.localCounterparty.findMany({
    where: includeArchived ? {} : { archived: false },
    orderBy: [{ name: "asc" }],
  });
  const rows = counterparties.map(mapCounterparty);
  counterpartyAdminCache.rows = { key, expiresAt: now + COUNTERPARTY_ROWS_CACHE_MS, rows };
  return rows;
}

async function getSupplierCounterpartyRows(existingRows: CounterpartyListRow[], includeArchived?: boolean) {
  const existingNames = new Set(existingRows.map((row) => normalizeSearchText(row.name)).filter(Boolean));
  return uniqueSorted((await getProductRowsForAdmin(includeArchived)).map((product) => product.supplierName), 1_000)
    .filter((name) => !existingNames.has(normalizeSearchText(name)))
    .map(mapSupplierNameCounterparty);
}

type CounterpartyStatusFilter = "active" | "archive" | "all";
type CounterpartyTypeFilter = "all" | "individual" | "company";
type CounterpartyPresenceFilter = "all" | "with" | "without";
type CounterpartySortKey = "name" | "createdAt" | "updatedAt" | "lastDemand";

function normalizeCounterpartyStatus(value?: string, includeArchived?: boolean): CounterpartyStatusFilter {
  if (value === "archive" || value === "all" || value === "active") return value;
  return includeArchived ? "all" : "active";
}

function normalizeCounterpartyType(value?: string): CounterpartyTypeFilter {
  return value === "individual" || value === "company" ? value : "all";
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
    ...(status === "active" ? { archived: false } : status === "archive" ? { archived: true } : {}),
    ...(type === "individual" ? { companyType: "individual" } : type === "company" ? { NOT: { companyType: "individual" } } : {}),
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
    fastCounterpartyStats(),
  ]);
  let filteredCounterparties = await enrichCounterpartyRows(baseRows.map(mapCounterparty));
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

export async function getLocalAdminCounterparty(id: string) {
  const cleanId = id.trim();
  if (!cleanId) return { ok: false as const, error: "id не указан", notFound: true as const };
  const counterparty = await prisma.localCounterparty.findFirst({
    where: {
      OR: [{ id: cleanId }, { moyskladId: cleanId }],
    },
  });
  if (!counterparty) {
    return { ok: false as const, error: "Контрагент не найден", notFound: true as const };
  }
  const [row] = await enrichCounterpartyRows([mapCounterparty(counterparty)]);
  return { ok: true as const, counterparty: row };
}

export async function createLocalAdminCounterparty(body: CounterpartyInput) {
  const name = body.name?.trim() ?? "";
  if (!name) return { ok: false as const, error: "Укажите имя или название контрагента" };
  const phone = body.phone?.trim() || null;
  const additionalPhone = body.additionalPhone?.trim() || null;
  const email = body.email?.trim() || null;
  const companyType = body.companyType?.trim() || "legal";
  const legalTitle = body.legalTitle?.trim() || null;
  const counterpartyTypeName = cleanText(body.counterpartyTypeName);
  const legalLastName = cleanText(body.legalLastName);
  const legalFirstName = cleanText(body.legalFirstName);
  const legalMiddleName = cleanText(body.legalMiddleName);
  const legalAddress = cleanText(body.legalAddress);
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
    additionalPhone,
    comment,
    vehicle: {
      plate: vehiclePlate,
      vin: vehicleVin,
      model: vehicleModel,
      year: vehicleYear,
    },
  };
  const counterparty = await prisma.localCounterparty.create({
    data: {
      name,
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
        name,
        phone,
        email,
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

export async function updateLocalAdminCounterparty(id: string, body: CounterpartyInput) {
  const current = await prisma.localCounterparty.findFirst({ where: { OR: [{ id }, { moyskladId: id }] } });
  if (!current) return { ok: false as const, error: "Контрагент не найден", notFound: true };
  const name = body.name == null ? current.name : body.name.trim();
  if (!name) return { ok: false as const, error: "Укажите имя или название контрагента" };
  const currentExtra = counterpartyRawExtra(current.raw);
  const phone = body.phone == null ? current.phone : body.phone.trim() || null;
  const additionalPhone =
    body.additionalPhone === undefined ? currentExtra.additionalPhone || null : body.additionalPhone.trim() || null;
  const email = body.email == null ? current.email : body.email.trim() || null;
  const companyType = body.companyType == null ? current.companyType ?? "legal" : body.companyType.trim() || "legal";
  const legalTitle = body.legalTitle == null ? current.legalTitle : body.legalTitle.trim() || null;
  const counterpartyTypeName =
    body.counterpartyTypeName === undefined ? current.counterpartyTypeName : cleanText(body.counterpartyTypeName);
  const legalLastName = body.legalLastName === undefined ? current.legalLastName : cleanText(body.legalLastName);
  const legalFirstName = body.legalFirstName === undefined ? current.legalFirstName : cleanText(body.legalFirstName);
  const legalMiddleName = body.legalMiddleName === undefined ? current.legalMiddleName : cleanText(body.legalMiddleName);
  const legalAddress = body.legalAddress === undefined ? current.legalAddress : cleanText(body.legalAddress);
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
      searchText: buildCounterpartySearchText({
        name,
        phone,
        email,
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

export async function listLocalStoresForAdmin(): Promise<StoreAdminList> {
  const now = Date.now();
  if (inventoryListsCache.stores && inventoryListsCache.stores.expiresAt > now) {
    return inventoryListsCache.stores.value;
  }

  const stores = await prisma.localStore.findMany({
    where: { archived: false },
    orderBy: [{ name: "asc" }],
  });
  const value = {
    stores: stores.map((store) => ({
      id: store.id,
      name: store.name,
      archived: store.archived,
      meta: localMeta("store", store.id),
    })),
  };
  inventoryListsCache.stores = { expiresAt: now + STORE_ROWS_CACHE_MS, value };
  return value;
}

async function nextStockDocumentName(type: LocalStockDocumentType, documentDate: string) {
  const prefix = type === "receipt" ? "ПР" : "СП";
  const count = await prisma.localInventoryDocument.count({
    where: { type, documentDate },
  });
  return `${prefix}-${documentDate.replaceAll("-", "")}-${String(count + 1).padStart(3, "0")}`;
}

async function nextSupplierInvoiceNumber(invoiceDate: string) {
  const count = await prisma.localSupplierInvoice.count({ where: { invoiceDate } });
  return `СЧ-${invoiceDate.replaceAll("-", "")}-${String(count + 1).padStart(3, "0")}`;
}

function normalizeSupplierInvoiceStatus(value?: string): "draft" | "unpaid" | "paid" | "partial" | "cancelled" {
  if (value === "draft" || value === "paid" || value === "partial" || value === "cancelled") return value;
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
  if (status === "cancelled" || status === "draft") return status;
  const remainingCents = Math.max(0, invoice.sumCents - effectivePaidCents(invoice));
  if (remainingCents <= 0) return "paid";
  const today = new Date().toISOString().slice(0, 10);
  if (invoice.dueDate && invoice.dueDate < today) return "overdue";
  if (effectivePaidCents(invoice) > 0) return "partial";
  return "unpaid";
}

function mapSupplierInvoice(invoice: SupplierInvoiceWithDocument) {
  const document = invoice.document;
  const paidAmountCents = effectivePaidCents(invoice);
  const remainingAmountCents = normalizeSupplierInvoiceStatus(invoice.status) === "cancelled"
    ? 0
    : Math.max(0, invoice.sumCents - paidAmountCents);
  return {
    id: invoice.id,
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
    counterpartyName: invoice.counterpartyNameSnapshot ?? document.counterparty?.name ?? document.counterpartyNameSnapshot ?? "",
    createdAt: invoice.createdAt.toISOString(),
    updatedAt: invoice.updatedAt.toISOString(),
    document: {
      id: document.id,
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
}): Promise<SupplierInvoiceAdminList> {
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
    params.source === "moysklad_import"
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
  });
  const now = Date.now();
  const cached = inventoryListsCache.supplierInvoices.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.value;

  const today = new Date().toISOString().slice(0, 10);
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
  const id = invoiceId?.trim();
  if (!id) return { ok: false as const, error: "Не выбран счёт поставщика" };

  const amountCents = centsFromRub(body.amount);
  if (amountCents <= 0) return { ok: false as const, error: "Сумма оплаты должна быть больше нуля" };

  const paymentDate = documentDateFromInput(body.paymentDate || new Date().toISOString().slice(0, 10));
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
    const shift = getCurrentShift();
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

export async function createLocalStockDocument(body: StockDocumentInput, user?: ActingUser) {
  const type = body.type === "receipt" || body.type === "writeoff" ? body.type : null;
  if (!type) return { ok: false as const, error: "Неизвестный тип складского документа" };
  const storeId = body.storeId?.trim() ?? "";
  const applicable = body.applicable !== false;
  const store = storeId
    ? await prisma.localStore.findFirst({ where: { OR: [{ id: storeId }, { moyskladId: storeId }] } })
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

  const productIds = [...new Set(inputPositions.map((position) => position.productId!.trim()))];
  const products = await prisma.localProduct.findMany({
    where: { OR: [{ id: { in: productIds } }, { moyskladId: { in: productIds } }] },
  });
  const productByAnyId = new Map<string, (typeof products)[number]>();
  for (const product of products) {
    productByAnyId.set(product.id, product);
    if (product.moyskladId) productByAnyId.set(product.moyskladId, product);
  }

  const positions = inputPositions.map((position) => {
    const product = productByAnyId.get(position.productId!.trim());
    if (!product) return { error: `Товар не найден: ${position.productId}` as const };
    if (!isStockTrackedType(product.entityType)) return { error: `Позиция не является складским товаром: ${product.name}` as const };
    const quantity = Number(position.quantity) || 0;
    const inputPriceCents = centsFromRub(position.price);
    const priceCents = type === "writeoff" && inputPriceCents <= 0
      ? product.buyPriceCents ?? 0
      : inputPriceCents;
    return {
      product,
      quantity: new Prisma.Decimal(quantity),
      priceCents,
      slotName: position.slotName?.trim() || null,
      raw: position,
    };
  });
  const positionError = positions.find((position) => "error" in position);
  if (positionError && "error" in positionError) {
    return { ok: false as const, error: positionError.error };
  }

  const counterpartyId = body.counterpartyId?.trim();
  const supplierSnapshotName = supplierSnapshotNameFromId(counterpartyId);
  const counterparty = counterpartyId && !supplierSnapshotName
    ? await prisma.localCounterparty.findFirst({ where: { OR: [{ id: counterpartyId }, { moyskladId: counterpartyId }] } })
    : null;
  const sumCents = positions.reduce((sum, position) => {
    if ("error" in position) return sum;
    return sum + Math.round(position.quantity.toNumber() * position.priceCents);
  }, 0);
  const name = await nextStockDocumentName(type, documentDate);
  const invoiceRequested = type === "receipt" && body.invoice?.create === true;
  const invoiceDate = invoiceRequested ? documentDateFromInput(body.invoice?.invoiceDate || documentDate) : null;
  const invoiceDueDate = invoiceRequested ? optionalDocumentDateFromInput(body.invoice?.dueDate) : null;
  const invoiceStatus = invoiceRequested ? normalizeSupplierInvoiceStatus(body.invoice?.status) : null;
  const invoiceNumber = invoiceRequested
    ? body.invoice?.number?.trim() || await nextSupplierInvoiceNumber(invoiceDate!)
    : null;

  const created = await prisma.$transaction(async (tx) => {
    const document = await tx.localInventoryDocument.create({
      data: {
        type,
        name,
        momentAt,
        documentDate,
        applicable,
        sumCents,
        description: body.description?.trim() || null,
        counterpartyId: counterparty?.id ?? null,
        counterpartyNameSnapshot: counterparty?.name ?? supplierSnapshotName,
        storeId: store?.id ?? null,
        storeNameSnapshot: store?.name ?? null,
        createdByLogin: user?.login ?? null,
        createdByName: user?.name ?? null,
        raw: toJson(body),
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
          raw: toJson(position.raw),
        };
      }),
    });

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
      for (const position of positions) {
        if ("error" in position) throw new Error(position.error);
        const delta = position.quantity.toNumber() * (type === "receipt" ? 1 : -1);
        const current = await tx.localStockBalance.findUnique({
          where: { productId_storeId: { productId: position.product.id, storeId: store.id } },
        });
        const reserve = current?.reserve.toNumber() ?? 0;
        const nextQuantity = (current?.quantity.toNumber() ?? 0) + delta;
        const nextAvailable = nextQuantity - reserve;
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
        if (type === "receipt" && position.priceCents > 0) {
          await tx.localProduct.update({
            where: { id: position.product.id },
            data: { buyPriceCents: position.priceCents, syncedAt: new Date() },
          });
        }
      }
    }

    return document;
  });

  invalidateWarehouseReadCaches();

  return {
    ok: true as const,
    document: {
      id: created.id,
      name: created.name,
      type: created.type,
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
  const id = documentId?.trim();
  if (!id) return { ok: false as const, error: "Не выбран складской документ" };

  const current = await prisma.localInventoryDocument.findUnique({
    where: { id },
    include: { supplierInvoice: true },
  });
  if (!current) return { ok: false as const, error: "Складской документ не найден", notFound: true };
  if (current.type !== "receipt" && current.type !== "writeoff") {
    return { ok: false as const, error: "Неизвестный тип складского документа" };
  }
  if (body.type && body.type !== current.type) {
    return { ok: false as const, error: "Тип складского документа нельзя изменить" };
  }
  if (current.applicable) {
    return { ok: false as const, error: "Проведённый документ нельзя редактировать. Создайте документ на основе." };
  }

  const type = current.type as LocalStockDocumentType;
  const storeId = body.storeId?.trim() ?? "";
  const applicable = body.applicable === true;
  const store = storeId
    ? await prisma.localStore.findFirst({ where: { OR: [{ id: storeId }, { moyskladId: storeId }] } })
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
    where: { OR: [{ id: { in: productIds } }, { moyskladId: { in: productIds } }] },
  });
  const productByAnyId = new Map<string, (typeof products)[number]>();
  for (const product of products) {
    productByAnyId.set(product.id, product);
    if (product.moyskladId) productByAnyId.set(product.moyskladId, product);
  }

  const positions = inputPositions.map((position) => {
    const product = productByAnyId.get(position.productId!.trim());
    if (!product) return { error: `Товар не найден: ${position.productId}` as const };
    if (!isStockTrackedType(product.entityType)) return { error: `Позиция не является складским товаром: ${product.name}` as const };
    const quantity = Number(position.quantity) || 0;
    const inputPriceCents = centsFromRub(position.price);
    const priceCents = type === "writeoff" && inputPriceCents <= 0
      ? product.buyPriceCents ?? 0
      : inputPriceCents;
    return {
      product,
      quantity: new Prisma.Decimal(quantity),
      priceCents,
      slotName: position.slotName?.trim() || null,
      raw: position,
    };
  });
  const positionError = positions.find((position) => "error" in position);
  if (positionError && "error" in positionError) {
    return { ok: false as const, error: positionError.error };
  }

  const counterpartyId = body.counterpartyId?.trim();
  const supplierSnapshotName = supplierSnapshotNameFromId(counterpartyId);
  const counterparty = counterpartyId && !supplierSnapshotName
    ? await prisma.localCounterparty.findFirst({ where: { OR: [{ id: counterpartyId }, { moyskladId: counterpartyId }] } })
    : null;
  const sumCents = positions.reduce((sum, position) => {
    if ("error" in position) return sum;
    return sum + Math.round(position.quantity.toNumber() * position.priceCents);
  }, 0);
  const invoiceRequested = type === "receipt" && body.invoice?.create === true;
  const invoiceDate = invoiceRequested ? documentDateFromInput(body.invoice?.invoiceDate || documentDate) : null;
  const invoiceDueDate = invoiceRequested ? optionalDocumentDateFromInput(body.invoice?.dueDate) : null;
  const invoiceStatus = invoiceRequested ? normalizeSupplierInvoiceStatus(body.invoice?.status) : null;
  const invoiceNumber = invoiceRequested
    ? body.invoice?.number?.trim() || current.supplierInvoice?.number || await nextSupplierInvoiceNumber(invoiceDate!)
    : null;

  const updated = await prisma.$transaction(async (tx) => {
    const document = await tx.localInventoryDocument.update({
      where: { id: current.id },
      data: {
        momentAt,
        documentDate,
        applicable,
        sumCents,
        description: body.description?.trim() || null,
        counterpartyId: counterparty?.id ?? null,
        counterpartyNameSnapshot: counterparty?.name ?? supplierSnapshotName,
        storeId: store?.id ?? null,
        storeNameSnapshot: store?.name ?? null,
        createdByLogin: user?.login ?? current.createdByLogin,
        createdByName: user?.name ?? current.createdByName,
        raw: toJson(body),
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
          raw: toJson(position.raw),
        };
      }),
    });

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
          status: invoiceStatus!,
          sumCents,
          paidAmountCents: initialPaidCentsForStatus(invoiceStatus!, sumCents),
          counterpartyNameSnapshot: counterparty?.name ?? supplierSnapshotName,
          raw: toJson(body.invoice),
        },
      });
    } else {
      await tx.localSupplierInvoice.deleteMany({ where: { documentId: document.id } });
    }

    if (applicable) {
      if (!store) throw new Error("Выберите склад");
      for (const position of positions) {
        if ("error" in position) throw new Error(position.error);
        const delta = position.quantity.toNumber() * (type === "receipt" ? 1 : -1);
        const currentBalance = await tx.localStockBalance.findUnique({
          where: { productId_storeId: { productId: position.product.id, storeId: store.id } },
        });
        const reserve = currentBalance?.reserve.toNumber() ?? 0;
        const nextQuantity = (currentBalance?.quantity.toNumber() ?? 0) + delta;
        const nextAvailable = nextQuantity - reserve;
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
        if (type === "receipt" && position.priceCents > 0) {
          await tx.localProduct.update({
            where: { id: position.product.id },
            data: { buyPriceCents: position.priceCents, syncedAt: new Date() },
          });
        }
      }
    }

    return document;
  });

  invalidateWarehouseReadCaches();

  return {
    ok: true as const,
    document: {
      id: updated.id,
      name: updated.name,
      type: updated.type,
      applicable: updated.applicable,
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

export async function listLocalStockDocuments(params: {
  type?: string;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<StockDocumentAdminList> {
  const limit = Math.min(100, Math.max(1, params.limit ?? 30));
  const offset = Math.max(0, params.offset ?? 0);
  const search = params.search?.trim() ?? "";
  const type = params.type === "receipt" || params.type === "writeoff" ? params.type : "";
  const cacheKey = JSON.stringify({ type, search, limit, offset });
  const now = Date.now();
  const cached = inventoryListsCache.stockDocuments.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.value;

  const where: Prisma.LocalInventoryDocumentWhereInput = {
    ...(type ? { type } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { counterpartyNameSnapshot: { contains: search, mode: "insensitive" } },
            { storeNameSnapshot: { contains: search, mode: "insensitive" } },
            { description: { contains: search, mode: "insensitive" } },
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
        positions: { include: { product: true }, orderBy: { id: "asc" } },
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
      type: document.type,
      name: document.name,
      moment: document.momentAt.toISOString(),
      documentDate: document.documentDate,
      applicable: document.applicable,
      sum: document.sumCents / 100,
      description: document.description ?? "",
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
      positions: document.positions.map((position) => ({
        id: position.id,
        productId: position.productId,
        name: position.productName,
        article: position.product?.article ?? "",
        code: position.product?.code ?? "",
        brand: position.product?.brand ?? "",
        quantity: position.quantity.toNumber(),
        price: position.priceCentsPerUnit / 100,
        slotName: position.slotName ?? "",
      })),
    })),
  };
  inventoryListsCache.stockDocuments.set(cacheKey, {
    key: cacheKey,
    expiresAt: now + STOCK_DOCUMENTS_CACHE_MS,
    value,
  });
  return value;
}
