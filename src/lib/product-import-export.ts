import { Prisma } from "@prisma/client";
import * as XLSX from "xlsx";
import { buildCatalogSearchText } from "@/lib/catalog-search";
import { prisma } from "@/lib/db";
import { invalidateProductFilterOptions } from "@/lib/local-inventory-admin";
import { mergeProductCrossReferences } from "@/lib/product-cross-references";

type ProductWithStock = Prisma.LocalProductGetPayload<{
  include: { stockBalances: true };
}>;

export type ProductImportMode = "update" | "create" | "upsert" | "validate";
export type ProductImportErrorMode = "validRows" | "allOrNothing";

export type ProductImportOptions = {
  mode?: ProductImportMode;
  allowNameMatching?: boolean;
  emptyCellsClear?: boolean;
  errorMode?: ProductImportErrorMode;
  excludedRowIds?: string[];
};

type ImportAction = "create" | "update" | "skip" | "conflict";
type ImportStatus = "pending" | "ok" | "warning" | "error" | "conflict" | "skipped";
type ColumnKind = "text" | "money" | "number" | "date" | "boolean";
type ProductFieldKey =
  | "name"
  | "entityType"
  | "archived"
  | "article"
  | "code"
  | "externalCode"
  | "barcodeEan13"
  | "barcodeEan8"
  | "barcodeCode128"
  | "oem"
  | "oemParts"
  | "brand"
  | "groupPath"
  | "uomName"
  | "salePrice"
  | "buyPrice"
  | "minPrice"
  | "currencyName"
  | "vatLabel"
  | "minimumBalance"
  | "cell"
  | "supplierName"
  | "supplierAttribute"
  | "countryName"
  | "packageVolume"
  | "sae"
  | "apiSpec"
  | "acea"
  | "ilsac"
  | "atf"
  | "description"
  | "imageHref"
  | "weight"
  | "volume"
  | "modificationCode"
  | "tnvedCode"
  | "aceaExtra"
  | "oemAtf"
  | "rosskoPartNumber"
  | "rosskoBrand"
  | "rosskoMin"
  | "mannCharacteristicName"
  | "avito";

type ColumnDef = {
  key: string;
  label: string;
  field?: ProductFieldKey;
  kind?: ColumnKind;
  readonly?: boolean;
  aliases?: string[];
  width?: number;
};

type ParsedImportRow = {
  rowNumber: number;
  source: Record<string, unknown>;
  values: Record<string, unknown>;
  presentKeys: Set<string>;
};

type ImportPreviewRow = {
  rowNumber: number;
  matchedProductId: string | null;
  matchedProductName: string | null;
  action: ImportAction;
  status: ImportStatus;
  source: Record<string, unknown>;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  changedFields: Array<{ field: string; label: string; oldValue: unknown; newValue: unknown }>;
  errors: string[];
  warnings: string[];
};

const MAX_IMPORT_FILE_BYTES = 15 * 1024 * 1024;
const CLEAR_MARKER = "#CLEAR";
const LEGACY_MANN_POMAN_KEY = "legacy_mann_poman";
const LEGACY_MANN_POMAN_WARNING = "Колонка MANN/POMAN устарела. Значения добавлены в OEM Parts.";
const prismaWithImport = prisma as typeof prisma & {
  productImportJob: {
    create(args: unknown): Promise<unknown>;
    findMany(args: unknown): Promise<unknown[]>;
    findUnique(args: unknown): Promise<unknown>;
    update(args: unknown): Promise<unknown>;
  };
  productImportRow: {
    createMany(args: unknown): Promise<unknown>;
    findMany(args: unknown): Promise<unknown[]>;
    update(args: unknown): Promise<unknown>;
  };
};

