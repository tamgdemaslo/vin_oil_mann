import { prisma } from "@/lib/db";

type MoySkladMeta = {
  href: string;
  type: string;
  mediaType: string;
};

const OEM_ATTR_ID = "d1aad1ea-14e1-11f1-0a80-0eb200223523";
const MANN_ATTR_ID = "ca6f792f-4451-11ee-0a80-0dba0047437a";
const PARAMS_ATTR_ID = "7944ef04-f831-11e5-7a69-971500188b19";
const CELL_ATTR_ID = "7ad15eda-204c-11f1-0a80-19f100217481";

type LocalProductSearchParams = {
  search?: string;
  oem?: string;
  mannName?: string;
  params?: string;
  storeName?: string;
  storeId?: string;
  limit?: number;
};

type ProductAttribute = { id?: string; name?: string; value?: unknown; meta?: { href?: string } };
type LocalDemandListParams = {
  search?: string;
  counterparty?: string;
  plate?: string;
  phone?: string;
  offset?: number;
  limit?: number;
};

export function isLocalInventoryReadsEnabled(): boolean {
  return true;
}

function normalizeTermKey(s: string): string {
  return s.replace(/\s/g, "").toLowerCase();
}

function buildTerms(params: Pick<LocalProductSearchParams, "search" | "oem" | "mannName" | "params">): string[] {
  const rawTerms = [params.search, params.oem, params.mannName, params.params]
    .map((value) => value?.trim() ?? "")
    .filter(Boolean);
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const term of rawTerms) {
    const key = normalizeTermKey(term);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
  }
  return terms;
}

function compactSearchText(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s/g, "");
}

function textIncludesTerm(text: string, term?: string): boolean {
  const needle = compactSearchText(term);
  return needle.length >= 2 && compactSearchText(text).includes(needle);
}

function attributeValueText(value: unknown): string {
  if (Array.isArray(value)) return value.map(attributeValueText).join(" ");
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return String(record.name ?? record.value ?? "").trim();
  }
  return String(value ?? "").trim();
}

function attributeText(input: unknown, attrId: string, names: string[]): string {
  if (!Array.isArray(input)) return "";
  const normalizedNames = names.map((name) => name.toLowerCase());
  const chunks: string[] = [];
  for (const attr of input as ProductAttribute[]) {
    const id = String(attr.id ?? "");
    const href = String(attr.meta?.href ?? "");
    const name = String(attr.name ?? "").trim().toLowerCase();
    if (id !== attrId && !href.endsWith(`/${attrId}`) && !normalizedNames.some((item) => name === item || name.includes(item))) {
      continue;
    }
    chunks.push(attributeValueText(attr.value));
  }
  return chunks.join(" ");
}

function productIdentityText(product: { name?: string | null; article?: string | null; code?: string | null }): string {
  return [product.name, product.article, product.code].join(" ");
}

function productMatchesSearchFields(
  product: {
    name?: string | null;
    article?: string | null;
    code?: string | null;
    searchText?: string | null;
    attributes?: unknown;
    oem?: string | null;
    oemParts?: string | null;
    mannName?: string | null;
    params?: string | null;
  },
  params: Pick<LocalProductSearchParams, "search" | "oem" | "mannName" | "params">
): boolean {
  const search = params.search?.trim();
  const oem = params.oem?.trim();
  const mannName = params.mannName?.trim();
  const paramsValue = params.params?.trim();

  if (search && !textIncludesTerm([productIdentityText(product), product.searchText].join(" "), search)) return false;
  if (
    oem &&
    !textIncludesTerm([product.oem, product.oemParts, attributeText(product.attributes, OEM_ATTR_ID, ["oem parts", "oem"])].join(" "), oem)
  ) return false;
  if (
    mannName &&
    !textIncludesTerm([product.mannName, attributeText(product.attributes, MANN_ATTR_ID, ["наименование по mann", "mann"])].join(" "), mannName)
  ) {
    return false;
  }
  if (paramsValue && !textIncludesTerm([product.params, attributeText(product.attributes, PARAMS_ATTR_ID, ["параметры"])].join(" "), paramsValue)) {
    return false;
  }
  return true;
}

