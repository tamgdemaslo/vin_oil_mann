import { Prisma } from "@prisma/client";
import { buildCatalogSearchText } from "@/lib/catalog-search";
import { parseServiceDateTime, toServiceDateInput } from "@/lib/date-time";
import { prisma } from "@/lib/db";
import { isMoySkladSyncEnabled, moyskladDisabledMessage } from "@/lib/moysklad-flags";
import { getMoySkladHeaders, moyskladFetchWithRetry } from "@/lib/moysklad";
import { extractMoyskladEntityId } from "@/lib/piecework-rules";
import {
  listRawPhonesFromCounterparty,
  normalizePhoneKey,
  pickNormalizedPhoneFromCounterparty,
  type CounterpartyPhoneSource,
} from "@/lib/phone-normalize";

const SYNC_STATE_ID = "default";
const PAGE_LIMIT = 1000;
const DEMAND_PAGE_LIMIT = 100;
const DEMAND_POSITIONS_PAGE_LIMIT = 1000;
const MOYSKLAD_FETCH_ATTEMPTS = 5;
const POSITION_CONCURRENCY = 12;
const DB_RETRY_ATTEMPTS = 3;

export type LocalInventorySyncPhase =
  | "idle"
  | "stores"
  | "products"
  | "counterparties"
  | "stock"
  | "demands"
  | "done"
  | "error";

export type LocalInventorySyncStatus = {
  isRunning: boolean;
  mode: "snapshot" | "full" | null;
  phase: LocalInventorySyncPhase;
  startedAt: string | null;
  finishedAt: string | null;
  productsSynced: number;
  servicesSynced: number;
  counterpartiesSynced: number;
  storesSynced: number;
  stockRowsSynced: number;
  demandsSynced: number;
  message: string | null;
  error: string | null;
};

export type LocalInventorySyncOptions = {
  includeProducts?: boolean;
  includeCounterparties?: boolean;
  includeStores?: boolean;
  includeStock?: boolean;
  includeDemands?: boolean;
  productLimit?: number | null;
  counterpartyLimit?: number | null;
  demandLimit?: number | null;
  fullDemands?: boolean;
};

type SyncCounters = Pick<
  LocalInventorySyncStatus,
  "productsSynced" | "servicesSynced" | "counterpartiesSynced" | "storesSynced" | "stockRowsSynced" | "demandsSynced"
>;

type PageResponse<T> = {
  meta?: { size?: number; limit?: number; offset?: number };
  rows?: T[];
};

type ApiMeta = { href?: string; type?: string; mediaType?: string };

type ProductRow = {
  id: string;
  name?: string;
  article?: string;
  code?: string;
  externalCode?: string;
  pathName?: string;
  uom?: { name?: string; meta?: ApiMeta };
  minimumBalance?: number;
  barcodes?: Array<Record<string, unknown>>;
  description?: string;
  minPrice?: { value?: number; currency?: { name?: string } };
  country?: { name?: string; meta?: ApiMeta };
  vat?: number;
  vatEnabled?: boolean;
  supplier?: { name?: string; meta?: ApiMeta };
  weight?: number;
  volume?: number;
  modificationCode?: string;
  tnved?: string;
  archived?: boolean;
  meta?: ApiMeta;
  salePrices?: { value?: number; currency?: { name?: string } }[];
  buyPrice?: { value?: number };
  attributes?: { id?: string; name?: string; value?: unknown; meta?: { href?: string } }[];
  images?: {
    rows?: Array<{
      tiny?: { href?: string };
      miniature?: { href?: string };
      meta?: { href?: string };
    }>;
  };
} & Record<string, unknown>;

type StoreRow = {
  id: string;
  name?: string;
  archived?: boolean;
  meta?: ApiMeta;
} & Record<string, unknown>;

type CounterpartyRow = {
  id: string;
  name?: string;
  phone?: string;
  email?: string;
  phones?: Array<{ phone?: string } | string>;
  companyType?: string;
  legalTitle?: string;
  legalLastName?: string;
  legalFirstName?: string;
  legalMiddleName?: string;
  legalAddress?: string;
  legalAddressFull?: { addInfo?: string; postalCode?: string; city?: string; region?: string; street?: string };
  inn?: string;
  kpp?: string;
  okpo?: string;
  fax?: string;
  ogrn?: string;
  ogrnip?: string;
  accounts?: { rows?: Array<Record<string, unknown>> };
  archived?: boolean;
  meta?: ApiMeta;
} & Record<string, unknown>;

type StockByStoreRow = {
  assortment?: { meta?: ApiMeta };
  meta?: ApiMeta;
  stockByStore?: { name?: string; stock?: number; reserve?: number }[];
};