const columns: ColumnDef[] = [
  { key: "internal_id", label: "internal_id", readonly: true, aliases: ["id"], width: 26 },
  { key: "name", label: "Название", field: "name", width: 42 },
  { key: "type", label: "Тип", field: "entityType", width: 14 },
  { key: "status", label: "Статус", field: "archived", width: 14 },
  { key: "article", label: "Артикул", field: "article", width: 20 },
  { key: "code", label: "Код", field: "code", width: 18 },
  { key: "external_id", label: "Внешний ID", field: "externalCode", aliases: ["externalCode", "external_id"], width: 22 },
  { key: "ean13", label: "EAN13 / штрихкод", field: "barcodeEan13", aliases: ["ean", "barcode", "barcodeEan13"], width: 20 },
  { key: "ean8", label: "EAN8", field: "barcodeEan8", aliases: ["barcodeEan8"], width: 16 },
  { key: "code128", label: "Code128", field: "barcodeCode128", aliases: ["barcodeCode128"], width: 18 },
  { key: "oem", label: "OEM", field: "oem", width: 26 },
  { key: "crosses", label: "OEM Parts / кросс-номера / аналоги", field: "oemParts", aliases: ["oemParts", "OEM PARTS"], width: 34 },
  { key: "brand", label: "Бренд", field: "brand", width: 18 },
  { key: "category", label: "Категория", field: "groupPath", aliases: ["group", "groupPath"], width: 32 },
  { key: "unit", label: "Ед. изм.", field: "uomName", aliases: ["uomName"], width: 14 },
  { key: "sale_price", label: "Цена продажи", field: "salePrice", kind: "money", width: 16 },
  { key: "buy_price", label: "Цена закупки", field: "buyPrice", kind: "money", width: 16 },
  { key: "min_price", label: "Минимальная цена", field: "minPrice", kind: "money", width: 18 },
  { key: "currency", label: "Валюта", field: "currencyName", width: 12 },
  { key: "vat", label: "НДС", field: "vatLabel", width: 14 },
  { key: "current_stock", label: "Текущий остаток", readonly: true, kind: "number", width: 16 },
  { key: "available", label: "Доступно", readonly: true, kind: "number", width: 14 },
  { key: "reserve", label: "Резерв", readonly: true, kind: "number", width: 14 },
  { key: "minimum_balance", label: "Неснижаемый остаток", field: "minimumBalance", kind: "number", width: 20 },
  { key: "warehouse_cell", label: "Ячейка склада", field: "cell", width: 18 },
  { key: "supplier", label: "Поставщик", field: "supplierName", width: 24 },
  { key: "preferredSupplierId", label: "preferredSupplierId", field: "supplierAttribute", width: 24 },
  { key: "procurementMode", label: "procurementMode", readonly: true, width: 18 },
  { key: "country", label: "Страна", field: "countryName", width: 16 },
  { key: "package_volume", label: "Объём / фасовка", field: "packageVolume", width: 18 },
  { key: "sae", label: "SAE", field: "sae", width: 12 },
  { key: "api", label: "API", field: "apiSpec", width: 14 },
  { key: "acea", label: "ACEA", field: "acea", width: 14 },
  { key: "ilsac", label: "ILSAC", field: "ilsac", width: 14 },
  { key: "atf", label: "ATF", field: "atf", width: 14 },
  { key: "description", label: "Описание", field: "description", width: 42 },
  { key: "photo_links", label: "Ссылки на фото", field: "imageHref", width: 34 },
  { key: "weight", label: "Вес", field: "weight", kind: "number", width: 12 },
  { key: "volume", label: "Объём", field: "volume", kind: "number", width: 12 },
  { key: "modification_code", label: "Код модификации", field: "modificationCode", width: 20 },
  { key: "tnved", label: "ТН ВЭД", field: "tnvedCode", width: 18 },
  { key: "acea_extra", label: "ACEA extra", field: "aceaExtra", width: 18 },
  { key: "oem_atf", label: "OEM ATF", field: "oemAtf", width: 24 },
  { key: "rossko_part_number", label: "Rossko part number", field: "rosskoPartNumber", width: 22 },
  { key: "rossko_brand", label: "Rossko brand", field: "rosskoBrand", width: 18 },
  { key: "rossko_min", label: "Rossko min", field: "rosskoMin", width: 14 },
  { key: "mann_characteristic", label: "Характеристика MANN", field: "mannCharacteristicName", width: 24 },
  { key: "avito", label: "Avito", field: "avito", kind: "boolean", width: 10 },
  { key: "custom_fields", label: "Доп. пользовательские поля", readonly: true, width: 30 },
  { key: "raw_external", label: "Внешние идентификаторы", readonly: true, width: 34 },
  { key: "created_at", label: "Дата создания", readonly: true, kind: "date", width: 22 },
  { key: "updated_at", label: "Дата изменения", readonly: true, kind: "date", width: 22 },
];

const importOnlyColumns: ColumnDef[] = [
  {
    key: LEGACY_MANN_POMAN_KEY,
    label: "MANN/POMAN",
    aliases: [
      "mann_name",
      "MANN name",
      "MANN",
      "POMAN",
      "POMAN / MANN",
      "POMAN / Наименование POMAN",
      "Наименование по Mann",
      "Наиминование по Mann",
      "mannName",
      "pomanName",
    ],
  },
];

const editableColumns = columns.filter((column) => column.field && !column.readonly);
const serviceColumns = columns.filter((column) => column.readonly);
const columnAliases = new Map<string, ColumnDef>();
for (const column of [...columns, ...importOnlyColumns]) {
  columnAliases.set(normalizeHeader(column.key), column);
  columnAliases.set(normalizeHeader(column.label), column);
  for (const alias of column.aliases ?? []) columnAliases.set(normalizeHeader(alias), column);
}

function toJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value == null) return Prisma.JsonNull;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function normalizeHeader(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, "_")
    .replace(/[^\p{L}\p{N}_]+/gu, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ");
}

