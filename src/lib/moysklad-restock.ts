import { prisma } from "@/lib/db";
import { toServiceDateInput } from "@/lib/date-time";

export type RestockCatalogEntry = {
  id: string;
  name: string | null;
  code: string | null;
  minimumBalance: number | null;
  group: string | null;
  supplier: string | null;
};

export type RestockCatalog = Record<string, RestockCatalogEntry>;

export type RestockItem = {
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
  shortage?: number;
  spentInPeriod?: number;
};

export function extractIdFromHref(href: string): string | null {
  if (!href) return null;
  const base = href.split("?", 1)[0].replace(/\/$/, "");
  const parts = base.split("/");
  const last = parts[parts.length - 1]?.trim();
  return last || null;
}

export function toFloat(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const s = v.trim().replace(",", ".");
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function needsOrder(item: RestockItem): boolean {
  const stock = toFloat(item.stock);
  if (stock === null) return false;
  const mb = toFloat(item.minimumBalance);
  if (mb === null) return false;
  item.minimumBalance = mb;
  return stock < mb;
}

export function shortage(item: RestockItem): number | null {
  const stock = toFloat(item.stock);
  if (stock === null) return null;
  const mb = toFloat(item.minimumBalance);
  if (mb === null) return null;
  item.minimumBalance = mb;
  const s = mb - stock;
  return s > 0 ? s : 0;
}

type StockRowRaw = {
  meta?: { href?: string };
  stock?: unknown;
  reserve?: unknown;
  inTransit?: unknown;
  quantity?: unknown;
};

export function buildStockMap(rows: StockRowRaw[]): Record<string, Pick<RestockItem, "stock" | "reserve" | "inTransit" | "quantity">> {
  const m: Record<string, Pick<RestockItem, "stock" | "reserve" | "inTransit" | "quantity">> = {};
  for (const r of rows) {
    const href = r.meta && typeof r.meta === "object" ? (r.meta as { href?: string }).href : undefined;
    if (typeof href !== "string") continue;
    const pid = extractIdFromHref(href);
    if (!pid) continue;
    m[pid] = {
      stock: toFloat(r.stock) ?? 0,
      reserve: toFloat(r.reserve) ?? 0,
      inTransit: toFloat(r.inTransit) ?? 0,
      quantity: toFloat(r.quantity) ?? 0,
    };
  }
  return m;
}

export function buildNeedsOrderFromCatalog(catalog: RestockCatalog, stockMap: ReturnType<typeof buildStockMap>): RestockItem[] {
  const items: RestockItem[] = [];
  for (const pid of Object.keys(catalog)) {
    const p = catalog[pid];
    const it: RestockItem = {
      productId: pid,
      name: p.name,
      code: p.code,
      group: p.group,
      minimumBalance: p.minimumBalance,
      supplier: p.supplier,
      stock: 0,
      reserve: 0,
      inTransit: 0,
      quantity: 0,
    };
    const s = stockMap[pid];
    if (s) {
      it.stock = s.stock;
      it.reserve = s.reserve;
      it.inTransit = s.inTransit;
      it.quantity = s.quantity;
    }
    items.push(it);
  }
  return items;
}

export async function fetchProductCatalog(): Promise<RestockCatalog> {
  const idx: RestockCatalog = {};
  const products = await prisma.localProduct.findMany({
    where: { archived: false, entityType: { not: "service" } },
    select: {
      id: true,
      name: true,
      article: true,
      code: true,
      externalCode: true,
      rosskoPartNumber: true,
      minimumBalance: true,
      groupPath: true,
      supplierName: true,
      supplierAttribute: true,
    },
    orderBy: [{ name: "asc" }],
  });

  for (const product of products) {
    idx[product.id] = {
      id: product.id,
      name: product.name,
      code: product.rosskoPartNumber ?? product.article ?? product.code ?? product.externalCode ?? null,
      minimumBalance: toFloat(product.minimumBalance),
      group: product.groupPath,
      supplier: product.supplierName ?? product.supplierAttribute,
    };
  }

  return idx;
}

let catalogCache: { at: number; map: RestockCatalog } | null = null;
const CATALOG_TTL_MS = Math.max(30_000, parseInt(process.env.RESTOCK_CATALOG_CACHE_MS ?? "120000", 10) || 120_000);

export function clearRestockCatalogCache(): void {
  catalogCache = null;
}

export async function getProductCatalogCached(refresh: boolean): Promise<RestockCatalog> {
  if (refresh) {
    clearRestockCatalogCache();
  }
  const now = Date.now();
  if (catalogCache && now - catalogCache.at < CATALOG_TTL_MS) {
    return catalogCache.map;
  }
  const map = await fetchProductCatalog();
  catalogCache = { at: Date.now(), map };
  return map;
}

export async function fetchStockAllPages(opts: {
  stockMode?: string;
  pageLimit: number;
  maxPages: number;
}): Promise<StockRowRaw[]> {
  const { pageLimit, maxPages } = opts;
  if (pageLimit < 1 || pageLimit > 1000) throw new Error("pageLimit must be 1..1000");
  if (maxPages < 1) throw new Error("maxPages must be >= 1");

  const balances = await prisma.localStockBalance.findMany({
    include: { product: { select: { id: true } } },
    orderBy: [{ productId: "asc" }],
    take: pageLimit * maxPages,
  });

  const byProduct = new Map<string, Pick<RestockItem, "stock" | "reserve" | "inTransit" | "quantity">>();
  for (const balance of balances) {
    const prev = byProduct.get(balance.productId) ?? { stock: 0, reserve: 0, inTransit: 0, quantity: 0 };
    byProduct.set(balance.productId, {
      stock: prev.stock + (toFloat(balance.available) ?? 0),
      reserve: prev.reserve + (toFloat(balance.reserve) ?? 0),
      inTransit: prev.inTransit,
      quantity: prev.quantity + (toFloat(balance.quantity) ?? 0),
    });
  }

  return [...byProduct.entries()].map(([productId, stock]) => ({
    meta: { href: `local://product/${productId}` },
    ...stock,
  }));
}

export async function loadNeedsOrderItems(opts: {
  refresh: boolean;
  pageLimit: number;
  maxPages: number;
}): Promise<{ items: RestockItem[]; fetchedRows: number; catalogSize: number }> {
  const catalog = await getProductCatalogCached(opts.refresh);
  const rows = await fetchStockAllPages({
    stockMode: "all",
    pageLimit: opts.pageLimit,
    maxPages: opts.maxPages,
  });
  const stockMap = buildStockMap(rows);
  let items = buildNeedsOrderFromCatalog(catalog, stockMap);
  items = items.filter((it) => needsOrder(it));
  for (const it of items) {
    const sh = shortage(it);
    if (sh !== null) it.shortage = sh;
  }
  return { items, fetchedRows: rows.length, catalogSize: Object.keys(catalog).length };
}

export function calendarRangeMomentBounds(
  dateFromStr: string,
  dateToStr: string
): { momentFrom: string; momentTo: string; label: string } {
  const df = dateFromStr.trim();
  const dt = dateToStr.trim();
  const [yf, mf, daf] = df.split("-").map((x) => parseInt(x, 10));
  const [yt, mt, dat] = dt.split("-").map((x) => parseInt(x, 10));
  if (!yf || !mf || !daf || !yt || !mt || !dat) throw new Error("Некорректные даты");

  const momentFrom = `${df} 00:00:00`;
  const momentTo = `${dt} 23:59:59`;

  const label =
    df === dt
      ? `${String(daf).padStart(2, "0")}.${String(mf).padStart(2, "0")}.${yf}`
      : `${String(daf).padStart(2, "0")}.${String(mf).padStart(2, "0")}.${yf}–${String(dat).padStart(2, "0")}.${String(mt).padStart(2, "0")}.${yt}`;

  return { momentFrom, momentTo, label };
}

/** Сегодня по календарю в часовом поясе Europe/Moscow. */
export function todayIsoInMoscow(): string {
  return toServiceDateInput(new Date());
}

export async function aggregateOutflowFromEntities(momentFrom: string, momentTo: string): Promise<Record<string, number>> {
  const totals: Record<string, number> = {};
  const dateFrom = momentFrom.slice(0, 10);
  const dateTo = momentTo.slice(0, 10);

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

  for (const row of [...demands, ...writeoffs]) {
    if (!row.productId) continue;
    const quantity = toFloat(row._sum.quantity) ?? 0;
    if (quantity > 0) totals[row.productId] = (totals[row.productId] ?? 0) + quantity;
  }
  return totals;
}

export async function loadOutflowNeedsItems(opts: {
  refresh: boolean;
  pageLimit: number;
  maxPages: number;
  dateFrom: string | null;
  dateTo: string | null;
}): Promise<{
  items: RestockItem[];
  fetchedRows: number;
  catalogSize: number;
  dateLabel: string;
  dateFrom: string;
  dateTo: string;
  momentFrom: string;
  momentTo: string;
}> {
  let dateFrom = opts.dateFrom?.trim() || "";
  let dateTo = opts.dateTo?.trim() || "";
  if (!dateFrom || !dateTo) {
    const t = todayIsoInMoscow();
    dateFrom = t;
    dateTo = t;
  }

  const { momentFrom, momentTo, label } = calendarRangeMomentBounds(dateFrom, dateTo);

  const catalog = await getProductCatalogCached(opts.refresh);
  const [rows, outMap] = await Promise.all([
    fetchStockAllPages({ stockMode: "all", pageLimit: opts.pageLimit, maxPages: opts.maxPages }),
    aggregateOutflowFromEntities(momentFrom, momentTo),
  ]);

  const stockMap = buildStockMap(rows);
  const items = buildNeedsOrderFromCatalog(catalog, stockMap);
  for (const it of items) {
    const sh = shortage(it);
    if (sh !== null) it.shortage = sh;
  }

  const out: RestockItem[] = [];
  for (const it of items) {
    if (!needsOrder(it)) continue;
    const pid = it.productId;
    const spent = outMap[pid] ?? 0;
    if (spent <= 0) continue;
    out.push({ ...it, spentInPeriod: spent });
  }

  out.sort((a, b) => {
    const sa = a.spentInPeriod ?? 0;
    const sb = b.spentInPeriod ?? 0;
    if (sb !== sa) return sb - sa;
    const da = a.shortage ?? 0;
    const db = b.shortage ?? 0;
    if (db !== da) return db - da;
    return String(a.name ?? "").localeCompare(String(b.name ?? ""));
  });

  return {
    items: out,
    fetchedRows: rows.length,
    catalogSize: Object.keys(catalog).length,
    dateLabel: label,
    dateFrom,
    dateTo,
    momentFrom,
    momentTo,
  };
}
