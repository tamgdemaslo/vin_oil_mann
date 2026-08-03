import { prisma } from "@/lib/db";
import { getScopedBranchId } from "@/lib/request-tenant-store";

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

type BranchStockCache = {
  cache: StockCache | null;
  inFlight: Promise<StockCache> | null;
};

const stockCacheByBranch = new Map<string, BranchStockCache>();

function getBranchStockCache(branchId = getScopedBranchId()): BranchStockCache {
  const existing = stockCacheByBranch.get(branchId);
  if (existing) return existing;
  const created = { cache: null, inFlight: null };
  stockCacheByBranch.set(branchId, created);
  return created;
}

function extractProductIdFromHref(href?: string): string | null {
  const source = (href ?? "").split("?", 1)[0].replace(/\/$/, "");
  const match = source.match(/(?:entity\/product|local:\/\/product)\/([0-9a-zA-Z-]+)/i);
  if (match?.[1]) return match[1];
  const parts = source.split("/").filter(Boolean);
  return parts.at(-1) ?? null;
}

function decimalToNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object" && "toNumber" in value && typeof value.toNumber === "function") {
    const n = value.toNumber();
    return typeof n === "number" && Number.isFinite(n) ? n : 0;
  }
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function productMetaHref(product: { id: string; moyskladHref: string | null }) {
  return product.moyskladHref ?? `local://product/${product.id}`;
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
  const balances = await prisma.localStockBalance.findMany({
    include: {
      product: { select: { id: true, moyskladHref: true } },
      store: { select: { name: true } },
    },
    orderBy: [{ productId: "asc" }],
  });

  const byProduct = new Map<string, StockByStoreEntry[]>();
  for (const balance of balances) {
    const entries = byProduct.get(balance.productId) ?? [];
    entries.push({
      name: balance.store.name,
      stock: decimalToNumber(balance.quantity),
      reserve: decimalToNumber(balance.reserve),
    });
    byProduct.set(balance.productId, entries);
  }

  const rows: StockReportRow[] = [];
  const productHrefById = new Map(balances.map((balance) => [balance.productId, productMetaHref(balance.product)]));
  for (const [productId, entries] of byProduct) {
    const href = productHrefById.get(productId) ?? `local://product/${productId}`;
    rows.push({
      meta: { href },
      assortment: { meta: { href } },
      stockByStore: mergeStockByStoreEntries(entries),
    });
  }

  return { at: Date.now(), rows, byProductId: buildStockByProductIdMap(rows) };
}

export async function refreshMoySkladStockCache(): Promise<StockReportRow[]> {
  const branchId = getScopedBranchId();
  const state = getBranchStockCache(branchId);
  if (state.inFlight) return (await state.inFlight).rows;
  state.inFlight = (async () => {
    try {
      const cache = await loadStockByStoreCache();
      state.cache = cache;
      return cache;
    } finally {
      getBranchStockCache(branchId).inFlight = null;
    }
  })();
  return (await state.inFlight).rows;
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
  const state = getBranchStockCache();
  if (state.inFlight) return (await state.inFlight).rows;
  if (state.cache && Date.now() - state.cache.at <= LOOKUP_STOCK_CACHE_TTL_MS) {
    return state.cache.rows;
  }
  return refreshMoySkladStockCache();
}

export async function getCachedStockByProductIdMap(): Promise<Map<string, { stockByStore?: StockByStoreEntry[] }>> {
  const state = getBranchStockCache();
  if (state.inFlight) return (await state.inFlight).byProductId;
  if (state.cache && Date.now() - state.cache.at <= LOOKUP_STOCK_CACHE_TTL_MS) {
    return state.cache.byProductId;
  }
  await refreshMoySkladStockCache();
  return state.cache?.byProductId ?? new Map();
}

export async function getDirectStockByProductId(productId: string): Promise<StockByStoreEntry[]> {
  const product = await prisma.localProduct.findFirst({
    where: { OR: [{ id: productId }, { moyskladId: productId }] },
    include: { stockBalances: { include: { store: { select: { name: true } } } } },
  });
  if (!product) return [];
  return mergeStockByStoreEntries(
    product.stockBalances.map((balance) => ({
      name: balance.store.name,
      stock: decimalToNumber(balance.quantity),
      reserve: decimalToNumber(balance.reserve),
    }))
  );
}