function textOrNull(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

function safeExcelText(value: unknown) {
  if (value == null) return "";
  const text = String(value);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function moneyFromCents(value: number | null | undefined) {
  return value == null ? null : value / 100;
}

function decimalToNumber(value: Prisma.Decimal | null | undefined) {
  return value == null ? null : Number(value);
}

function stockTotals(product: ProductWithStock) {
  return product.stockBalances.reduce(
    (acc, row) => ({
      quantity: acc.quantity + Number(row.quantity),
      available: acc.available + Number(row.available),
      reserve: acc.reserve + Number(row.reserve),
    }),
    { quantity: 0, available: 0, reserve: 0 }
  );
}

function productSnapshot(product: ProductWithStock) {
  const totals = stockTotals(product);
  return {
    internal_id: product.id,
    name: product.name,
    type: product.entityType === "service" ? "услуга" : "товар",
    status: product.archived ? "архив" : "активен",
    article: product.article ?? "",
    code: product.code ?? "",
    external_id: product.externalCode ?? "",
    ean13: product.barcodeEan13 ?? "",
    ean8: product.barcodeEan8 ?? "",
    code128: product.barcodeCode128 ?? "",
    oem: product.oem ?? "",
    crosses: product.oemParts ?? "",
    brand: product.brand ?? "",
    category: product.groupPath ?? "",
    unit: product.uomName ?? "",
    sale_price: product.salePriceCents / 100,
    buy_price: moneyFromCents(product.buyPriceCents),
    min_price: moneyFromCents(product.minPriceCents),
    currency: product.currencyName ?? "руб.",
    vat: product.vatLabel ?? "",
    current_stock: totals.quantity,
    available: totals.available,
    reserve: totals.reserve,
    minimum_balance: decimalToNumber(product.minimumBalance),
    warehouse_cell: product.cell ?? "",
    supplier: product.legacySupplierName ?? "",
    preferredSupplierId: product.supplierAttribute ?? "",
    procurementMode: "",
    country: product.countryName ?? "",
    package_volume: product.packageVolume ?? "",
    sae: product.sae ?? "",
    api: product.apiSpec ?? "",
    acea: product.acea ?? "",
    ilsac: product.ilsac ?? "",
    atf: product.atf ?? "",
    description: product.description ?? "",
    photo_links: product.imageHref ?? "",
    weight: decimalToNumber(product.weight),
    volume: decimalToNumber(product.volume),
    modification_code: product.modificationCode ?? "",
    tnved: product.tnvedCode ?? "",
    acea_extra: product.aceaExtra ?? "",
    oem_atf: product.oemAtf ?? "",
    rossko_part_number: product.rosskoPartNumber ?? "",
    rossko_brand: product.rosskoBrand ?? "",
    rossko_min: product.rosskoMin ?? "",
    mann_characteristic: product.mannCharacteristicName ?? "",
    avito: product.avito == null ? "" : product.avito ? "да" : "нет",
    custom_fields: JSON.stringify(product.attributes ?? {}),
    raw_external: JSON.stringify({
      moyskladId: product.moyskladId,
      moyskladHref: product.moyskladHref,
      externalCode: product.externalCode,
    }),
    created_at: product.createdAt.toISOString(),
    updated_at: product.updatedAt.toISOString(),
  };
}

function workbookToBuffer(workbook: XLSX.WorkBook) {
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx", compression: true }) as Buffer;
}

function addWorksheet(workbook: XLSX.WorkBook, name: string, rows: unknown[][], widths?: number[]) {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!cols"] = (widths ?? []).map((wch) => ({ wch }));
  if (rows.length > 0) {
    sheet["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { c: 0, r: 0 }, e: { c: rows[0].length - 1, r: rows.length - 1 } }) };
  }
  XLSX.utils.book_append_sheet(workbook, sheet, name);
  return sheet;
}

async function loadProductsForExport(params: URLSearchParams) {
  const ids = (params.get("ids") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const scope = params.get("scope") ?? "all";
  const entity = params.get("entity") ?? "";
  const includeArchived = params.get("archived") === "1" || scope === "archived" || scope === "all";
  const products = await prisma.localProduct.findMany({
    where: {
      ...(ids.length ? { id: { in: ids } } : {}),
      ...(!includeArchived ? { archived: false } : {}),
      ...(scope === "active" ? { archived: false } : {}),
      ...(scope === "archived" ? { archived: true } : {}),
      ...(entity === "product" || entity === "service" ? { entityType: entity } : {}),
    },
    include: { stockBalances: true },
    orderBy: [{ name: "asc" }],
  });

  if (ids.length || scope !== "current") return products;

  const search = normalizeText(params.get("search") ?? "");
  const filters = {
    brand: params.getAll("brand"),
    supplier: params.getAll("supplier"),
    group: params.getAll("group"),
    sae: params.getAll("sae"),
    apiSpec: params.getAll("apiSpec"),
    acea: params.getAll("acea"),
    packageVolume: params.getAll("packageVolume"),
    entityType: params.getAll("entityType"),
    stock: params.get("stock") ?? "all",
  };
  return products.filter((product) => {
    const snapshot = productSnapshot(product);
    const text = normalizeText([
      snapshot.name,
      snapshot.article,
      snapshot.code,
      snapshot.external_id,
      snapshot.ean13,
      snapshot.oem,
      snapshot.crosses,
      snapshot.brand,
      snapshot.category,
      snapshot.supplier,
      snapshot.sae,
      snapshot.api,
      snapshot.acea,
    ].join(" "));
    if (search && !text.includes(search)) return false;
    const exact = (values: string[], current: unknown) => !values.length || values.some((value) => normalizeText(value) === normalizeText(current));
    if (!exact(filters.brand, snapshot.brand)) return false;
    if (!exact(filters.supplier, snapshot.supplier)) return false;
    if (!exact(filters.group, snapshot.category)) return false;
    if (!exact(filters.sae, snapshot.sae)) return false;
    if (!exact(filters.apiSpec, snapshot.api)) return false;
    if (!exact(filters.acea, snapshot.acea)) return false;
    if (!exact(filters.packageVolume, snapshot.package_volume)) return false;
    if (!exact(filters.entityType, product.entityType)) return false;
    if (filters.stock === "inStock" && Number(snapshot.available) <= 0) return false;
    if (filters.stock === "outOfStock" && Number(snapshot.available) > 0) return false;
    return true;
  });
}

async function referenceRows(products?: ProductWithStock[]) {
  const rows = products ?? await prisma.localProduct.findMany({ include: { stockBalances: true }, orderBy: [{ name: "asc" }] });
  const unique = (values: Array<string | null | undefined>) => [...new Set(values.map((value) => value?.trim()).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, "ru"));
  const groups = unique(rows.map((row) => row.groupPath));
  const brands = unique(rows.map((row) => row.brand));
  const suppliers = unique(rows.map((row) => row.legacySupplierName));
  const units = unique(rows.map((row) => row.uomName));
  const currencies = unique(rows.map((row) => row.currencyName)).length ? unique(rows.map((row) => row.currencyName)) : ["руб."];
  const vats = unique(rows.map((row) => row.vatLabel));
  const max = Math.max(groups.length, brands.length, suppliers.length, units.length, currencies.length, vats.length, 4);
  const result: unknown[][] = [["Категории", "Бренды", "Группы", "Поставщики", "Единицы", "Валюты", "НДС", "Режимы закупки", "Типы", "Статусы"]];
  for (let i = 0; i < max; i += 1) {
    result.push([
      groups[i] ?? "",
      brands[i] ?? "",
      groups[i] ?? "",
      suppliers[i] ?? "",
      units[i] ?? "",
      currencies[i] ?? "",
      vats[i] ?? "",
      ["manual", "auto", "on_demand"][i] ?? "",
      ["товар", "услуга"][i] ?? "",
      ["активен", "архив"][i] ?? "",
    ]);
  }
  return result;
}

function instructionRows() {
  return [
    ["Поле", "Правило"],
    ["internal_id", "Не меняйте вручную. По нему импорт безопасно обновляет существующий товар."],
    ["Название", "Обязательное поле для новых товаров."],
    ["Пустые ячейки", "По умолчанию не меняют существующее значение. Включите настройку очистки или используйте #CLEAR."],
    ["Остатки, резерв, доступно", "Не импортируются обычным импортом товаров. Остатки должны меняться складскими документами."],
    ["created_at, updated_at", "Служебные поля, импорт их не изменяет."],
    ["Создание", "Оставьте internal_id пустым и заполните название, тип, цены и нужные справочные поля."],
    ["Обновление", "Экспортируйте каталог, измените редактируемые поля и импортируйте этот же файл обратно."],
    ["Сопоставление", "Приоритет: internal_id, внешний ID, код, артикул, EAN, затем точное нормализованное название."],
    ["Массивы", "OEM Parts / кросс-номера / аналоги можно разделять запятой, точкой с запятой или новой строкой."],
    ["MANN/POMAN", "Отдельная колонка устарела. При импорте старого файла её значения добавляются в OEM Parts."],
  ];
}

export async function buildProductExportWorkbook(params: URLSearchParams) {
  const products = await loadProductsForExport(params);
  return buildProductsWorkbook(products);
}

export async function buildProductTemplateWorkbook() {
  return buildProductsWorkbook([]);
}

async function buildProductsWorkbook(products: ProductWithStock[]) {
  const workbook = XLSX.utils.book_new();
  const header = columns.map((column) => column.key);
  const rows = products.map((product) => {
    const snapshot = productSnapshot(product);
    return columns.map((column) => {
      const value = snapshot[column.key as keyof typeof snapshot];
      return typeof value === "string" ? safeExcelText(value) : value;
    });
  });
  addWorksheet(workbook, "Товары", [header, ...rows], columns.map((column) => column.width ?? 16));
  addWorksheet(workbook, "Справочники", await referenceRows(products), [28, 22, 28, 28, 16, 14, 16, 18, 14, 14]);
  addWorksheet(workbook, "Инструкция", instructionRows(), [28, 92]);
  return workbookToBuffer(workbook);
}

function isBlank(value: unknown) {
  return value == null || String(value).trim() === "";
}

function parseRowsFromWorkbook(buffer: Buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true, raw: false });
  const sheet = workbook.Sheets["Товары"] ?? workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("В Excel-файле не найден лист с товарами");
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, blankrows: false });
  const headerRow = matrix[0] ?? [];
  const mapped = headerRow.map((header) => columnAliases.get(normalizeHeader(header)) ?? null);
  const unknownColumns = headerRow
    .map((header, index) => ({ header: String(header ?? "").trim(), index }))
    .filter((item) => item.header && !mapped[item.index])
    .map((item) => item.header);
  if (!mapped.some((column) => column?.key === "name")) {
    throw new Error("В файле нет обязательной колонки name / Название");
  }
  const rows: ParsedImportRow[] = [];
  for (let i = 1; i < matrix.length; i += 1) {
    const raw = matrix[i] ?? [];
    if (raw.every(isBlank)) continue;
    const source: Record<string, unknown> = {};
    const values: Record<string, unknown> = {};
    const presentKeys = new Set<string>();
    raw.forEach((value, index) => {
      const column = mapped[index];
      const originalHeader = String(headerRow[index] ?? "").trim();
      if (originalHeader) source[originalHeader] = value;
      if (!column) return;
      values[column.key] = value;
      presentKeys.add(column.key);
    });
    rows.push({ rowNumber: i + 1, source, values, presentKeys });
  }
  return { rows, unknownColumns };
}