function entityMeta(entityType: string, moyskladId: string | null, href: string | null, localId: string): MoySkladMeta {
  const safeType = entityType || "product";
  return {
    href: href || `local://${safeType}/${localId || moyskladId || ""}`,
    type: safeType,
    mediaType: "application/json",
  };
}

function getCellFromAttributes(input: unknown): string | undefined {
  if (!Array.isArray(input)) return undefined;
  const attrs = input as ProductAttribute[];
  const found = attrs.find((attr) => {
    const name = String(attr.name ?? "").trim().toLowerCase();
    return attr.id === CELL_ATTR_ID || name === "ячейка" || name.includes("ячейка");
  });
  if (found?.value == null) return undefined;
  if (typeof found.value === "object") {
    const record = found.value as Record<string, unknown>;
    return String(record.name ?? record.value ?? "").trim() || undefined;
  }
  return String(found.value).trim() || undefined;
}

function decimalToNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (value && typeof value === "object" && "toNumber" in value && typeof value.toNumber === "function") {
    return value.toNumber();
  }
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function hasLocalInventoryProducts(): Promise<boolean> {
  const count = await prisma.localProduct.count();
  return count > 0;
}

export async function searchLocalProducts(params: LocalProductSearchParams) {
  const limit = Math.min(100, Math.max(1, params.limit ?? 30));
  const terms = buildTerms(params).slice(0, 5);
  const search = params.search?.trim() ?? "";
  const oem = params.oem?.trim() ?? "";
  const mannName = params.mannName?.trim() ?? "";
  const paramsValue = params.params?.trim() ?? "";
  const storeName = params.storeName?.trim() ?? "";
  const storeMoyskladId = params.storeId?.trim() ?? "";
  const andFilters = [];
  if (search) {
    andFilters.push({
      OR: [
        { name: { contains: search, mode: "insensitive" as const } },
        { article: { contains: search, mode: "insensitive" as const } },
        { code: { contains: search, mode: "insensitive" as const } },
        { externalCode: { contains: search, mode: "insensitive" as const } },
        { brand: { contains: search, mode: "insensitive" as const } },
        { searchText: { contains: search.toLowerCase(), mode: "insensitive" as const } },
      ],
    });
  }
  for (const term of [oem, mannName, paramsValue].filter(Boolean)) {
    andFilters.push({ searchText: { contains: term.toLowerCase(), mode: "insensitive" as const } });
  }

  const store = storeMoyskladId
    ? await prisma.localStore.findFirst({
        where: { OR: [{ id: storeMoyskladId }, { moyskladId: storeMoyskladId }] },
        select: { id: true },
      })
    : storeName
      ? await prisma.localStore.findFirst({
          where: { name: { equals: storeName, mode: "insensitive" } },
          select: { id: true },
        })
      : null;

  const products = await prisma.localProduct.findMany({
    where: {
      archived: false,
      ...(andFilters.length > 0 ? { AND: andFilters } : {}),
    },
    include: {
      stockBalances: {
        where: store?.id ? { storeId: store.id } : undefined,
        take: store?.id ? 1 : 20,
      },
    },
    orderBy: [{ name: "asc" }],
    take: terms.length > 0 ? Math.min(1000, Math.max(limit * 20, 200)) : limit,
  });

  return {
    products: products
      .filter((product) => productMatchesSearchFields(product, params))
      .map((product) => {
        const stock = product.stockBalances[0];
        const quantity = decimalToNumber(stock?.quantity);
        const reserve = decimalToNumber(stock?.reserve);
        const available = decimalToNumber(stock?.available);
        const meta = entityMeta(product.entityType, product.moyskladId, product.moyskladHref, product.id);
        return {
          id: product.moyskladId ?? product.id,
          name: product.name,
          article: product.article ?? undefined,
          code: product.code ?? undefined,
          externalCode: product.externalCode ?? undefined,
          brand: product.brand ?? undefined,
          oem: product.oem ?? undefined,
          sae: product.sae ?? undefined,
          acea: product.acea ?? undefined,
          apiSpec: product.apiSpec ?? undefined,
          mannName: product.mannName ?? undefined,
          params: product.params ?? undefined,
          price: product.salePriceCents / 100,
          currency: product.currencyName ?? "руб.",
          meta,
          cell: stock?.slotName ?? product.cell ?? getCellFromAttributes(product.attributes),
          imageHref: product.imageHref ?? undefined,
          buyPriceCents: stock?.buyPriceCents ?? product.buyPriceCents ?? undefined,
          cost: (stock?.buyPriceCents ?? product.buyPriceCents) != null ? (stock?.buyPriceCents ?? product.buyPriceCents ?? 0) / 100 : undefined,
          stockQuantity: quantity,
          reserveQuantity: reserve,
          availableQuantity: available,
          slotName: stock?.slotName ?? undefined,
        };
      })
      .sort((a, b) => {
        const aAvailable = a.availableQuantity ?? a.stockQuantity ?? 0;
        const bAvailable = b.availableQuantity ?? b.stockQuantity ?? 0;
        const aInStock = aAvailable > 0 ? 1 : 0;
        const bInStock = bAvailable > 0 ? 1 : 0;
        if (bInStock !== aInStock) return bInStock - aInStock;
        if (bAvailable !== aAvailable) return bAvailable - aAvailable;
        if (a.price !== b.price) return a.price - b.price;
        return a.name.localeCompare(b.name, "ru");
      })
      .slice(0, limit),
  };
}