type DemandListRow = {
  id: string;
  name?: string;
  moment?: string;
  applicable?: boolean;
  sum?: number;
  description?: string;
  meta?: ApiMeta;
  attributes?: unknown[];
  agent?: ({ name?: string; meta?: ApiMeta } & CounterpartyPhoneSource & Record<string, unknown>) | null;
  organization?: { name?: string; meta?: ApiMeta } | null;
  store?: { name?: string; meta?: ApiMeta } | null;
} & Record<string, unknown>;

type DemandPositionRow = {
  id: string;
  quantity?: number;
  price?: number;
  discount?: number;
  cost?: number;
  assortment?: {
    name?: string;
    meta?: ApiMeta;
    buyPrice?: { value?: number };
  };
  slot?: { name?: string };
} & Record<string, unknown>;

type DemandLookupCache = {
  counterpartyByMoyskladId: Map<string, string>;
  productByMoyskladId: Map<string, string>;
  storeByMoyskladId: Map<string, string>;
};

function buildIdMap<T extends { id: string; moyskladId: string | null }>(rows: T[]): Map<string, string> {
  return new Map(rows.flatMap((row) => (row.moyskladId ? [[row.moyskladId, row.id] as const] : [])));
}

let activeSyncPromise: Promise<LocalInventorySyncStatus> | null = null;
let runtimeStatus: LocalInventorySyncStatus = createDefaultStatus();

function createDefaultStatus(): LocalInventorySyncStatus {
  return {
    isRunning: false,
    mode: null,
    phase: "idle",
    startedAt: null,
    finishedAt: null,
    productsSynced: 0,
    servicesSynced: 0,
    counterpartiesSynced: 0,
    storesSynced: 0,
    stockRowsSynced: 0,
    demandsSynced: 0,
    message: null,
    error: null,
  };
}

function setStatus(patch: Partial<LocalInventorySyncStatus>) {
  runtimeStatus = { ...runtimeStatus, ...patch };
}

function countersFromStatus(): SyncCounters {
  return {
    productsSynced: runtimeStatus.productsSynced,
    servicesSynced: runtimeStatus.servicesSynced,
    counterpartiesSynced: runtimeStatus.counterpartiesSynced,
    storesSynced: runtimeStatus.storesSynced,
    stockRowsSynced: runtimeStatus.stockRowsSynced,
    demandsSynced: runtimeStatus.demandsSynced,
  };
}

function mapStateRowToStatus(
  row: Awaited<ReturnType<typeof prisma.localInventorySyncState.findUnique>>
): LocalInventorySyncStatus {
  if (!row) return activeSyncPromise ? { ...runtimeStatus } : createDefaultStatus();
  const phase = (
    ["idle", "stores", "products", "counterparties", "stock", "demands", "done", "error"] as const
  ).includes(row.syncPhase as LocalInventorySyncPhase)
    ? (row.syncPhase as LocalInventorySyncPhase)
    : "idle";
  return {
    isRunning: row.syncRunning,
    mode: row.syncMode === "snapshot" || row.syncMode === "full" ? row.syncMode : null,
    phase,
    startedAt: row.syncStartedAt?.toISOString() ?? null,
    finishedAt: row.syncFinishedAt?.toISOString() ?? null,
    productsSynced: row.productsSynced,
    servicesSynced: row.servicesSynced,
    counterpartiesSynced: row.counterpartiesSynced,
    storesSynced: row.storesSynced,
    stockRowsSynced: row.stockRowsSynced,
    demandsSynced: row.demandsSynced,
    message: row.syncMessage,
    error: row.lastError,
  };
}

async function persistStatus(params?: { lastSyncedAt?: Date | null; lastError?: string | null }) {
  const counters = countersFromStatus();
  await prisma.localInventorySyncState.upsert({
    where: { id: SYNC_STATE_ID },
    create: {
      id: SYNC_STATE_ID,
      lastSyncedAt: params?.lastSyncedAt ?? null,
      lastError: params?.lastError ?? null,
      ...counters,
      syncRunning: runtimeStatus.isRunning,
      syncMode: runtimeStatus.mode,
      syncPhase: runtimeStatus.phase,
      syncStartedAt: runtimeStatus.startedAt ? new Date(runtimeStatus.startedAt) : null,
      syncFinishedAt: runtimeStatus.finishedAt ? new Date(runtimeStatus.finishedAt) : null,
      syncMessage: runtimeStatus.message,
    },
    update: {
      lastSyncedAt: params?.lastSyncedAt,
      lastError: params?.lastError,
      ...counters,
      syncRunning: runtimeStatus.isRunning,
      syncMode: runtimeStatus.mode,
      syncPhase: runtimeStatus.phase,
      syncStartedAt: runtimeStatus.startedAt ? new Date(runtimeStatus.startedAt) : null,
      syncFinishedAt: runtimeStatus.finishedAt ? new Date(runtimeStatus.finishedAt) : null,
      syncMessage: runtimeStatus.message,
    },
  });
}

function toJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value == null) return Prisma.JsonNull;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function asDateFromMoySkladMoment(moment?: string): { documentDate: string; momentAt: Date } {
  const raw = moment?.trim() || undefined;
  const parsed = parseServiceDateTime(raw ?? new Date());
  const documentDate = toServiceDateInput(parsed ?? new Date());
  const momentAt = parsed ?? parseServiceDateTime(`${documentDate} 00:00:00`) ?? new Date();
  return { documentDate, momentAt };
}

function normalizeForSearch(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function textOrNull(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function textOrUndefined(value: unknown): string | undefined {
  return textOrNull(value) ?? undefined;
}

function decimalOrUndefined(value: unknown): Prisma.Decimal | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? new Prisma.Decimal(n) : undefined;
}

function centsOrUndefined(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : undefined;
}

function attributeValueText(value: unknown): string | null {
  if (Array.isArray(value)) {
    const text = value.map(attributeValueText).filter(Boolean).join(" ");
    return text || null;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return textOrNull(record.name ?? record.value);
  }
  return textOrNull(value);
}

function attributeValueByName(attributes: ProductRow["attributes"], names: string[]): string | null {
  if (!Array.isArray(attributes)) return null;
  const normalizedNames = names.map((name) => name.trim().toLowerCase());
  const found = attributes.find((attr) => normalizedNames.includes(String(attr.name ?? "").trim().toLowerCase()));
  return found ? attributeValueText(found.value) : null;
}

function attributeBooleanByName(attributes: ProductRow["attributes"], names: string[]): boolean | undefined {
  const value = attributeValueByName(attributes, names);
  if (value == null) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "да"].includes(normalized)) return true;
  if (["0", "false", "no", "нет"].includes(normalized)) return false;
  return undefined;
}

function barcodesByType(row: ProductRow, key: "ean13" | "ean8" | "code128"): string | null {
  const values = (row.barcodes ?? [])
    .map((barcode) => textOrNull(barcode[key]))
    .filter((value): value is string => Boolean(value));
  return values.length > 0 ? values.join(" ") : null;
}

function vatLabel(row: ProductRow): string | undefined {
  if (row.vatEnabled === false) return "без НДС";
  if (row.vat != null) return `${row.vat}%`;
  return undefined;
}

function accountText(account: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  if (!account) return undefined;
  for (const key of keys) {
    const value = textOrUndefined(account[key]);
    if (value) return value;
  }
  return undefined;
}

function getFirstImageHref(row: ProductRow): string | null {
  const first = row.images?.rows?.[0];
  return first?.tiny?.href ?? first?.miniature?.href ?? first?.meta?.href ?? null;
}

function getEntityIdFromMeta(meta?: ApiMeta): string | null {
  return extractMoyskladEntityId(meta?.href);
}

function isReconnectableDbError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return (
    message.includes("Server has closed the connection") ||
    message.includes("Can't reach database server") ||
    message.includes("Connection terminated") ||
    message.includes("P1017") ||
    message.includes("P1001")
  );
}

async function withDbRetry<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= DB_RETRY_ATTEMPTS; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isReconnectableDbError(error) || attempt === DB_RETRY_ATTEMPTS) break;
      await prisma.$disconnect().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
      await prisma.$connect().catch(() => undefined);
    }
  }
  throw lastError;
}