function normalizeEntityType(value: unknown) {
  const text = normalizeText(value);
  if (!text || text === "товар" || text === "product") return "product";
  if (text === "услуга" || text === "service") return "service";
  return null;
}

function normalizeStatus(value: unknown) {
  const text = normalizeText(value);
  if (!text || text === "активен" || text === "active") return false;
  if (text === "архив" || text === "архивный" || text === "archived") return true;
  return null;
}

function parseBoolean(value: unknown) {
  const text = normalizeText(value);
  if (!text) return null;
  if (["да", "true", "1", "yes"].includes(text)) return true;
  if (["нет", "false", "0", "no"].includes(text)) return false;
  return null;
}

function parseNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value ?? "").trim().replace(/\s+/g, "").replace(",", ".");
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function getCellValue(parsed: ParsedImportRow, column: ColumnDef, options: Required<ProductImportOptions>) {
  const value = parsed.values[column.key];
  if (String(value ?? "").trim() === CLEAR_MARKER) return { clear: true as const, value: null };
  if (isBlank(value)) {
    if (!options.emptyCellsClear) return { missing: true as const, value: undefined };
    return { clear: true as const, value: null };
  }
  if (column.field === "entityType") return { value: normalizeEntityType(value) };
  if (column.field === "archived") return { value: normalizeStatus(value) };
  if (column.kind === "money" || column.kind === "number") return { value: parseNumber(value) };
  if (column.kind === "boolean") return { value: parseBoolean(value) };
  return { value: String(value).trim() };
}

function cents(value: unknown) {
  const n = parseNumber(value) ?? 0;
  return Math.round(n * 100);
}

function nullableCents(value: unknown) {
  if (value == null || value === "") return null;
  const n = parseNumber(value);
  return n == null ? null : Math.round(n * 100);
}

function decimal(value: unknown) {
  if (value == null || value === "") return null;
  const n = parseNumber(value);
  return n == null ? null : new Prisma.Decimal(n);
}