export async function hasLocalInventoryCounterparties(): Promise<boolean> {
  const count = await prisma.localCounterparty.count();
  return count > 0;
}

export async function searchLocalCounterparties(params: { search?: string; limit?: number }) {
  const search = params.search?.trim() ?? "";
  const limit = Math.min(100, Math.max(1, params.limit ?? 50));
  const counterparties = await prisma.localCounterparty.findMany({
    where: {
      archived: false,
      ...(search
        ? {
            searchText: {
              contains: search.toLowerCase(),
              mode: "insensitive" as const,
            },
          }
        : {}),
    },
    orderBy: [{ name: "asc" }],
    take: limit,
  });

  return {
    counterparties: counterparties.map((counterparty) => ({
      id: counterparty.moyskladId ?? counterparty.id,
      name: counterparty.name,
      meta: entityMeta("counterparty", counterparty.moyskladId, counterparty.moyskladHref, counterparty.id),
    })),
  };
}

export async function listLocalStores() {
  const stores = await prisma.localStore.findMany({
    where: { archived: false },
    orderBy: [{ name: "asc" }],
  });
  return {
    stores: stores.map((store) => ({
      id: store.moyskladId ?? store.id,
      name: store.name,
      isMain: store.isMain,
      meta: entityMeta("store", store.moyskladId, store.moyskladHref, store.id),
    })),
  };
}

export async function hasLocalInventoryStores(): Promise<boolean> {
  const count = await prisma.localStore.count();
  return count > 0;
}

function extractEntityId(href: string): string | null {
  const parts = href.split("/").filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : null;
}

export async function loadLocalStockByAssortment(params: {
  storeName?: string;
  storeId?: string;
  assortmentHrefs: string[];
}) {
  const storeLookup = params.storeId?.trim() ?? "";
  const storeName = params.storeName?.trim() ?? "";
  const store = storeLookup
    ? await prisma.localStore.findFirst({
        where: { OR: [{ id: storeLookup }, { moyskladId: storeLookup }] },
      })
    : storeName
      ? await prisma.localStore.findFirst({ where: { name: { equals: storeName, mode: "insensitive" } } })
      : null;
  if (!store) return { stockByAssortment: {} };

  const ids = params.assortmentHrefs.map(extractEntityId).filter((id): id is string => Boolean(id));
  const products = ids.length
    ? await prisma.localProduct.findMany({
        where: { OR: [{ id: { in: ids } }, { moyskladId: { in: ids } }] },
        include: { stockBalances: { where: { storeId: store.id }, take: 1 } },
      })
    : [];
  const byId = new Map<string, (typeof products)[number]>();
  for (const product of products) {
    byId.set(product.id, product);
    if (product.moyskladId) byId.set(product.moyskladId, product);
  }

  const stockByAssortment: Record<
    string,
    { quantity: number; reserve: number; available: number; cost?: number; buyPriceCents?: number; slotName?: string }
  > = {};
  for (const href of params.assortmentHrefs) {
    const id = extractEntityId(href);
    const product = id ? byId.get(id) : undefined;
    const balance = product?.stockBalances[0];
    stockByAssortment[href] = {
      quantity: decimalToNumber(balance?.quantity),
      reserve: decimalToNumber(balance?.reserve),
      available: decimalToNumber(balance?.available),
      cost: balance?.buyPriceCents != null ? balance.buyPriceCents / 100 : product?.buyPriceCents != null ? product.buyPriceCents / 100 : undefined,
      buyPriceCents: balance?.buyPriceCents ?? product?.buyPriceCents ?? undefined,
      slotName: balance?.slotName ?? undefined,
    };
  }

  return { stockByAssortment };
}