async function fetchPagedRows<T>(
  buildPath: (offset: number, limit: number) => string,
  options?: { maxRows?: number | null; pageLimit?: number }
): Promise<T[]> {
  const pageLimit = Math.min(PAGE_LIMIT, Math.max(1, options?.pageLimit ?? PAGE_LIMIT));
  const maxRows = options?.maxRows != null && options.maxRows > 0 ? Math.floor(options.maxRows) : null;
  const rows: T[] = [];
  let offset = 0;
  let size = Number.POSITIVE_INFINITY;

  while (offset < size) {
    const res = await moyskladFetchWithRetry<PageResponse<T>>(
      buildPath(offset, pageLimit),
      { cache: "no-store" },
      MOYSKLAD_FETCH_ATTEMPTS
    );
    if (!res.ok) throw new Error(res.error);

    const chunk = res.data.rows ?? [];
    rows.push(...chunk);
    if (maxRows != null && rows.length >= maxRows) return rows.slice(0, maxRows);

    const reportedSize = res.data.meta?.size;
    size = typeof reportedSize === "number" && reportedSize >= 0 ? reportedSize : Number.POSITIVE_INFINITY;
    if (chunk.length < pageLimit || chunk.length === 0) break;
    offset += chunk.length;
  }

  return rows;
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) break;
      results[index] = await mapper(items[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

async function syncStores(limit?: number | null): Promise<number> {
  const rows = await fetchPagedRows<StoreRow>(
    (offset, pageLimit) => `/entity/store?limit=${pageLimit}&offset=${offset}`,
    { maxRows: limit }
  );

  for (const row of rows) {
    const payload = {
      moyskladHref: row.meta?.href ?? null,
      name: row.name?.trim() || row.id,
      archived: Boolean(row.archived),
      raw: toJson(row),
      syncedAt: new Date(),
    };
    await withDbRetry(() =>
      prisma.localStore.upsert({
        where: { moyskladId: row.id },
        create: { moyskladId: row.id, ...payload },
        update: payload,
      })
    );
  }

  return rows.length;
}

async function syncProducts(entityType: "product" | "service", limit?: number | null): Promise<number> {
  const maxRows = limit != null && limit > 0 ? Math.floor(limit) : null;
  const pageLimit = entityType === "product" ? 100 : PAGE_LIMIT;
  const counterKey = entityType === "product" ? "productsSynced" : "servicesSynced";
  const label = entityType === "product" ? "товаров" : "услуг";
  let offset = 0;
  let size = Number.POSITIVE_INFINITY;
  let processed = 0;

  while (offset < size) {
    const remaining = maxRows == null ? pageLimit : Math.max(0, Math.min(pageLimit, maxRows - processed));
    if (remaining <= 0) break;
    const expand = entityType === "product" ? "&expand=attributes,uom,country,supplier" : "";
    const res = await moyskladFetchWithRetry<PageResponse<ProductRow>>(
      `/entity/${entityType}?limit=${remaining}&offset=${offset}${expand}`,
      { cache: "no-store" },
      MOYSKLAD_FETCH_ATTEMPTS
    );
    if (!res.ok) throw new Error(res.error);

    const chunk = res.data.rows ?? [];
    for (const row of chunk) {
      const salePrice = row.salePrices?.[0];
      const sae = attributeValueByName(row.attributes, ["SAE"]);
      const oem = attributeValueByName(row.attributes, ["OEM"]);
      const acea = attributeValueByName(row.attributes, ["ACEA"]);
      const apiSpec = attributeValueByName(row.attributes, ["API"]);
      const packageVolume = attributeValueByName(row.attributes, ["Объем"]);
      const brand = attributeValueByName(row.attributes, ["Brand"]);
      const atf = attributeValueByName(row.attributes, ["ATF"]);
      const ilsac = attributeValueByName(row.attributes, ["ILSAC"]);
      const aceaExtra = attributeValueByName(row.attributes, ["ACEA (!)"]);
      const oemAtf = attributeValueByName(row.attributes, ["OEM ATF"]);
      const mannName = attributeValueByName(row.attributes, ["Наиминование по Mann", "Наименование по Mann"]);
      const rosskoPartNumber = attributeValueByName(row.attributes, ["rossko_part_number"]);
      const rosskoBrand = attributeValueByName(row.attributes, ["rossko_brand"]);
      const rosskoMin = attributeValueByName(row.attributes, ["rossko_min"]);
      const supplierAttribute = attributeValueByName(row.attributes, ["Supplier"]);
      const oemParts = attributeValueByName(row.attributes, ["OEM PARTS"]);
      const cell = attributeValueByName(row.attributes, ["Ячейка"]);
      const mannCharacteristicName = attributeValueByName(row.attributes, ["Характеристика:Нименование по Mann", "Характеристика:Наименование по Mann"]);
      const searchText = buildCatalogSearchText({
        name: row.name,
        article: row.article,
        code: row.code,
        externalCode: row.externalCode,
        groupPath: row.pathName,
        uomName: row.uom?.name,
        barcodeEan13: barcodesByType(row, "ean13"),
        barcodeEan8: barcodesByType(row, "ean8"),
        barcodeCode128: barcodesByType(row, "code128"),
        description: row.description,
        supplierName: row.supplier?.name,
        tnvedCode: row.tnved,
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
        currencyName: salePrice?.currency?.name,
        attributes: row.attributes,
      });
      const payload = {
        moyskladHref: row.meta?.href ?? null,
        entityType,
        name: row.name?.trim() || row.id,
        article: row.article?.trim() || null,
        code: row.code?.trim() || null,
        externalCode: textOrUndefined(row.externalCode),
        groupPath: textOrUndefined(row.pathName),
        uomName: textOrUndefined(row.uom?.name),
        salePriceCents: Math.round(Number(salePrice?.value ?? 0)),
        buyPriceCents: row.buyPrice?.value != null ? Math.round(Number(row.buyPrice.value)) : null,
        currencyName: salePrice?.currency?.name ?? null,
        minimumBalance: decimalOrUndefined(row.minimumBalance),
        barcodeEan13: barcodesByType(row, "ean13") ?? undefined,
        barcodeEan8: barcodesByType(row, "ean8") ?? undefined,
        barcodeCode128: barcodesByType(row, "code128") ?? undefined,
        description: textOrUndefined(row.description),
        minPriceCents: centsOrUndefined(row.minPrice?.value),
        minPriceCurrencyName: textOrUndefined(row.minPrice?.currency?.name),
        countryName: textOrUndefined(row.country?.name),
        vatLabel: vatLabel(row),
        supplierName: textOrUndefined(row.supplier?.name),
        weight: decimalOrUndefined(row.weight),
        volume: decimalOrUndefined(row.volume),
        modificationCode: textOrUndefined(row.modificationCode),
        tnvedCode: textOrUndefined(row.tnved),
        sae: sae ?? undefined,
        oem: oem ?? undefined,
        acea: acea ?? undefined,
        apiSpec: apiSpec ?? undefined,
        packageVolume: packageVolume ?? undefined,
        avito: attributeBooleanByName(row.attributes, ["Авито"]),
        brand: brand ?? undefined,
        atf: atf ?? undefined,
        ilsac: ilsac ?? undefined,
        aceaExtra: aceaExtra ?? undefined,
        oemAtf: oemAtf ?? undefined,
        mannName: mannName ?? undefined,
        rosskoPartNumber: rosskoPartNumber ?? undefined,
        rosskoBrand: rosskoBrand ?? undefined,
        rosskoMin: rosskoMin ?? undefined,
        supplierAttribute: supplierAttribute ?? undefined,
        oemParts: oemParts ?? undefined,
        cell: cell ?? undefined,
        mannCharacteristicName: mannCharacteristicName ?? undefined,
        imageHref: getFirstImageHref(row),
        attributes: toJson(row.attributes ?? null),
        searchText,
        archived: Boolean(row.archived),
        raw: toJson(row),
        syncedAt: new Date(),
      };
      await withDbRetry(() =>
        prisma.localProduct.upsert({
          where: { moyskladId: row.id },
          create: { moyskladId: row.id, ...payload },
          update: payload,
        })
      );
    }

    processed += chunk.length;
    const reportedSize = res.data.meta?.size;
    size = typeof reportedSize === "number" && reportedSize >= 0 ? reportedSize : Number.POSITIVE_INFINITY;
    setStatus({
      [counterKey]: processed,
      message: Number.isFinite(size)
        ? `Импортируем ${label}: ${processed} из ${maxRows == null ? size : Math.min(size, maxRows)}`
        : `Импортируем ${label}: ${processed}`,
    });

    if (chunk.length < remaining || chunk.length === 0) break;
    offset += chunk.length;
  }

  return processed;
}

async function syncCounterparties(limit?: number | null): Promise<number> {
  const rows = await fetchPagedRows<CounterpartyRow>(
    (offset, pageLimit) => `/entity/counterparty?limit=${pageLimit}&offset=${offset}`,
    { maxRows: limit }
  );

  for (const row of rows) {
    const rawPhones = listRawPhonesFromCounterparty(row);
    const normalizedPhone = pickNormalizedPhoneFromCounterparty(row) ?? normalizePhoneKey(row.phone);
    const account = row.accounts?.rows?.[0];
    const legalAddressParts = [
      row.legalAddressFull?.postalCode,
      row.legalAddressFull?.region,
      row.legalAddressFull?.city,
      row.legalAddressFull?.street,
    ]
      .map(textOrNull)
      .filter(Boolean)
      .join(", ");
    const legalAddress = (
      textOrNull(row.legalAddress) ??
      textOrNull(row.legalAddressFull?.addInfo) ??
      legalAddressParts
    ) || undefined;
    const bik = accountText(account, ["bik", "bic"]);
    const bankName = accountText(account, ["bankName", "bank"]);
    const bankLocation = accountText(account, ["bankLocation", "bankAddress", "address"]);
    const correspondentAccount = accountText(account, ["correspondentAccount", "correspondentAccountNumber", "ks"]);
    const checkingAccount = accountText(account, ["accountNumber", "checkingAccount", "rs"]);
    const searchText = normalizeForSearch(
      [
        row.name,
        row.phone,
        row.email,
        row.legalTitle,
        row.legalLastName,
        row.legalFirstName,
        row.legalMiddleName,
        legalAddress,
        row.inn,
        row.kpp,
        row.okpo,
        row.fax,
        bik,
        bankName,
        bankLocation,
        correspondentAccount,
        checkingAccount,
        row.ogrn,
        row.ogrnip,
        row.companyType,
        rawPhones.join(" "),
      ].join(" ")
    );
    const payload = {
      moyskladHref: row.meta?.href ?? null,
      name: row.name?.trim() || row.id,
      phone: row.phone?.trim() || rawPhones[0] || null,
      email: row.email?.trim() || null,
      normalizedPhone,
      phonesRaw: toJson(rawPhones.length > 0 ? rawPhones : null),
      companyType: row.companyType ?? null,
      counterpartyTypeName: textOrUndefined(row.companyType),
      legalTitle: row.legalTitle?.trim() || null,
      legalLastName: textOrUndefined(row.legalLastName),
      legalFirstName: textOrUndefined(row.legalFirstName),
      legalMiddleName: textOrUndefined(row.legalMiddleName),
      legalAddress,
      inn: textOrUndefined(row.inn),
      kpp: textOrUndefined(row.kpp),
      okpo: textOrUndefined(row.okpo),
      fax: textOrUndefined(row.fax),
      bik,
      bankName,
      bankLocation,
      correspondentAccount,
      checkingAccount,
      ogrn: textOrUndefined(row.ogrn),
      ogrnip: textOrUndefined(row.ogrnip),
      searchText,
      archived: Boolean(row.archived),
      raw: toJson(row),
      syncedAt: new Date(),
    };
    await withDbRetry(() =>
      prisma.localCounterparty.upsert({
        where: { moyskladId: row.id },
        create: { moyskladId: row.id, ...payload },
        update: payload,
      })
    );
  }

  return rows.length;
}

async function syncStockBalances(): Promise<number> {
  const rows = await fetchPagedRows<StockByStoreRow>(
    (offset, pageLimit) => `/report/stock/bystore?limit=${pageLimit}&offset=${offset}`
  );
  const [products, stores] = await withDbRetry(() =>
    Promise.all([
      prisma.localProduct.findMany({ select: { id: true, moyskladId: true } }),
      prisma.localStore.findMany({ select: { id: true, name: true } }),
    ])
  );
  const productByMoyskladId = new Map(products.map((product) => [product.moyskladId, product.id]));
  const storeByName = new Map(stores.map((store) => [store.name.trim().toLowerCase(), store.id]));
  const balances = new Map<
    string,
    { productId: string; storeId: string; quantity: number; reserve: number; available: number; syncedAt: Date }
  >();

  for (const row of rows) {
    const productMoyskladId = getEntityIdFromMeta(row.assortment?.meta ?? row.meta);
    const productId = productMoyskladId ? productByMoyskladId.get(productMoyskladId) : undefined;
    if (!productId) continue;

    for (const stock of row.stockByStore ?? []) {
      const storeName = stock.name?.trim();
      if (!storeName) continue;
      const storeId = storeByName.get(storeName.toLowerCase());
      if (!storeId) continue;
      const quantity = Number(stock.stock ?? 0);
      const reserve = Number(stock.reserve ?? 0);
      const key = `${productId}:${storeId}`;
      balances.set(key, {
        productId,
        storeId,
        quantity,
        reserve,
        available: Math.max(0, quantity - reserve),
        syncedAt: new Date(),
      });
    }
  }

  await withDbRetry(() => prisma.localStockBalance.deleteMany({}));
  const data = Array.from(balances.values());
  if (data.length > 0) {
    await withDbRetry(() => prisma.localStockBalance.createMany({ data }));
  }
  return data.length;
}

async function fetchDemandPositions(demandId: string): Promise<DemandPositionRow[]> {
  return fetchPagedRows<DemandPositionRow>(
    (offset, pageLimit) =>
      `/entity/demand/${demandId}/positions?limit=${pageLimit}&offset=${offset}&expand=assortment,slot`,
    { pageLimit: DEMAND_POSITIONS_PAGE_LIMIT }
  );
}

async function buildDemandLookupCache(): Promise<DemandLookupCache> {
  const [counterparties, products, stores] = await withDbRetry(() =>
    Promise.all([
      prisma.localCounterparty.findMany({ select: { id: true, moyskladId: true } }),
      prisma.localProduct.findMany({ select: { id: true, moyskladId: true } }),
      prisma.localStore.findMany({ select: { id: true, moyskladId: true } }),
    ])
  );

  return {
    counterpartyByMoyskladId: buildIdMap(counterparties),
    productByMoyskladId: buildIdMap(products),
    storeByMoyskladId: buildIdMap(stores),
  };
}

async function upsertDemand(row: DemandListRow, cache?: DemandLookupCache): Promise<void> {
  const positions = await fetchDemandPositions(row.id);
  const { documentDate, momentAt } = asDateFromMoySkladMoment(row.moment);
  const agentMoyskladId = getEntityIdFromMeta(row.agent?.meta);
  const storeMoyskladId = getEntityIdFromMeta(row.store?.meta);
  const counterpartyId = agentMoyskladId ? (cache?.counterpartyByMoyskladId.get(agentMoyskladId) ?? null) : null;
  const storeId = storeMoyskladId ? (cache?.storeByMoyskladId.get(storeMoyskladId) ?? null) : null;
  const needsLookup = !cache && (agentMoyskladId || storeMoyskladId);
  const [counterparty, store] = needsLookup
    ? await withDbRetry(() =>
        Promise.all([
          agentMoyskladId
            ? prisma.localCounterparty.findUnique({ where: { moyskladId: agentMoyskladId }, select: { id: true } })
            : Promise.resolve(null),
          storeMoyskladId
            ? prisma.localStore.findUnique({ where: { moyskladId: storeMoyskladId }, select: { id: true } })
            : Promise.resolve(null),
        ])
      )
    : [null, null];

  const payload = {
    moyskladHref: row.meta?.href ?? null,
    name: row.name?.trim() || row.id,
    momentAt,
    documentDate,
    applicable: Boolean(row.applicable),
    sumCents: Math.round(Number(row.sum ?? 0)),
    description: row.description?.trim() || null,
    counterpartyId: counterpartyId ?? counterparty?.id ?? null,
    agentMoyskladId,
    agentNameSnapshot: row.agent?.name?.trim() || null,
    storeId: storeId ?? store?.id ?? null,
    storeMoyskladId,
    storeNameSnapshot: row.store?.name?.trim() || null,
    organizationName: row.organization?.name?.trim() || null,
    attributes: toJson(row.attributes ?? null),
    raw: toJson(row),
    syncedAt: new Date(),
  };

  const demand = await withDbRetry(() =>
    prisma.localDemand.upsert({
      where: { moyskladId: row.id },
      create: { moyskladId: row.id, ...payload },
      update: payload,
      select: { id: true },
    })
  );

  const productByMoyskladId =
    cache?.productByMoyskladId ??
    new Map(
      (
        await (async () => {
          const productIds = positions
            .map((position) => getEntityIdFromMeta(position.assortment?.meta))
            .filter((id): id is string => Boolean(id));
          return productIds.length
            ? withDbRetry(() =>
                prisma.localProduct.findMany({
                  where: { moyskladId: { in: [...new Set(productIds)] } },
                  select: { id: true, moyskladId: true },
                })
              )
            : [];
        })()
      ).map((product) => [product.moyskladId, product.id])
    );

  await withDbRetry(() =>
    prisma.$transaction([
      prisma.localDemandPosition.deleteMany({ where: { demandId: demand.id } }),
      ...(positions.length > 0
        ? [
            prisma.localDemandPosition.createMany({
              data: positions.map((position) => {
                const assortmentMoyskladId = getEntityIdFromMeta(position.assortment?.meta);
                const productId = assortmentMoyskladId ? productByMoyskladId.get(assortmentMoyskladId) ?? null : null;
                const buyPrice =
                  position.assortment?.buyPrice?.value != null
                    ? Math.round(Number(position.assortment.buyPrice.value))
                    : position.cost != null
                      ? Math.round(Number(position.cost))
                      : null;
                return {
                  demandId: demand.id,
                  moyskladPositionId: position.id,
                  productId,
                  assortmentMoyskladId,
                  assortmentType: position.assortment?.meta?.type ?? "",
                  name: position.assortment?.name?.trim() || "Позиция",
                  quantity: new Prisma.Decimal(Number(position.quantity ?? 0)),
                  priceCentsPerUnit: Math.round(Number(position.price ?? 0)),
                  discount: new Prisma.Decimal(Number(position.discount ?? 0)),
                  buyPriceCentsPerUnit: buyPrice,
                  slotName: position.slot?.name?.trim() || null,
                  raw: toJson(position),
                };
              }),
            }),
          ]
        : []),
    ])
  );
}

async function syncDemands(options: { limit?: number | null; full?: boolean }): Promise<number> {
  const maxRows = options.full ? null : options.limit ?? 200;
  const lookupCache = await buildDemandLookupCache();
  let processed = 0;
  let offset = 0;
  let size = Number.POSITIVE_INFINITY;

  while (offset < size) {
    const remaining = maxRows == null ? DEMAND_PAGE_LIMIT : Math.max(0, Math.min(DEMAND_PAGE_LIMIT, maxRows - processed));
    if (remaining <= 0) break;

    const params = new URLSearchParams({
      limit: String(remaining),
      offset: String(offset),
      order: "moment,desc",
      expand: "agent,organization,store",
    });
    const res = await moyskladFetchWithRetry<PageResponse<DemandListRow>>(
      `/entity/demand?${params.toString()}`,
      { cache: "no-store" },
      MOYSKLAD_FETCH_ATTEMPTS
    );
    if (!res.ok) throw new Error(res.error);

    const chunk = res.data.rows ?? [];
    const reportedSize = res.data.meta?.size;
    size = typeof reportedSize === "number" && reportedSize >= 0 ? reportedSize : Number.POSITIVE_INFINITY;
    const total = maxRows == null ? size : Math.min(size, maxRows);

    await mapWithConcurrency(chunk, POSITION_CONCURRENCY, async (row) => {
      await upsertDemand(row, lookupCache);
      processed += 1;
      setStatus({
        demandsSynced: processed,
        message: Number.isFinite(total) ? `Импорт отгрузок: ${processed} из ${total}` : `Импорт отгрузок: ${processed}`,
      });
    });
    await persistStatus();

    if (chunk.length < remaining || chunk.length === 0) break;
    offset += chunk.length;
  }

  return processed;
}

export async function getLocalInventorySyncStatus(): Promise<LocalInventorySyncStatus> {
  if (activeSyncPromise) return { ...runtimeStatus };
  const row = await prisma.localInventorySyncState.findUnique({ where: { id: SYNC_STATE_ID } });
  return mapStateRowToStatus(row);
}

export async function startLocalInventorySync(
  options: LocalInventorySyncOptions = {}
): Promise<{ started: boolean; status: LocalInventorySyncStatus }> {
  if (activeSyncPromise) {
    return { started: false, status: { ...runtimeStatus } };
  }

  activeSyncPromise = runLocalInventorySync(options).finally(() => {
    activeSyncPromise = null;
  });

  return { started: true, status: { ...runtimeStatus } };
}

export async function waitForLocalInventorySync(): Promise<LocalInventorySyncStatus> {
  return activeSyncPromise ? activeSyncPromise : getLocalInventorySyncStatus();
}

async function runLocalInventorySync(options: LocalInventorySyncOptions): Promise<LocalInventorySyncStatus> {
  if (!isMoySkladSyncEnabled()) {
    const error = moyskladDisabledMessage("sync");
    setStatus({ ...createDefaultStatus(), phase: "error", error, message: error });
    await persistStatus({ lastError: error });
    return { ...runtimeStatus };
  }

  if (!getMoySkladHeaders()) {
    const error = "МойСклад не настроен: нужны MOYSKLAD_TOKEN или MOYSKLAD_LOGIN/MOYSKLAD_PASSWORD";
    setStatus({ ...createDefaultStatus(), phase: "error", error, message: error });
    await persistStatus({ lastError: error });
    return { ...runtimeStatus };
  }

  const startedAt = new Date();
  const fullDemands = Boolean(options.fullDemands);
  runtimeStatus = {
    ...createDefaultStatus(),
    isRunning: true,
    mode: fullDemands ? "full" : "snapshot",
    phase: "stores",
    startedAt: startedAt.toISOString(),
    message: "Начинаем импорт локального складского зеркала",
  };
  await persistStatus({ lastError: null });

  try {
    if (options.includeStores !== false) {
      setStatus({ phase: "stores", message: "Импортируем склады" });
      await persistStatus();
      const count = await syncStores();
      setStatus({ storesSynced: count });
    }

    if (options.includeProducts !== false) {
      setStatus({ phase: "products", message: "Импортируем товары" });
      await persistStatus();
      const productCount = await syncProducts("product", options.productLimit);
      setStatus({ productsSynced: productCount, message: "Импортируем услуги" });
      const serviceCount = await syncProducts("service", null);
      setStatus({ servicesSynced: serviceCount });
    }

    if (options.includeCounterparties !== false) {
      setStatus({ phase: "counterparties", message: "Импортируем контрагентов" });
      await persistStatus();
      const count = await syncCounterparties(options.counterpartyLimit);
      setStatus({ counterpartiesSynced: count });
    }

    if (options.includeStock !== false) {
      setStatus({ phase: "stock", message: "Импортируем остатки по складам" });
      await persistStatus();
      const count = await syncStockBalances();
      setStatus({ stockRowsSynced: count });
    }

    if (options.includeDemands !== false) {
      setStatus({
        phase: "demands",
        message: fullDemands ? "Импортируем все отгрузки" : "Импортируем последние отгрузки",
      });
      await persistStatus();
      const count = await syncDemands({ limit: options.demandLimit, full: fullDemands });
      setStatus({ demandsSynced: count });
    }

    setStatus({
      isRunning: false,
      phase: "done",
      finishedAt: new Date().toISOString(),
      message: "Локальное складское зеркало обновлено",
      error: null,
    });
    await persistStatus({ lastSyncedAt: new Date(), lastError: null });
    return { ...runtimeStatus };
  } catch (e) {
    const error = e instanceof Error ? e.message : "Ошибка импорта локального складского зеркала";
    setStatus({
      isRunning: false,
      phase: "error",
      finishedAt: new Date().toISOString(),
      message: "Импорт остановлен с ошибкой",
      error,
    });
    await persistStatus({ lastError: error });
    return { ...runtimeStatus };
  }
}