function productInputFromPreview(after: Record<string, unknown>) {
  return {
    name: String(after.name ?? "").trim(),
    entityType: String(after.entityType ?? "product"),
    article: after.article ? String(after.article).trim() : null,
    code: after.code ? String(after.code).trim() : null,
    externalCode: after.externalCode ? String(after.externalCode).trim() : null,
    groupPath: after.groupPath ? String(after.groupPath).trim() : null,
    uomName: after.uomName ? String(after.uomName).trim() : null,
    salePriceCents: cents(after.salePrice),
    buyPriceCents: nullableCents(after.buyPrice),
    currencyName: String(after.currencyName ?? "руб.").trim() || "руб.",
    minimumBalance: decimal(after.minimumBalance),
    barcodeEan13: after.barcodeEan13 ? String(after.barcodeEan13).trim() : null,
    barcodeEan8: after.barcodeEan8 ? String(after.barcodeEan8).trim() : null,
    barcodeCode128: after.barcodeCode128 ? String(after.barcodeCode128).trim() : null,
    description: after.description ? String(after.description).trim() : null,
    minPriceCents: nullableCents(after.minPrice),
    minPriceCurrencyName: after.minPriceCurrencyName ? String(after.minPriceCurrencyName).trim() : null,
    countryName: after.countryName ? String(after.countryName).trim() : null,
    vatLabel: after.vatLabel ? String(after.vatLabel).trim() : null,
    legacySupplierName: after.supplierName ? String(after.supplierName).trim() : null,
    weight: decimal(after.weight),
    volume: decimal(after.volume),
    modificationCode: after.modificationCode ? String(after.modificationCode).trim() : null,
    tnvedCode: after.tnvedCode ? String(after.tnvedCode).trim() : null,
    sae: after.sae ? String(after.sae).trim() : null,
    oem: after.oem ? String(after.oem).trim() : null,
    acea: after.acea ? String(after.acea).trim() : null,
    apiSpec: after.apiSpec ? String(after.apiSpec).trim() : null,
    packageVolume: after.packageVolume ? String(after.packageVolume).trim() : null,
    avito: typeof after.avito === "boolean" ? after.avito : null,
    brand: after.brand ? String(after.brand).trim() : null,
    atf: after.atf ? String(after.atf).trim() : null,
    ilsac: after.ilsac ? String(after.ilsac).trim() : null,
    aceaExtra: after.aceaExtra ? String(after.aceaExtra).trim() : null,
    oemAtf: after.oemAtf ? String(after.oemAtf).trim() : null,
    rosskoPartNumber: after.rosskoPartNumber ? String(after.rosskoPartNumber).trim() : null,
    rosskoBrand: after.rosskoBrand ? String(after.rosskoBrand).trim() : null,
    rosskoMin: after.rosskoMin ? String(after.rosskoMin).trim() : null,
    supplierAttribute: after.supplierAttribute ? String(after.supplierAttribute).trim() : null,
    oemParts: after.oemParts ? String(after.oemParts).trim() : null,
    cell: after.cell ? String(after.cell).trim() : null,
    mannCharacteristicName: after.mannCharacteristicName ? String(after.mannCharacteristicName).trim() : null,
    imageHref: after.imageHref ? String(after.imageHref).trim() : null,
    archived: Boolean(after.archived),
  };
}

function currentEditableSnapshot(product: ProductWithStock) {
  const snapshot = productSnapshot(product);
  const result: Record<string, unknown> = {};
  for (const column of editableColumns) {
    if (!column.field) continue;
    if (column.field === "entityType") result[column.field] = product.entityType;
    else if (column.field === "archived") result[column.field] = product.archived;
    else if (column.kind === "money") result[column.field] = snapshot[column.key as keyof typeof snapshot];
    else if (column.kind === "number") result[column.field] = snapshot[column.key as keyof typeof snapshot];
    else if (column.kind === "boolean") result[column.field] = product.avito;
    else result[column.field] = snapshot[column.key as keyof typeof snapshot] ?? "";
  }
  result.id = product.id;
  result.updatedAt = product.updatedAt.toISOString();
  return result;
}

function buildSearchText(after: Record<string, unknown>) {
  return buildCatalogSearchText({
    name: textOrNull(after.name),
    article: textOrNull(after.article),
    code: textOrNull(after.code),
    externalCode: textOrNull(after.externalCode),
    groupPath: textOrNull(after.groupPath),
    uomName: textOrNull(after.uomName),
    barcodeEan13: textOrNull(after.barcodeEan13),
    barcodeEan8: textOrNull(after.barcodeEan8),
    barcodeCode128: textOrNull(after.barcodeCode128),
    description: textOrNull(after.description),
    supplierName: textOrNull(after.supplierName),
    tnvedCode: textOrNull(after.tnvedCode),
    sae: textOrNull(after.sae),
    oem: textOrNull(after.oem),
    acea: textOrNull(after.acea),
    apiSpec: textOrNull(after.apiSpec),
    packageVolume: textOrNull(after.packageVolume),
    brand: textOrNull(after.brand),
    atf: textOrNull(after.atf),
    ilsac: textOrNull(after.ilsac),
    aceaExtra: textOrNull(after.aceaExtra),
    oemAtf: textOrNull(after.oemAtf),
    rosskoPartNumber: textOrNull(after.rosskoPartNumber),
    rosskoBrand: textOrNull(after.rosskoBrand),
    rosskoMin: textOrNull(after.rosskoMin),
    supplierAttribute: textOrNull(after.supplierAttribute),
    oemParts: textOrNull(after.oemParts),
    cell: textOrNull(after.cell),
    mannCharacteristicName: textOrNull(after.mannCharacteristicName),
    entityType: textOrNull(after.entityType),
    currencyName: textOrNull(after.currencyName),
  });
}

function productDataFromAfter(after: Record<string, unknown>) {
  const data = productInputFromPreview(after);
  return {
    ...data,
    searchText: buildSearchText(after),
    raw: toJson({ importSource: "product-excel", importedAt: new Date().toISOString() }),
    syncedAt: new Date(),
  };
}

function buildChangedFields(before: Record<string, unknown> | null, after: Record<string, unknown>) {
  const changed: ImportPreviewRow["changedFields"] = [];
  for (const column of editableColumns) {
    if (!column.field) continue;
    const oldValue = before?.[column.field] ?? "";
    const newValue = after[column.field] ?? "";
    if (String(oldValue ?? "") === String(newValue ?? "")) continue;
    changed.push({ field: column.field, label: column.label, oldValue, newValue });
  }
  return changed;
}