export async function loadLocalProductCells(hrefs: string[]) {
  const ids = hrefs.map(extractEntityId).filter((id): id is string => Boolean(id));
  const products = ids.length
    ? await prisma.localProduct.findMany({ where: { OR: [{ id: { in: ids } }, { moyskladId: { in: ids } }] } })
    : [];
  const byId = new Map<string, (typeof products)[number]>();
  for (const product of products) {
    byId.set(product.id, product);
    if (product.moyskladId) byId.set(product.moyskladId, product);
  }
  const cells: Record<string, number | string> = {};
  for (const href of hrefs) {
    const id = extractEntityId(href);
    const product = id ? byId.get(id) : undefined;
    cells[href] = product?.cell ?? getCellFromAttributes(product?.attributes) ?? "";
  }
  return cells;
}

function normalizePlate(s: string): string {
  const lookalikes: Record<string, string> = {
    А: "A",
    В: "B",
    Е: "E",
    К: "K",
    М: "M",
    Н: "H",
    О: "O",
    Р: "P",
    С: "C",
    Т: "T",
    У: "Y",
    Х: "X",
  };
  return s
    .toUpperCase()
    .replace(/[АВЕКМНОРСТУХ]/g, (ch) => lookalikes[ch] ?? ch)
    .replace(/[^A-ZА-ЯЁ0-9]/g, "");
}

function jsonArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
}

function isPlateAttributeName(name: string | undefined): boolean {
  const n = (name ?? "").toLowerCase();
  return /гос|г\/н|госномер|г\.\s*н|номер\s*(тс|а\/м|авто)|state\s*reg|plate/i.test(n);
}

function demandPlateText(attributes: unknown): string {
  const attrId = process.env.MOYSKLAD_DEMAND_PLATE_ATTRIBUTE_ID?.trim();
  const parts: string[] = [];
  for (const attr of jsonArray(attributes)) {
    const id = typeof attr.id === "string" ? attr.id : "";
    const name = typeof attr.name === "string" ? attr.name : "";
    if ((attrId && id === attrId) || isPlateAttributeName(name)) {
      parts.push(String(attr.value ?? ""));
    }
  }
  return normalizePlate(parts.join(" "));
}

function demandDocText(row: { name: string; description: string | null }): string {
  return [row.name, row.description ?? ""].join(" ").toLowerCase();
}

function phoneKeyVariants(phone: string): string[] {
  const digits = phone.replace(/\D/g, "");
  const variants = new Set<string>();
  if (digits) variants.add(digits);
  if (/^7\d{10}$/.test(digits)) variants.add(`8${digits.slice(1)}`);
  if (/^8\d{10}$/.test(digits)) variants.add(`7${digits.slice(1)}`);
  if (digits.length >= 10) variants.add(digits.slice(-10));
  return [...variants];
}

function rawTextMatchesPhone(value: unknown, phone: string): boolean {
  const rawDigits = String(value ?? "").replace(/\D/g, "");
  if (!rawDigits) return false;
  return phoneKeyVariants(phone).some((variant) => rawDigits.includes(variant));
}

function phonesRawArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item ?? "")).filter(Boolean) : [];
}

export async function hasLocalInventoryDemands(): Promise<boolean> {
  const count = await prisma.localDemand.count();
  return count > 0;
}

