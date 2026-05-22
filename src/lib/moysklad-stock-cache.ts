import { MOYSKLAD_BASE, moyskladFetch } from "@/lib/moysklad";

const LOOKUP_STOCK_CACHE_TTL_MS = Math.max(
  30_000,
  parseInt(process.env.MOYSKLAD_LOOKUP_STOCK_CACHE_MS ?? "600000", 10) || 600_000
);

export type StockByStoreEntry = { name: string; stock: number; reserve?: number };

export type StockReportRow = {
  meta?: { href?: string };
  assortment?: { meta?: { href?: string } };
  stockByStore?: StockByStoreEntry[];
};

type StockCache = {
  at: number;
  rows: StockReportRow[];
  byProductId: Map<string, { stockByStore?: StockByStoreEntry[] }>;
};

let stockByStoreReportCache: StockCache | null = null;
let stockByStoreReportInFlight: Promise<StockCache> | null = null;

function extractProductIdFromHref(href?: string): string | null {
  const match = (href ?? "").match(/entity\/product\/([0-9a-zA-Z-]+)/i);
  return match?.[1] ?? null;
}

export function mergeStockByStoreEntries(entries: StockByStoreEntry[] = []): StockByStoreEntry[] {
  const byStore = new Map<string, StockByStoreEntry>();
  for (const entry of entries) {
    const name = (entry.name ?? "").trim();
    if (!name) continue;
    const prev = byStore.get(name);
    byStore.set(name, {
      name,
      stock: (prev?.stock ?? 0) + (entry.stock ?? 0),
      reserve: (prev?.reserve ?? 0) + (entry.reserve ?? 0),
    });
  }
  return [...byStore.values()];
}

function buildStockByProductIdMap(
  rows: StockReportRow[]
): Map<string, { stockByStore?: StockByStoreEntry[] }> {
  const map = new Map<string, { stockByStore?: StockByStoreEntry[] }>();
  for (const row of rows) {
    const productId = extractProductIdFromHref(row.assortment?.meta?.href ?? row.meta?.href);
    if (!productId) continue;
    const prev = map.get(productId)?.stockByStore ?? [];
    map.set(productId, {
      stockByStore: mergeStockByStoreEntries([...prev, ...(row.stockByStore ?? [])]),
    });
  }
  return map;
}

async function loadStockByStoreCache(): Promise<StockCache> {
  const limit = 1000;
  let offset = 0;
  let size = Number.POSITIVE_INFINITY;
  const rows: StockReportRow[] = [];

  while (offset < size) {
    const stockData = await moyskladFetch<{
      meta?: { size?: number; limit?: number; offset?: number };
      rows?: StockReportRow[];
    }>(`/report/stock/bystore?limit=${limit}&offset=${offset}`, { cache: "no-store" });
    if (!stockData.ok) {
      throw new Error(stockData.error || "Не удалось загрузить общий отчет остатков МойСклад");
    }

    const chunk = stockData.data.rows ?? [];
    rows.push(...chunk);

    const reportedSize = stockData.data.meta?.size;
    size = typeof reportedSize === "number" && reportedSize > 0 ? reportedSize : rows.length;
    if (chunk.length < limit) break;
    offset += limit;
  }

  return { at: Date.now(), rows, byProductId: buildStockByProductIdMap(rows) };
}

export async function refreshMoySkladStockCache(): Promise<StockReportRow[]> {
  if (stockByStoreReportInFlight) return (await stockByStoreReportInFlight).rows;
  stockByStoreReportInFlight = (async () => {
    try {
      const cache = await loadStockByStoreCache();
      stockByStoreReportCache = cache;
      return cache;
    } finally {
      stockByStoreReportInFlight = null;
    }
  })();
  return (await stockByStoreReportInFlight).rows;
}

export function startMoySkladStockWarmup(reason = "manual"): void {
  void refreshMoySkladStockCache().catch((error) => {
    console.warn(
      "[moysklad-stock-cache] warmup failed",
      reason,
      error instanceof Error ? error.message : String(error)
    );
  });
}

export async function getCachedStockByStoreRows(): Promise<StockReportRow[]> {
  if (stockByStoreReportInFlight) return (await stockByStoreReportInFlight).rows;
  if (stockByStoreReportCache && Date.now() - stockByStoreReportCache.at <= LOOKUP_STOCK_CACHE_TTL_MS) {
    return stockByStoreReportCache.rows;
  }
  return refreshMoySkladStockCache();
}

export async function getCachedStockByProductIdMap(): Promise<Map<string, { stockByStore?: StockByStoreEntry[] }>> {
  if (stockByStoreReportInFlight) return (await stockByStoreReportInFlight).byProductId;
  if (stockByStoreReportCache && Date.now() - stockByStoreReportCache.at <= LOOKUP_STOCK_CACHE_TTL_MS) {
    return stockByStoreReportCache.byProductId;
  }
  await refreshMoySkladStockCache();
  return stockByStoreReportCache?.byProductId ?? new Map();
}

export async function getDirectStockByProductId(productId: string): Promise<StockByStoreEntry[]> {
  const productHref = `${MOYSKLAD_BASE}/entity/product/${productId}`;
  const stock = await moyskladFetch<{ rows?: StockReportRow[] }>(
    `/report/stock/bystore?filter=${encodeURIComponent(`product=${productHref}`)}&limit=100`,
    { cache: "no-store" }
  );
  if (!stock.ok) return [];
  return mergeStockByStoreEntries((stock.data.rows ?? []).flatMap((row) => row.stockByStore ?? []));
}