function validateAfter(after: Record<string, unknown>, parsed: ParsedImportRow, existingProducts: ProductWithStock[], matchedId: string | null) {
  const errors: string[] = [];
  const warnings: string[] = [];
  const name = String(after.name ?? "").trim();
  if (!name) errors.push("Укажите название товара");
  if (!["product", "service"].includes(String(after.entityType ?? ""))) errors.push("Некорректный тип товара");
  for (const key of ["salePrice", "buyPrice", "minPrice", "minimumBalance", "weight", "volume"]) {
    const value = after[key];
    if (value == null || value === "") continue;
    const numeric = parseNumber(value);
    if (numeric == null) errors.push(`Некорректное число в поле ${key}`);
    if (["salePrice", "buyPrice", "minPrice", "minimumBalance"].includes(key) && numeric != null && numeric < 0) {
      errors.push(`Поле ${key} не может быть меньше нуля`);
    }
  }
  for (const column of serviceColumns) {
    if (parsed.presentKeys.has(column.key) && !isBlank(parsed.values[column.key]) && !["internal_id"].includes(column.key)) {
      warnings.push(`Служебное поле ${column.key} будет проигнорировано`);
    }
  }
  const checkUnique = (field: keyof ProductWithStock, label: string, value: unknown) => {
    const text = String(value ?? "").trim();
    if (!text) return;
    const matches = existingProducts.filter((product) => product.id !== matchedId && String(product[field] ?? "").trim() === text);
    if (matches.length) errors.push(`${label} уже используется: ${text}`);
  };
  checkUnique("code", "Код", after.code);
  checkUnique("article", "Артикул", after.article);
  checkUnique("barcodeEan13", "EAN13", after.barcodeEan13);
  checkUnique("barcodeEan8", "EAN8", after.barcodeEan8);
  return { errors, warnings };
}

function resolveMatch(parsed: ParsedImportRow, products: ProductWithStock[], options: Required<ProductImportOptions>) {
  const value = (key: string) => String(parsed.values[key] ?? "").trim();
  const byExact = (getter: (product: ProductWithStock) => unknown, raw: string) => {
    if (!raw) return [];
    return products.filter((product) => String(getter(product) ?? "").trim() === raw);
  };
  const priority = [
    byExact((product) => product.id, value("internal_id")),
    byExact((product) => product.externalCode, value("external_id")),
    byExact((product) => product.code, value("code")),
    byExact((product) => product.article, value("article")),
    byExact((product) => product.barcodeEan13, value("ean13")),
    byExact((product) => product.barcodeEan8, value("ean8")),
    byExact((product) => product.barcodeCode128, value("code128")),
  ];
  for (const matches of priority) {
    if (matches.length === 1) return { product: matches[0], conflict: false };
    if (matches.length > 1) return { product: null, conflict: true };
  }
  if (!options.allowNameMatching) return { product: null, conflict: false };
  const normalizedName = normalizeText(value("name"));
  if (!normalizedName) return { product: null, conflict: false };
  const matches = products.filter((product) => normalizeText(product.name) === normalizedName);
  if (matches.length === 1) return { product: matches[0], conflict: false };
  if (matches.length > 1) return { product: null, conflict: true };
  return { product: null, conflict: false };
}

function normalizeImportOptions(options?: ProductImportOptions): Required<ProductImportOptions> {
  return {
    mode: options?.mode ?? "upsert",
    allowNameMatching: options?.allowNameMatching ?? true,
    emptyCellsClear: options?.emptyCellsClear ?? false,
    errorMode: options?.errorMode ?? "validRows",
    excludedRowIds: options?.excludedRowIds ?? [],
  };
}

async function buildPreviewRows(rows: ParsedImportRow[], options: Required<ProductImportOptions>) {
  const products = await prisma.localProduct.findMany({ include: { stockBalances: true }, orderBy: [{ name: "asc" }] });
  const preview: ImportPreviewRow[] = [];
  const seenKeys = new Map<string, number>();
  for (const parsed of rows) {
    const { product, conflict } = resolveMatch(parsed, products, options);
    const before = product ? currentEditableSnapshot(product) : null;
    const after: Record<string, unknown> = before ? { ...before } : { entityType: "product", archived: false, currencyName: "руб.", salePrice: 0 };
    for (const column of editableColumns) {
      if (!column.field || !parsed.presentKeys.has(column.key)) continue;
      const cell = getCellValue(parsed, column, options);
      if ("missing" in cell) continue;
      after[column.field] = cell.value;
    }
    if (after.oemParts) {
      after.oemParts = mergeProductCrossReferences(after.oemParts, []);
    }
    const rowWarnings: string[] = [];
    if (parsed.presentKeys.has(LEGACY_MANN_POMAN_KEY) && !isBlank(parsed.values[LEGACY_MANN_POMAN_KEY])) {
      after.oemParts = mergeProductCrossReferences(after.oemParts, [parsed.values[LEGACY_MANN_POMAN_KEY]]);
      rowWarnings.push(LEGACY_MANN_POMAN_WARNING);
    }
    const changedFields = buildChangedFields(before, after);
    const validation = validateAfter(after, parsed, products, product?.id ?? null);
    validation.warnings.push(...rowWarnings);
    const fingerprintParts = ["external_id", "code", "article", "ean13", "ean8", "code128"]
      .map((key) => `${key}:${normalizeText(parsed.values[key])}`)
      .filter((part) => !part.endsWith(":"));
    for (const part of fingerprintParts) {
      const previous = seenKeys.get(part);
      if (previous) validation.errors.push(`Дубль внутри Excel: ${part} уже встречался в строке ${previous}`);
      else seenKeys.set(part, parsed.rowNumber);
    }
    let action: ImportAction = "skip";
    if (conflict) action = "conflict";
    else if (product && options.mode !== "create") action = changedFields.length ? "update" : "skip";
    else if (!product && (options.mode === "create" || options.mode === "upsert")) action = "create";
    else action = "skip";
    if (options.mode === "validate") action = product ? (changedFields.length ? "update" : "skip") : "create";
    if (product && options.mode === "create") validation.warnings.push("Строка похожа на существующий товар и будет пропущена в режиме создания");
    if (!product && options.mode === "update") validation.warnings.push("Товар не найден и будет пропущен в режиме обновления");
    if (before?.archived === true && after.archived === false) validation.warnings.push("Архивный товар будет восстановлен как активный");
    const status: ImportStatus = conflict
      ? "conflict"
      : validation.errors.length
        ? "error"
        : action === "skip"
          ? "skipped"
          : validation.warnings.length
            ? "warning"
            : "pending";
    preview.push({
      rowNumber: parsed.rowNumber,
      matchedProductId: product?.id ?? null,
      matchedProductName: product?.name ?? null,
      action,
      status,
      source: parsed.source,
      before,
      after,
      changedFields,
      errors: validation.errors,
      warnings: validation.warnings,
    });
  }
  return preview;
}

