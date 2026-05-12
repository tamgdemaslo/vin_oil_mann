import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { MOYSKLAD_BASE, moyskladFetch } from "@/lib/moysklad";

/** OEM PARTS */
const OEM_ATTR_HREF = `${MOYSKLAD_BASE}/entity/product/metadata/attributes/d1aad1ea-14e1-11f1-0a80-0eb200223523`;
/** Наименование по Mann */
const MANN_ATTR_HREF = `${MOYSKLAD_BASE}/entity/product/metadata/attributes/ca6f792f-4451-11ee-0a80-0dba0047437a`;
/** Параметры */
const PARAMS_ATTR_HREF = `${MOYSKLAD_BASE}/entity/product/metadata/attributes/7944ef04-f831-11e5-7a69-971500188b19`;
/** Ячейка (доп. поле товара) */
const CELL_ATTR_ID = "7ad15eda-204c-11f1-0a80-19f100217481";

const PER_TERM_LIMIT = 30;
const MAX_TERMS = 5;
const STOCK_ROUTE_CACHE_TTL_MS = Math.max(5_000, parseInt(process.env.STOCK_REPORT_CACHE_MS ?? "30000", 10) || 30_000);

type StoreStock = { name: string; stock: number; reserve?: number };
type StockRow = {
  meta?: { href?: string };
  assortment?: { meta?: { href?: string } };
  stockByStore?: StoreStock[];
};

type BySlotRow = {
  meta?: { href?: string };
  assortment?: { meta?: { href?: string } };
  stockBySlot?: { slot?: { name?: string }; stock?: number }[];
};

let byStoreCache: { at: number; rows: StockRow[] } | null = null;
let byStoreInFlight: Promise<StockRow[]> | null = null;
const bySlotCache = new Map<string, { at: number; rows: BySlotRow[] }>();
const bySlotInFlight = new Map<string, Promise<BySlotRow[]>>();

type SalePrice = { value: number; currency?: { name?: string } };
type Row = {
  id: string;
  name: string;
  article?: string;
  salePrices?: SalePrice[];
  meta: { href: string; type: string; mediaType: string };
};

function toPath(h: string): string {
  const s = (h ?? "").trim();
  if (!s) return "";
  try {
    const url = new URL(s.startsWith("http") ? s : `https://x${s}`);
    const path = s.startsWith("http") ? url.pathname : s;
    const match = path.match(/\/(entity\/product|entity\/variant)\/[a-f0-9-]+/i);
    return match ? match[0] : path;
  } catch {
    return s;
  }
}

async function getCachedByStoreRows(): Promise<StockRow[]> {
  if (byStoreCache && Date.now() - byStoreCache.at <= STOCK_ROUTE_CACHE_TTL_MS) return byStoreCache.rows;
  if (byStoreInFlight) return byStoreInFlight;
  byStoreInFlight = (async () => {
    try {
      const res = await moyskladFetch<{ rows?: StockRow[] }>("/report/stock/bystore", {
        cache: "no-store",
      });
      if (!res.ok) return [];
      const rows = res.data.rows ?? [];
      byStoreCache = { at: Date.now(), rows };
      return rows;
    } finally {
      byStoreInFlight = null;
    }
  })();
  return byStoreInFlight;
}

async function getCachedBySlotRows(storeHref: string): Promise<BySlotRow[]> {
  const cached = bySlotCache.get(storeHref);
  if (cached && Date.now() - cached.at <= STOCK_ROUTE_CACHE_TTL_MS) return cached.rows;
  const inFlight = bySlotInFlight.get(storeHref);
  if (inFlight) return inFlight;
  const promise = (async () => {
    try {
      const res = await moyskladFetch<{ rows?: BySlotRow[] }>(
        `/report/stock/byslot?store=${encodeURIComponent(storeHref)}`,
        { cache: "no-store" }
      );
      if (!res.ok) return [];
      const rows = res.data.rows ?? [];
      bySlotCache.set(storeHref, { at: Date.now(), rows });
      return rows;
    } finally {
      bySlotInFlight.delete(storeHref);
    }
  })();
  bySlotInFlight.set(storeHref, promise);
  return promise;
}

function normalizeTermKey(s: string): string {
  return s.replace(/\s/g, "").toLowerCase();
}

