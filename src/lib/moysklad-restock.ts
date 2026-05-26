import { moyskladFetch } from "@/lib/moysklad";

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

function rowToCatalogEntry(row: Record<string, unknown>): [string, RestockCatalogEntry] | null {
  const pid = row.id;
  if (typeof pid !== "string" || !pid) return null;

  let minimumBalance: number | null = null;
  const rawMb = row.minimumBalance;
  if (typeof rawMb === "number" && Number.isFinite(rawMb)) minimumBalance = rawMb;

  let group: string | null = null;
  const pf = row.productFolder;
  if (pf && typeof pf === "object") {
    const n = (pf as { name?: string }).name;
    if (typeof n === "string" && n.trim()) group = n.trim();
  }

  let supplier: string | null = null;
  const sup = row.supplier;
  if (sup && typeof sup === "object") {
    const n = (sup as { name?: string }).name;
    if (typeof n === "string" && n.trim()) supplier = n.trim();
  }

  const name = typeof row.name === "string" ? row.name : null;
  const code = typeof row.code === "string" ? row.code : null;

  return [
    pid,
    {
      id: pid,
      name,
      code,
      minimumBalance,
      group,
      supplier,
    },
  ];
}

export async function fetchProductCatalog(): Promise<RestockCatalog> {
  const idx: RestockCatalog = {};
  let offset = 0;
  const limit = 100;

  for (;;) {
    const path = `/entity/product?limit=${limit}&offset=${offset}&filter=archived=false&expand=productFolder,supplier`;
    const res = await moyskladFetch<{ rows?: Record<string, unknown>[] }>(path, { cache: "no-store" });
    if (!res.ok) throw new Error(res.error);
    const rows = res.data.rows ?? [];
    for (const r of rows) {
      if (!r || typeof r !== "object") continue;
      const pair = rowToCatalogEntry(r as Record<string, unknown>);
      if (pair) idx[pair[0]] = pair[1];
    }
    if (rows.length < limit) break;
    offset += limit;
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
  const { stockMode, pageLimit, maxPages } = opts;
  if (pageLimit < 1 || pageLimit > 1000) throw new Error("pageLimit must be 1..1000");
  if (maxPages < 1) throw new Error("maxPages must be >= 1");

  let url =
    `/report/stock/all?limit=${pageLimit}&offset=0` +
    (stockMode ? `&stockMode=${encodeURIComponent(stockMode)}` : "");
  const all: StockRowRaw[] = [];

  for (let page = 0; page < maxPages; page++) {
    const res = await moyskladFetch<{ rows?: StockRowRaw[]; meta?: { nextHref?: string } }>(url, {
      cache: "no-store",
    });
    if (!res.ok) throw new Error(res.error);
    const rows = res.data.rows ?? [];
    for (const r of rows) {
      if (r && typeof r === "object") all.push(r as StockRowRaw);
    }
    const next = res.data.meta?.nextHref;
    if (typeof next !== "string" || !next) break;
    url = next;
  }

  return all;
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

function iterDocumentPositions(doc: Record<string, unknown>): Record<string, unknown>[] {
  const pos = doc.positions;
  if (pos && typeof pos === "object" && !Array.isArray(pos)) {
    const rows = (pos as { rows?: unknown }).rows;
    if (Array.isArray(rows)) return rows.filter((x) => x && typeof x === "object") as Record<string, unknown>[];
  }
  if (Array.isArray(pos)) return pos.filter((x) => x && typeof x === "object") as Record<string, unknown>[];
  return [];
}

function positionProductIdAndQty(pos: Record<string, unknown>): [string | null, number] {
  const qty = toFloat(pos.quantity);
  if (qty === null || qty <= 0) return [null, 0];
  const assortment = pos.assortment;
  if (!assortment || typeof assortment !== "object") return [null, 0];
  const as = assortment as Record<string, unknown>;
  const productO = as.product;
  if (productO && typeof productO === "object") {
    const pm = (productO as { meta?: { href?: string } }).meta;
    if (pm && typeof pm.href === "string") {
      const pid = extractIdFromHref(pm.href);
      if (pid) return [pid, qty];
    }
  }
  const meta = as.meta;
  if (meta && typeof meta === "object") {
    const href = (meta as { href?: string }).href;
    if (typeof href === "string") {
      const pid = extractIdFromHref(href);
      if (pid) return [pid, qty];
    }
  }
  return [null, 0];
}

async function aggregateSingleDocumentPath(
  path: string,
  filt: string
): Promise<Record<string, number>> {
  const totals: Record<string, number> = {};
  let offset = 0;
  const limit = 100;
  let pageGuard = 0;
  const expand = "positions.assortment,positions.assortment.product";

  for (;;) {
    pageGuard++;
    if (pageGuard > 500) break;
    const q =
      `/${path}?limit=${limit}&offset=${offset}&filter=${encodeURIComponent(filt)}&expand=${encodeURIComponent(expand)}`;
    const res = await moyskladFetch<{ rows?: Record<string, unknown>[] }>(q, { cache: "no-store" });
    if (!res.ok) break;
    const rows = res.data.rows ?? [];
    for (const doc of rows) {
      if (!doc || typeof doc !== "object") continue;
      for (const pos of iterDocumentPositions(doc as Record<string, unknown>)) {
        const [pid, qn] = positionProductIdAndQty(pos);
        if (pid && qn > 0) totals[pid] = (totals[pid] ?? 0) + qn;
      }
    }
    if (rows.length < limit) break;
    offset += limit;
  }
  return totals;
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
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  if (y && m && d) return `${y}-${m}-${d}`;
  return new Date().toISOString().slice(0, 10);
}

export async function aggregateOutflowFromEntities(momentFrom: string, momentTo: string): Promise<Record<string, number>> {
  const filt = `moment>=${momentFrom};moment<=${momentTo}`;
  const paths = ["entity/demand", "entity/retaildemand", "entity/loss"] as const;
  const parts = await Promise.all(paths.map((p) => aggregateSingleDocumentPath(p, filt)));
  const totals: Record<string, number> = {};
  for (const part of parts) {
    for (const [pid, q] of Object.entries(part)) {
      totals[pid] = (totals[pid] ?? 0) + q;
    }
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