function summarizeRows(rows: ImportPreviewRow[]) {
  return {
    totalRows: rows.length,
    createdRows: rows.filter((row) => row.action === "create" && row.status !== "error" && row.status !== "conflict").length,
    updatedRows: rows.filter((row) => row.action === "update" && row.status !== "error" && row.status !== "conflict").length,
    skippedRows: rows.filter((row) => row.action === "skip" || row.status === "skipped").length,
    errorRows: rows.filter((row) => row.status === "error").length,
    conflictRows: rows.filter((row) => row.status === "conflict").length,
  };
}

export async function validateProductImportFile(input: {
  fileName: string;
  contentType?: string;
  buffer: Buffer;
  options?: ProductImportOptions;
  userLogin?: string;
}) {
  if (!input.fileName.toLowerCase().endsWith(".xlsx")) throw new Error("Загрузите файл .xlsx");
  if (input.buffer.byteLength > MAX_IMPORT_FILE_BYTES) throw new Error("Файл слишком большой");
  const options = normalizeImportOptions(input.options);
  const { rows, unknownColumns } = parseRowsFromWorkbook(input.buffer);
  const previewRows = await buildPreviewRows(rows, options);
  if (unknownColumns.length) {
    for (const row of previewRows) row.warnings.push(`Неизвестные колонки будут проигнорированы: ${unknownColumns.join(", ")}`);
  }
  const summary = summarizeRows(previewRows);
  const job = await prismaWithImport.productImportJob.create({
    data: {
      fileName: input.fileName,
      mode: options.mode,
      status: options.mode === "validate" ? "dry_run" : "validated",
      totalRows: summary.totalRows,
      createdRows: summary.createdRows,
      updatedRows: summary.updatedRows,
      skippedRows: summary.skippedRows,
      errorRows: summary.errorRows,
      conflictRows: summary.conflictRows,
      optionsJson: toJson(options),
      createdByLogin: input.userLogin ?? null,
      completedAt: options.mode === "validate" ? new Date() : null,
      rows: {
        create: previewRows.map((row) => ({
          rowNumber: row.rowNumber,
          matchedProductId: row.matchedProductId,
          action: row.action,
          status: row.status,
          sourceJson: toJson(row.source),
          beforeJson: toJson(row.before),
          afterJson: toJson(row.after),
          changedFieldsJson: toJson(row.changedFields),
          errorMessage: [...row.errors, ...row.warnings].join("; ") || null,
        })),
      },
    },
    select: { id: true },
  }) as { id: string };
  return getProductImportJob(job.id);
}

function importRowFromDb(row: Record<string, unknown>): ImportPreviewRow {
  const message = String(row.errorMessage ?? "");
  const status = String(row.status ?? "pending") as ImportStatus;
  return {
    rowNumber: Number(row.rowNumber ?? 0),
    matchedProductId: typeof row.matchedProductId === "string" ? row.matchedProductId : null,
    matchedProductName: null,
    action: String(row.action ?? "skip") as ImportAction,
    status,
    source: row.sourceJson as Record<string, unknown> ?? {},
    before: row.beforeJson as Record<string, unknown> ?? null,
    after: row.afterJson as Record<string, unknown> ?? null,
    changedFields: row.changedFieldsJson as ImportPreviewRow["changedFields"] ?? [],
    errors: status === "error" || status === "conflict" ? [message].filter(Boolean) : [],
    warnings: status === "warning" || status === "skipped" ? [message].filter(Boolean) : [],
  };
}

export async function getProductImportJob(jobId: string) {
  const job = await prismaWithImport.productImportJob.findUnique({
    where: { id: jobId },
    include: { rows: { orderBy: { rowNumber: "asc" } } },
  }) as (Record<string, unknown> & { rows?: Record<string, unknown>[] }) | null;
  if (!job) return null;
  return {
    id: String(job.id),
    fileName: String(job.fileName),
    mode: String(job.mode),
    status: String(job.status),
    totalRows: Number(job.totalRows ?? 0),
    createdRows: Number(job.createdRows ?? 0),
    updatedRows: Number(job.updatedRows ?? 0),
    skippedRows: Number(job.skippedRows ?? 0),
    errorRows: Number(job.errorRows ?? 0),
    conflictRows: Number(job.conflictRows ?? 0),
    options: job.optionsJson,
    createdByLogin: job.createdByLogin,
    createdAt: job.createdAt instanceof Date ? job.createdAt.toISOString() : String(job.createdAt),
    completedAt: job.completedAt instanceof Date ? job.completedAt.toISOString() : job.completedAt,
    rollbackAt: job.rollbackAt instanceof Date ? job.rollbackAt.toISOString() : job.rollbackAt,
    rows: (job.rows ?? []).map(importRowFromDb),
  };
}

export async function listProductImportJobs(limit = 20) {
  const jobs = await prismaWithImport.productImportJob.findMany({
    orderBy: { createdAt: "desc" },
    take: Math.min(50, Math.max(1, limit)),
  }) as Record<string, unknown>[];
  return jobs.map((job) => ({
    id: String(job.id),
    fileName: String(job.fileName),
    mode: String(job.mode),
    status: String(job.status),
    totalRows: Number(job.totalRows ?? 0),
    createdRows: Number(job.createdRows ?? 0),
    updatedRows: Number(job.updatedRows ?? 0),
    skippedRows: Number(job.skippedRows ?? 0),
    errorRows: Number(job.errorRows ?? 0),
    conflictRows: Number(job.conflictRows ?? 0),
    createdByLogin: job.createdByLogin,
    createdAt: job.createdAt instanceof Date ? job.createdAt.toISOString() : String(job.createdAt),
    completedAt: job.completedAt instanceof Date ? job.completedAt.toISOString() : job.completedAt,
    rollbackAt: job.rollbackAt instanceof Date ? job.rollbackAt.toISOString() : job.rollbackAt,
  }));
}