function addRowsToMap(map: Map<string, Row>, rows: Row[] | undefined) {
  for (const r of rows ?? []) {
    if (r.id && !map.has(r.id)) map.set(r.id, r);
  }
}

type ProductAttr = { id?: string; name?: string; value?: string | number };
type ProductRowWithAttrs = Row & { attributes?: ProductAttr[] };

function productSearchText(row: ProductRowWithAttrs): string {
  const parts = [row.name ?? "", row.article ?? ""];
  for (const attr of row.attributes ?? []) {
    parts.push(attr.name ?? "");
    parts.push(String(attr.value ?? ""));
  }
  return parts.join(" ").toLowerCase();
}

function productMatchesTerms(row: ProductRowWithAttrs, terms: string[]): boolean {
  const haystack = productSearchText(row).replace(/\s/g, "");
  return terms.some((term) => {
    const needle = term.trim().toLowerCase().replace(/\s/g, "");
    return needle.length >= 2 && haystack.includes(needle);
  });
}

function toProduct(r: Row, cell?: number | string | null) {
  const priceCents = r.salePrices?.[0]?.value ?? 0;
  const price = priceCents / 100;
  const currency = r.salePrices?.[0]?.currency?.name ?? "руб.";
  return {
    id: r.id,
    name: r.name,
    article: r.article,
    price,
    currency,
    meta: r.meta,
    cell: cell != null && cell !== "" ? String(cell) : undefined,
  };
}
function getCellFromAttributes(attributes?: ProductAttr[]): number | string | null {
  if (!Array.isArray(attributes)) return null;
  const a = attributes.find((x) => x.id === CELL_ATTR_ID);
  if (a == null || a.value == null) return null;
  return typeof a.value === "number" ? a.value : String(a.value).trim() || null;
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  }
  const search = request.nextUrl.searchParams.get("search") ?? "";
  const oem = request.nextUrl.searchParams.get("oem") ?? "";
  const mannName = request.nextUrl.searchParams.get("mannName") ?? "";
  const params = request.nextUrl.searchParams.get("params") ?? "";
  const storeName = (request.nextUrl.searchParams.get("storeName") ?? "").trim();
  const storeId = (request.nextUrl.searchParams.get("storeId") ?? "").trim();
  const limit = Math.min(100, parseInt(request.nextUrl.searchParams.get("limit") ?? "30", 10) || 30);

  const rawTerms = [search.trim(), oem.trim(), mannName.trim(), params.trim()].filter(Boolean);
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const t of rawTerms) {
    const key = normalizeTermKey(t);
    if (key && !seen.has(key)) {
      seen.add(key);
      terms.push(t);
    }
  }
  const termsSlice = terms.slice(0, MAX_TERMS);

  const productMap = new Map<string, Row>();

  if (termsSlice.length === 0) {
    const path = `/entity/product?limit=${limit}`;
    const result = await moyskladFetch<{ rows: Row[] }>(path);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
    (result.data.rows ?? []).forEach((r) => productMap.set(r.id, r));
  } else {
    const enc = encodeURIComponent;
    for (const term of termsSlice) {
      const val = term.trim();
      if (!val) continue;
      const [byOem, byMann, byParams, bySearch] = await Promise.all([
        moyskladFetch<{ rows?: Row[] }>(
          `/entity/product?filter=${enc(OEM_ATTR_HREF)}~${enc(val)}&limit=${PER_TERM_LIMIT}&expand=attributes`,
          { cache: "no-store" }
        ),
        moyskladFetch<{ rows?: Row[] }>(
          `/entity/product?filter=${enc(MANN_ATTR_HREF)}~${enc(val)}&limit=${PER_TERM_LIMIT}&expand=attributes`,
          { cache: "no-store" }
        ),
        moyskladFetch<{ rows?: Row[] }>(
          `/entity/product?filter=${enc(PARAMS_ATTR_HREF)}~${enc(val)}&limit=${PER_TERM_LIMIT}&expand=attributes`,
          { cache: "no-store" }
        ),
        moyskladFetch<{ rows?: Row[] }>(
          `/entity/product?search=${enc(val)}&limit=${PER_TERM_LIMIT}&expand=attributes`,
          { cache: "no-store" }
        ),
      ]);
      if (byOem.ok) addRowsToMap(productMap, byOem.data?.rows);
      if (byMann.ok) addRowsToMap(productMap, byMann.data?.rows);
      if (byParams.ok) addRowsToMap(productMap, byParams.data?.rows);
      if (bySearch.ok) addRowsToMap(productMap, bySearch.data?.rows);
    }

    if (productMap.size === 0 && termsSlice.length > 0) {
      const batch = await moyskladFetch<{ rows?: ProductRowWithAttrs[] }>(
        `/entity/product?limit=500&expand=attributes`,
        { cache: "no-store" }
      );
      if (batch.ok && batch.data?.rows) {
        for (const row of batch.data.rows) {
          if (productMatchesTerms(row, termsSlice)) productMap.set(row.id, row);
        }
      }
    }
  }

  const rows = Array.from(productMap.values()).slice(0, limit);
  const withAttrs = await Promise.all(
    rows.map(async (r) => {
      const res = await moyskladFetch<ProductRowWithAttrs>(`/entity/product/${r.id}`, { cache: "no-store" });
      const cell = res.ok ? getCellFromAttributes(res.data?.attributes) : null;
      return toProduct(r, cell);
    })
  );

  if (!storeName || withAttrs.length === 0) {
    return NextResponse.json({ products: withAttrs });
  }

  const wantByPath = new Map<string, string>();
  const stockByHref = new Map<string, { quantity: number; reserve: number; available: number; slotName?: string }>();
  for (const product of withAttrs) {
    const href = product.meta?.href ?? "";
    const path = toPath(href);
    wantByPath.set(path, href);
    wantByPath.set(href, href);
    stockByHref.set(href, { quantity: 0, reserve: 0, available: 0 });
  }

  const storeNameLower = storeName.toLowerCase();
  const byStoreRows = await getCachedByStoreRows();
  for (const row of byStoreRows) {
    const rawHref = (row.assortment?.meta?.href ?? row.meta?.href ?? "").trim();
    if (!rawHref) continue;
    const href = wantByPath.get(toPath(rawHref)) ?? wantByPath.get(rawHref);
    if (!href) continue;
    const forStore = (row.stockByStore ?? []).find((item) => (item.name ?? "").toLowerCase() === storeNameLower);
    const quantity = forStore?.stock ?? 0;
    const reserve = forStore?.reserve ?? 0;
    stockByHref.set(href, {
      quantity,
      reserve,
      available: Math.max(0, quantity - reserve),
      slotName: stockByHref.get(href)?.slotName,
    });
  }

  if (storeId) {
    const bySlotRows = await getCachedBySlotRows(`${MOYSKLAD_BASE}/entity/store/${storeId}`);
    for (const row of bySlotRows) {
      const rawHref = (row.assortment?.meta?.href ?? row.meta?.href ?? "").trim();
      if (!rawHref) continue;
      const href = wantByPath.get(toPath(rawHref)) ?? wantByPath.get(rawHref);
      if (!href) continue;
      const firstWithStock = (row.stockBySlot ?? []).find((item) => (item.stock ?? 0) > 0 && (item.slot?.name ?? "").trim());
      const slotName = firstWithStock?.slot?.name?.trim();
      if (!slotName) continue;
      const prev = stockByHref.get(href) ?? { quantity: 0, reserve: 0, available: 0 };
      stockByHref.set(href, { ...prev, slotName });
    }
  }

  const products = withAttrs.map((product) => {
    const stock = stockByHref.get(product.meta.href);
    return {
      ...product,
      stockQuantity: stock?.quantity ?? 0,
      reserveQuantity: stock?.reserve ?? 0,
      availableQuantity: stock?.available ?? 0,
      slotName: stock?.slotName,
    };
  }).sort((a, b) => {
    const aAvailable = a.availableQuantity ?? a.stockQuantity ?? 0;
    const bAvailable = b.availableQuantity ?? b.stockQuantity ?? 0;
    const aInStock = aAvailable > 0 ? 1 : 0;
    const bInStock = bAvailable > 0 ? 1 : 0;
    if (bInStock !== aInStock) return bInStock - aInStock;
    if (bAvailable !== aAvailable) return bAvailable - aAvailable;
    if (a.price !== b.price) return a.price - b.price;
    return a.name.localeCompare(b.name, "ru");
  });
  return NextResponse.json({ products });
}