export async function loadLocalDemandList(params: LocalDemandListParams) {
  const search = params.search?.trim() ?? "";
  const counterparty = params.counterparty?.trim() ?? "";
  const plate = params.plate?.trim() ?? "";
  const phone = params.phone?.trim() ?? "";
  const offset = Math.max(0, params.offset ?? 0);
  const limit = Math.min(100, Math.max(1, params.limit ?? 50));
  const needsClientFilter = Boolean(plate || phone);

  const and = [];
  if (search) {
    and.push({
      OR: [
        { name: { contains: search, mode: "insensitive" as const } },
        { description: { contains: search, mode: "insensitive" as const } },
      ],
    });
  }
  if (counterparty) {
    and.push({
      counterparty: {
        searchText: { contains: counterparty.toLowerCase(), mode: "insensitive" as const },
      },
    });
  }
  if (phone) {
    and.push({
      counterparty: {
        searchText: { contains: phone.replace(/\D/g, "").slice(-10) || phone, mode: "insensitive" as const },
      },
    });
  }
  const where = and.length > 0 ? { AND: and } : {};

  if (!needsClientFilter) {
    const [total, rows] = await Promise.all([
      prisma.localDemand.count({ where }),
      prisma.localDemand.findMany({
        where,
        include: { counterparty: true, store: true },
        orderBy: [{ momentAt: "desc" }],
        skip: offset,
        take: limit,
      }),
    ]);
    return {
      meta: { size: total, limit, offset },
      rows: rows.map((row) => localDemandToMoySkladShape(row)),
    };
  }

  const scanLimit = Math.max(200, parseInt(process.env.LOCAL_INVENTORY_DEMAND_SEARCH_SCAN_LIMIT ?? "2000", 10) || 2000);
  const rows = await prisma.localDemand.findMany({
    where,
    include: { counterparty: true, store: true },
    orderBy: [{ momentAt: "desc" }],
    take: scanLimit,
  });

  const plateNorm = normalizePlate(plate);
  const filtered = rows.filter((row) => {
    if (search && !demandDocText(row).includes(search.toLowerCase())) return false;
    if (plateNorm && !demandPlateText(row.attributes).includes(plateNorm)) return false;
    if (phone) {
      const phoneValues = [row.counterparty?.phone, row.counterparty?.normalizedPhone, ...phonesRawArray(row.counterparty?.phonesRaw)];
      if (!phoneValues.some((value) => rawTextMatchesPhone(value, phone))) return false;
    }
    return true;
  });

  return {
    meta: { size: filtered.length, limit, offset },
    rows: filtered.slice(offset, offset + limit).map((row) => localDemandToMoySkladShape(row)),
  };
}

type LocalDemandWithRelations = Awaited<ReturnType<typeof prisma.localDemand.findMany>>[number] & {
  counterparty?: {
    id: string;
    moyskladId: string | null;
    moyskladHref: string | null;
    name: string;
    phone: string | null;
    phonesRaw: unknown;
  } | null;
  store?: {
    moyskladId: string | null;
    moyskladHref: string | null;
    name: string;
  } | null;
};

function localDemandToMoySkladShape(row: LocalDemandWithRelations) {
  const counterpartyMeta = row.counterparty
    ? entityMeta("counterparty", row.counterparty.moyskladId, row.counterparty.moyskladHref, row.counterparty.id)
    : undefined;
  return {
    id: row.moyskladId ?? row.id,
    name: row.name,
    moment: row.momentAt.toISOString(),
    applicable: row.applicable,
    sum: row.sumCents,
    description: row.description ?? "",
    agent: row.counterparty
      ? {
          name: row.counterparty.name,
          phone: row.counterparty.phone ?? undefined,
          phones: phonesRawArray(row.counterparty.phonesRaw).map((phone) => ({ phone })),
          meta: counterpartyMeta,
        }
      : row.agentNameSnapshot
        ? {
            name: row.agentNameSnapshot,
            meta: row.agentMoyskladId
              ? entityMeta("counterparty", row.agentMoyskladId, null, row.agentMoyskladId)
              : undefined,
          }
        : undefined,
    organization: row.organizationName ? { name: row.organizationName } : undefined,
    store: row.store?.name ? { name: row.store.name } : row.storeNameSnapshot ? { name: row.storeNameSnapshot } : undefined,
    meta: { href: `local://demand/${row.id}` },
    attributes: jsonArray(row.attributes).map((attr) => ({
      id: typeof attr.id === "string" ? attr.id : undefined,
      name: typeof attr.name === "string" ? attr.name : undefined,
      value: attr.value,
    })),
  };
}