export async function executeProductImport(jobId: string, options?: ProductImportOptions) {
  const job = await getProductImportJob(jobId);
  if (!job) throw new Error("Импорт не найден");
  if (job.status === "completed") throw new Error("Импорт уже выполнен");
  const normalized = normalizeImportOptions({ ...(job.options as ProductImportOptions), ...options });
  const excluded = new Set(normalized.excludedRowIds);
  const executable = job.rows.filter((row) => {
    const rowId = `${row.rowNumber}`;
    if (excluded.has(rowId)) return false;
    return (row.action === "create" || row.action === "update") && row.status !== "error" && row.status !== "conflict";
  });
  if (normalized.errorMode === "allOrNothing" && job.rows.some((row) => row.status === "error" || row.status === "conflict")) {
    throw new Error("В файле есть ошибки или конфликты. Исправьте их или выберите импорт корректных строк.");
  }

  let createdRows = 0;
  let updatedRows = 0;
  const executeRow = async (tx: Prisma.TransactionClient, row: ImportPreviewRow) => {
    if (!row.after) return;
    const data = productDataFromAfter(row.after);
    if (row.action === "create") {
      const created = await tx.localProduct.create({
        data: { ...data, origin: "IMPORT" },
        include: { stockBalances: true },
      });
      row.matchedProductId = created.id;
      row.after = { ...currentEditableSnapshot(created), id: created.id };
      createdRows += 1;
    } else if (row.action === "update" && row.matchedProductId) {
      const updated = await tx.localProduct.update({
        where: { id: row.matchedProductId },
        data,
        include: { stockBalances: true },
      });
      row.after = { ...currentEditableSnapshot(updated), id: updated.id };
      updatedRows += 1;
    }
  };

  if (normalized.errorMode === "allOrNothing") {
    await prisma.$transaction(async (tx) => {
      for (const row of executable) await executeRow(tx, row);
    });
  } else {
    for (const row of executable) {
      try {
        await prisma.$transaction(async (tx) => executeRow(tx, row));
        row.status = "ok";
      } catch (error) {
        row.status = "error";
        row.errors = [error instanceof Error ? error.message : String(error)];
      }
    }
  }

  for (const row of executable) {
    const dbRows = await prismaWithImport.productImportRow.findMany({ where: { jobId, rowNumber: row.rowNumber } }) as Array<{ id: string }>;
    const id = dbRows[0]?.id;
    if (!id) continue;
    await prismaWithImport.productImportRow.update({
      where: { id },
      data: {
        matchedProductId: row.matchedProductId,
        status: row.status === "pending" || row.status === "warning" ? "ok" : row.status,
        afterJson: toJson(row.after),
        errorMessage: [...row.errors, ...row.warnings].join("; ") || null,
      },
    });
  }

  const finalJob = await prismaWithImport.productImportJob.update({
    where: { id: jobId },
    data: {
      status: "completed",
      createdRows,
      updatedRows,
      skippedRows: job.rows.length - createdRows - updatedRows - job.errorRows - job.conflictRows,
      completedAt: new Date(),
      optionsJson: toJson(normalized),
    },
  }) as unknown;
  invalidateProductFilterOptions();
  void finalJob;
  return getProductImportJob(jobId);
}

export async function buildProductImportReport(jobId: string) {
  const job = await getProductImportJob(jobId);
  if (!job) throw new Error("Импорт не найден");
  const workbook = XLSX.utils.book_new();
  const rows = [
    ["row_number", "action", "status", "product_id", "message", "changed_fields"],
    ...job.rows.map((row) => [
      row.rowNumber,
      row.action,
      row.status,
      row.matchedProductId ?? "",
      [...row.errors, ...row.warnings].join("; "),
      row.changedFields.map((field) => `${field.label}: ${field.oldValue ?? ""} -> ${field.newValue ?? ""}`).join("\n"),
    ]),
  ];
  addWorksheet(workbook, "Отчёт", rows, [14, 14, 14, 28, 60, 80]);
  return workbookToBuffer(workbook);
}

export async function rollbackProductImport(jobId: string) {
  const job = await getProductImportJob(jobId);
  if (!job) throw new Error("Импорт не найден");
  if (job.rollbackAt) throw new Error("Импорт уже отменён");
  if (job.status !== "completed") throw new Error("Откат доступен только для выполненного импорта");
  let rolledBack = 0;
  const errors: string[] = [];
  for (const row of [...job.rows].reverse()) {
    if (!row.matchedProductId || (row.action !== "create" && row.action !== "update")) continue;
    const matchedProductId = row.matchedProductId;
    try {
      await prisma.$transaction(async (tx) => {
        const current = await tx.localProduct.findUnique({ where: { id: matchedProductId }, include: { stockBalances: true } });
        if (!current) return;
        const afterUpdatedAt = row.after?.updatedAt ? String(row.after.updatedAt) : "";
        if (afterUpdatedAt && current.updatedAt.toISOString() !== afterUpdatedAt) {
          throw new Error(`Строка ${row.rowNumber}: товар изменён после импорта`);
        }
        if (row.action === "create") {
          await tx.localProduct.delete({ where: { id: current.id } });
        } else if (row.before) {
          await tx.localProduct.update({ where: { id: current.id }, data: productDataFromAfter(row.before) });
        }
        rolledBack += 1;
      });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (errors.length) throw new Error(errors.join("; "));
  await prismaWithImport.productImportJob.update({ where: { id: jobId }, data: { rollbackAt: new Date(), status: "rolled_back" } });
  invalidateProductFilterOptions();
  return { rolledBack };
}
