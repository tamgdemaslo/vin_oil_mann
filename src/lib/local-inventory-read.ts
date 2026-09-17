import { Prisma } from "@prisma/client";
import { anonymousRetailCounterpartyExclusion } from "@/lib/anonymous-retail-counterparty";
import { prisma } from "@/lib/db";
import { demandPaymentStatusFromRaw } from "@/lib/demand-payment";
import { getScopedBranchId } from "@/lib/request-tenant-store";

type LocalEntityMeta = {
  href: string;
  type: string;
  mediaType: string;
};

const OEM_ATTR_ID = "d1aad1ea-14e1-11f1-0a80-0eb200223523";
const PARAMS_ATTR_ID = "7944ef04-f831-11e5-7a69-971500188b19";
const CELL_ATTR_ID = "7ad15eda-204c-11f1-0a80-19f100217481";

type LocalProductSearchParams = {
  search?: string;
  oem?: string;
  mannName?: string;
  params?: string;
  entityType?: string;
  storeName?: string;
  storeId?: string;
  limit?: number;
};

type ProductAttribute = { id?: string; name?: string; value?: unknown; meta?: { href?: string } };
type LocalDemandListParams = {
  branchId: string;
  search?: string;
  counterparty?: string;
  plate?: string;
  phone?: string;
  vin?: string;
  store?: string;
  createdBy?: string;
  status?: "draft" | "posted";
  payment?: "paid" | "unpaid";
  minSumCents?: number;
  maxSumCents?: number;
  dateFrom?: string;
  dateTo?: string;
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
    .normalize("NFKD")
    .trim()
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function textIncludesTerm(text: string, term?: string): boolean {
  const needle = compactSearchText(term);
  return needle.length >= 2 && compactSearchText(text).includes(needle);
}

function splitSearchTokens(term?: string): string[] {
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const token of String(term ?? "")
    .toLowerCase()
    .split(/[\s.,;:()[\]{}"'`«»/\\|+*_–—-]+/g)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2)) {
    const key = compactSearchText(token);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    tokens.push(token);
  }
  return tokens;
}

function stemSearchToken(token: string): string {
  const compact = compactSearchText(token);
  if (compact.length < 5) return compact;
  return compact.replace(
    /(иями|ями|ами|ого|его|ому|ему|ыми|ими|ая|яя|ое|ее|ые|ие|ый|ий|ой|ов|ев|ах|ях|ам|ям|ом|ем|а|я|ы|и|у|ю|о|е)$/i,
    ""
  );
}

function searchTokenVariants(token: string): string[] {
  const compact = compactSearchText(token);
  const stem = stemSearchToken(token);
  return [...new Set([compact, stem].filter((item) => item.length >= 3))];
}

function normalizedLookupTerms(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    const compact = compactSearchText(value);
    if (compact.length >= 4 || (compact.length >= 3 && /\d/.test(compact))) seen.add(compact);
    for (const token of splitSearchTokens(value)) {
      const tokenCompact = compactSearchText(token);
      if (tokenCompact.length >= 4 || (tokenCompact.length >= 3 && /\d/.test(tokenCompact))) seen.add(tokenCompact);
    }
  }
  return [...seen].slice(0, 12);
}

async function findNormalizedProductIds(values: Array<string | undefined>): Promise<string[]> {
  const branchId = getScopedBranchId();
  const terms = normalizedLookupTerms(values);
  if (terms.length === 0) return [];
  const predicates = terms.map((term) => Prisma.sql`
    regexp_replace(replace(lower(COALESCE(name, '')), 'ё', 'е'), '[^0-9a-zа-я]', '', 'g') LIKE ${`%${term}%`}
    OR regexp_replace(replace(lower(COALESCE(oem_parts, '')), 'ё', 'е'), '[^0-9a-zа-я]', '', 'g') LIKE ${`%${term}%`}
  `);
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id
    FROM local_products
    WHERE branch_id = ${branchId}
      AND archived = false
      AND (${Prisma.join(predicates, " OR ")})
    LIMIT 1000
  `);
  return rows.map((row) => row.id);
}

function textMatchesToken(haystack: string, token: string): boolean {
  return searchTokenVariants(token).some((variant) => haystack.includes(variant));
}

function textMatchesQuery(text: string, term?: string): boolean {
  if (textIncludesTerm(text, term)) return true;
  const haystack = compactSearchText(text);
  const tokens = splitSearchTokens(term);
  if (tokens.length === 0) return false;
  if (tokens.length <= 2) return tokens.every((token) => textMatchesToken(haystack, token));
  const matched = tokens.filter((token) => textMatchesToken(haystack, token)).length;
  return matched >= Math.max(2, tokens.length - 1);
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

function productIdentityText(product: { name?: string | null; article?: string | null; code?: string | null; oemParts?: string | null }): string {
  return [product.name, product.article, product.code, product.oemParts].join(" ");
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
  const legacyMannName = params.mannName?.trim();
  const paramsValue = params.params?.trim();

  if (search && !textMatchesQuery([productIdentityText(product), product.searchText].join(" "), search)) return false;
  if (
    oem &&
    !textIncludesTerm([product.oem, product.oemParts, attributeText(product.attributes, OEM_ATTR_ID, ["oem parts", "oem"]), product.searchText].join(" "), oem)
  ) return false;
  if (
    legacyMannName &&
    !textIncludesTerm([product.oem, product.oemParts, attributeText(product.attributes, OEM_ATTR_ID, ["oem parts", "oem"]), product.searchText].join(" "), legacyMannName)
  ) {
    return false;
  }
  if (paramsValue && !textIncludesTerm([product.params, attributeText(product.attributes, PARAMS_ATTR_ID, ["параметры"]), product.searchText].join(" "), paramsValue)) {
    return false;
  }
  return true;
}

function entityMeta(entityType: string, localId: string): LocalEntityMeta {
  const safeType = entityType || "product";
  return {
    href: `local://${safeType}/${localId}`,
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
  const legacyMannName = params.mannName?.trim() ?? "";
  const paramsValue = params.params?.trim() ?? "";
  const entityType = params.entityType?.trim() ?? "";
  const searchTokens = splitSearchTokens(search).slice(0, 6);
  const storeName = params.storeName?.trim() ?? "";
  const storeId = params.storeId?.trim() ?? "";
  const [normalizedSearchIds, normalizedOemIds, normalizedLegacyMannIds] = await Promise.all([
    search ? findNormalizedProductIds([search]) : Promise.resolve([]),
    oem ? findNormalizedProductIds([oem]) : Promise.resolve([]),
    legacyMannName ? findNormalizedProductIds([legacyMannName]) : Promise.resolve([]),
  ]);
  const andFilters = [];
  const tokenSearchFilter = (token: string) => {
    const variants = searchTokenVariants(token);
    return variants.length <= 1
      ? { searchText: { contains: variants[0] ?? token, mode: "insensitive" as const } }
      : {
          OR: variants.map((variant) => ({
            searchText: { contains: variant, mode: "insensitive" as const },
          })),
        };
  };
  if (search) {
    const relaxedTokenFilters =
      searchTokens.length >= 3
        ? searchTokens.map((_, omittedIndex) => ({
            AND: searchTokens.filter((__, tokenIndex) => tokenIndex !== omittedIndex).map(tokenSearchFilter),
          }))
        : [];
    andFilters.push({
      OR: [
        { name: { contains: search, mode: "insensitive" as const } },
        { article: { contains: search, mode: "insensitive" as const } },
        { code: { contains: search, mode: "insensitive" as const } },
        { externalCode: { contains: search, mode: "insensitive" as const } },
        { brand: { contains: search, mode: "insensitive" as const } },
        { oemParts: { contains: search, mode: "insensitive" as const } },
        { searchText: { contains: search.toLowerCase(), mode: "insensitive" as const } },
        ...(normalizedSearchIds.length ? [{ id: { in: normalizedSearchIds } }] : []),
        ...(searchTokens.length > 1
          ? [
              {
                AND: searchTokens.map(tokenSearchFilter),
              },
              ...relaxedTokenFilters,
            ]
          : []),
      ],
    });
  }
  if (oem) {
    andFilters.push({
      OR: [
        { oem: { contains: oem, mode: "insensitive" as const } },
        { oemParts: { contains: oem, mode: "insensitive" as const } },
        { searchText: { contains: oem.toLowerCase(), mode: "insensitive" as const } },
        ...(normalizedOemIds.length ? [{ id: { in: normalizedOemIds } }] : []),
      ],
    });
  }
  if (legacyMannName) {
    andFilters.push({
      OR: [
        { oem: { contains: legacyMannName, mode: "insensitive" as const } },
        { oemParts: { contains: legacyMannName, mode: "insensitive" as const } },
        { searchText: { contains: legacyMannName.toLowerCase(), mode: "insensitive" as const } },
        ...(normalizedLegacyMannIds.length ? [{ id: { in: normalizedLegacyMannIds } }] : []),
      ],
    });
  }
  if (paramsValue) {
    andFilters.push({
      OR: [
        { params: { contains: paramsValue, mode: "insensitive" as const } },
        { searchText: { contains: paramsValue.toLowerCase(), mode: "insensitive" as const } },
      ],
    });
  }

  const store = storeId
    ? await prisma.localStore.findFirst({
        where: { id: storeId },
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
      ...(entityType ? { entityType } : {}),
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
        const meta = entityMeta(product.entityType, product.id);
        return {
          id: product.id,
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
          buyPriceCents: stock?.buyPriceCents ?? undefined,
          cost: stock?.buyPriceCents != null ? stock.buyPriceCents / 100 : undefined,
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
  const branchId = getScopedBranchId();
  const counterparties = await prisma.localCounterparty.findMany({
    where: {
      branchId,
      archived: false,
      ...anonymousRetailCounterpartyExclusion(branchId),
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
      id: counterparty.id,
      name: counterparty.name,
      meta: entityMeta("counterparty", counterparty.id),
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
      id: store.id,
      name: store.name,
      isMain: store.isMain,
      meta: entityMeta("store", store.id),
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
        where: { id: storeLookup },
      })
    : storeName
      ? await prisma.localStore.findFirst({ where: { name: { equals: storeName, mode: "insensitive" } } })
      : null;
  if (!store) return { stockByAssortment: {} };

  const ids = params.assortmentHrefs.map(extractEntityId).filter((id): id is string => Boolean(id));
  const products = ids.length
    ? await prisma.localProduct.findMany({
        where: { id: { in: ids } },
        include: { stockBalances: { where: { storeId: store.id }, take: 1 } },
      })
    : [];
  const byId = new Map<string, (typeof products)[number]>();
  for (const product of products) {
    byId.set(product.id, product);
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
      cost: balance?.buyPriceCents != null ? balance.buyPriceCents / 100 : undefined,
      buyPriceCents: balance?.buyPriceCents ?? undefined,
      slotName: balance?.slotName ?? undefined,
    };
  }

  return { stockByAssortment };
}

export async function loadLocalProductCells(hrefs: string[]) {
  const ids = hrefs.map(extractEntityId).filter((id): id is string => Boolean(id));
  const products = ids.length
    ? await prisma.localProduct.findMany({ where: { id: { in: ids } } })
    : [];
  const byId = new Map<string, (typeof products)[number]>();
  for (const product of products) {
    byId.set(product.id, product);
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

function phoneKeyVariants(phone: string): string[] {
  const digits = phone.replace(/\D/g, "");
  const variants = new Set<string>();
  if (digits) variants.add(digits);
  if (/^7\d{10}$/.test(digits)) variants.add(`8${digits.slice(1)}`);
  if (/^8\d{10}$/.test(digits)) variants.add(`7${digits.slice(1)}`);
  if (digits.length >= 10) variants.add(digits.slice(-10));
  return [...variants];
}

function phonesRawArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item ?? "")).filter(Boolean) : [];
}

function normalizeDateFilter(value?: string): string {
  const raw = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "";
  const date = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? "" : raw;
}

type DemandTextSearchParams = Pick<LocalDemandListParams, "search" | "counterparty" | "plate" | "phone" | "vin" | "createdBy">;

async function findDemandTextCandidateIds(branchId: string, params: DemandTextSearchParams): Promise<string[] | null> {
  const predicates: Prisma.Sql[] = [];
  const counterparty = params.counterparty?.trim().toLowerCase() ?? "";
  const search = params.search?.trim().toLowerCase() ?? "";
  const plate = normalizePlate(params.plate ?? "");
  const phone = params.phone?.trim() ?? "";
  const vin = params.vin?.replace(/\s/g, "").toUpperCase() ?? "";
  const createdBy = params.createdBy?.trim().toLowerCase() ?? "";

  if (counterparty) {
    const pattern = `%${counterparty}%`;
    predicates.push(Prisma.sql`(
      lower(COALESCE(c.search_text, '')) LIKE ${pattern}
      OR lower(COALESCE(c.name, '')) LIKE ${pattern}
      OR lower(COALESCE(c.display_name, '')) LIKE ${pattern}
      OR lower(COALESCE(c.legal_title, '')) LIKE ${pattern}
      OR lower(COALESCE(d.agent_name_snapshot, '')) LIKE ${pattern}
    )`);
  }

  if (search) {
    const pattern = `%${search}%`;
    const normalizedSearchPlate = normalizePlate(search);
    const searchParts: Prisma.Sql[] = [Prisma.sql`
      lower(concat_ws(
        ' ',
        COALESCE(d.name, ''),
        COALESCE(d.description, ''),
        COALESCE(d.agent_name_snapshot, ''),
        COALESCE(c.name, ''),
        COALESCE(c.display_name, ''),
        COALESCE(c.phone, ''),
        COALESCE(c.normalized_phone, ''),
        COALESCE(c.search_text, ''),
        COALESCE(c.phones_raw::text, ''),
        COALESCE(d.attributes::text, '')
      )) LIKE ${pattern}
      OR lower(COALESCE(d.name, '')) LIKE ${pattern}
      OR lower(COALESCE(d.description, '')) LIKE ${pattern}
      OR lower(COALESCE(d.agent_name_snapshot, '')) LIKE ${pattern}
      OR lower(COALESCE(c.name, '')) LIKE ${pattern}
      OR lower(COALESCE(c.display_name, '')) LIKE ${pattern}
      OR lower(COALESCE(c.phone, '')) LIKE ${pattern}
      OR lower(COALESCE(c.normalized_phone, '')) LIKE ${pattern}
      OR lower(COALESCE(c.search_text, '')) LIKE ${pattern}
      OR lower(COALESCE(c.phones_raw::text, '')) LIKE ${pattern}
      OR lower(COALESCE(d.attributes::text, '')) LIKE ${pattern}
      OR EXISTS (
        SELECT 1
        FROM local_demand_positions p
        WHERE p.branch_id = d.branch_id
          AND p.demand_id = d.id
          AND (
            lower(COALESCE(p.name, '')) LIKE ${pattern}
            OR lower(COALESCE(p.raw::text, '')) LIKE ${pattern}
          )
      )
    `];
    if (normalizedSearchPlate) {
      searchParts.push(Prisma.sql`
        regexp_replace(
          translate(upper(COALESCE(d.attributes::text, '')), 'АВЕКМНОРСТУХ', 'ABEKMHOPCTYX'),
          '[^A-ZА-ЯЁ0-9]',
          '',
          'g'
        ) LIKE ${`%${normalizedSearchPlate}%`}
      `);
    }
    const searchPhoneVariants = phoneKeyVariants(search);
    if (searchPhoneVariants.some((variant) => variant.length >= 4)) {
      const phonePredicates = searchPhoneVariants
        .filter((variant) => variant.length >= 4)
        .map((variant) => Prisma.sql`
          regexp_replace(
            concat_ws(' ', COALESCE(c.phone, ''), COALESCE(c.normalized_phone, ''), COALESCE(c.phones_raw::text, '')),
            '[^0-9]',
            '',
            'g'
          ) LIKE ${`%${variant}%`}
        `);
      searchParts.push(Prisma.sql`(${Prisma.join(phonePredicates, " OR ")})`);
    }
    predicates.push(Prisma.sql`(${Prisma.join(searchParts, " OR ")})`);
  }

  if (plate) {
    predicates.push(Prisma.sql`EXISTS (
      SELECT 1
      FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(d.attributes) = 'array' THEN d.attributes ELSE '[]'::jsonb END
      ) attr
      WHERE COALESCE(attr->>'name', '') ~* '(гос|г/н|госномер|г\\.\\s*н|номер\\s*(тс|а/м|авто)|state\\s*reg|plate)'
        AND regexp_replace(
          translate(upper(COALESCE(attr->>'value', '')), 'АВЕКМНОРСТУХ', 'ABEKMHOPCTYX'),
          '[^A-ZА-ЯЁ0-9]',
          '',
          'g'
        ) LIKE ${`%${plate}%`}
    )`);
  }

  if (vin) {
    predicates.push(Prisma.sql`EXISTS (
      SELECT 1
      FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(d.attributes) = 'array' THEN d.attributes ELSE '[]'::jsonb END
      ) attr
      WHERE COALESCE(attr->>'name', '') ~* '(vin|вин)'
        AND regexp_replace(upper(COALESCE(attr->>'value', '')), '[^A-Z0-9]', '', 'g') LIKE ${`%${vin}%`}
    )`);
  }

  if (createdBy) {
    predicates.push(Prisma.sql`EXISTS (
      SELECT 1
      FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(d.attributes) = 'array' THEN d.attributes ELSE '[]'::jsonb END
      ) attr
      WHERE lower(trim(COALESCE(attr->>'name', ''))) = 'эко пользователь'
        AND lower(COALESCE(attr->>'value', '')) LIKE ${`%${createdBy}%`}
    )`);
  }

  if (phone) {
    const variants = phoneKeyVariants(phone).filter((variant) => variant.length >= 4);
    if (variants.length === 0) return [];
    const phonePredicates = variants.map((variant) => Prisma.sql`
      regexp_replace(
        concat_ws(' ', COALESCE(c.phone, ''), COALESCE(c.normalized_phone, ''), COALESCE(c.phones_raw::text, '')),
        '[^0-9]',
        '',
        'g'
      ) LIKE ${`%${variant}%`}
    `);
    predicates.push(Prisma.sql`(${Prisma.join(phonePredicates, " OR ")})`);
  }

  if (predicates.length === 0) return null;
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT d.id
    FROM local_demands d
    LEFT JOIN local_counterparties c
      ON c.branch_id = d.branch_id
      AND c.id = d.counterparty_id
    WHERE d.branch_id = ${branchId}
      AND (${Prisma.join(predicates, " AND ")})
  `);
  return rows.map((row) => row.id);
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
  const vin = params.vin?.replace(/\s/g, "").toUpperCase() ?? "";
  const store = params.store?.trim() ?? "";
  const createdBy = params.createdBy?.trim().toLowerCase() ?? "";
  const minSumCents = Number.isFinite(params.minSumCents) ? Math.max(0, Math.round(params.minSumCents ?? 0)) : undefined;
  const maxSumCents = Number.isFinite(params.maxSumCents) ? Math.max(0, Math.round(params.maxSumCents ?? 0)) : undefined;
  const dateFrom = normalizeDateFilter(params.dateFrom);
  const dateTo = normalizeDateFilter(params.dateTo);
  const offset = Math.max(0, params.offset ?? 0);
  const limit = Math.min(100, Math.max(1, params.limit ?? 50));
  const textCandidateIds = await findDemandTextCandidateIds(params.branchId, {
    search,
    counterparty,
    plate,
    phone,
    vin,
    createdBy,
  });

  const and = [];
  if (store) {
    and.push({
      OR: [
        { store: { name: { contains: store, mode: "insensitive" as const } } },
        { storeNameSnapshot: { contains: store, mode: "insensitive" as const } },
      ],
    });
  }
  if (params.status === "draft" || params.status === "posted") {
    and.push({ applicable: params.status === "posted" });
  }
  if (minSumCents !== undefined || maxSumCents !== undefined) {
    and.push({
      sumCents: {
        ...(minSumCents !== undefined ? { gte: minSumCents } : {}),
        ...(maxSumCents !== undefined ? { lte: maxSumCents } : {}),
      },
    });
  }
  if (dateFrom || dateTo) {
    and.push({
      documentDate: {
        ...(dateFrom ? { gte: dateFrom } : {}),
        ...(dateTo ? { lte: dateTo } : {}),
      },
    });
  }
  if (textCandidateIds?.length === 0) return { meta: { size: 0, limit, offset }, rows: [] };
  const baseWhere = {
    branchId: params.branchId,
    ...(and.length > 0 ? { AND: and } : {}),
    ...(textCandidateIds ? { id: { in: textCandidateIds } } : {}),
  };

  let paymentCandidateIds: string[] | null = null;
  if (params.payment) {
    const paymentCandidates = await prisma.localDemand.findMany({
      where: baseWhere,
      select: { id: true, raw: true, applicable: true },
    });
    paymentCandidateIds = paymentCandidates
      .filter((row) => demandPaymentStatusFromRaw(row.raw, row.applicable) === params.payment)
      .map((row) => row.id);
    if (paymentCandidateIds.length === 0) return { meta: { size: 0, limit, offset }, rows: [] };
  }

  const where = paymentCandidateIds ? { ...baseWhere, id: { in: paymentCandidateIds } } : baseWhere;
  const [total, rows] = await Promise.all([
    prisma.localDemand.count({ where }),
    prisma.localDemand.findMany({
      where,
      include: { counterparty: true, store: true, _count: { select: { positions: true } } },
      orderBy: [{ momentAt: "desc" }],
      skip: offset,
      take: limit,
    }),
  ]);

  return {
    meta: { size: total, limit, offset },
    rows: rows.map((row) => localDemandToApiShape(row)),
  };
}

type LocalDemandWithRelations = Awaited<ReturnType<typeof prisma.localDemand.findMany>>[number] & {
  counterparty?: {
    id: string;
    name: string;
    phone: string | null;
    normalizedPhone?: string | null;
    phonesRaw: unknown;
    searchText?: string | null;
  } | null;
  store?: {
    name: string;
  } | null;
  _count?: {
    positions: number;
  };
};

function localDemandToApiShape(row: LocalDemandWithRelations) {
  const counterpartyMeta = row.counterparty
    ? entityMeta("counterparty", row.counterparty.id)
    : undefined;
  return {
    id: row.id,
    name: row.name,
    moment: row.momentAt.toISOString(),
    applicable: row.applicable,
    paymentStatus: demandPaymentStatusFromRaw(row.raw, row.applicable),
    sum: row.sumCents,
    description: row.description ?? "",
    agent: row.counterparty
      ? {
          id: row.counterparty.id,
          name: row.counterparty.name,
          phone: row.counterparty.phone ?? undefined,
          phones: phonesRawArray(row.counterparty.phonesRaw).map((phone) => ({ phone })),
          meta: counterpartyMeta,
        }
      : row.agentNameSnapshot
        ? {
            id: undefined,
            name: row.agentNameSnapshot,
            meta: undefined,
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
    positionCount: row._count?.positions ?? 0,
  };
}
