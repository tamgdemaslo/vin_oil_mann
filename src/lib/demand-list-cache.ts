import { loadLocalDemandList } from "@/lib/local-inventory-read";

type DemandRow = {
  id: string;
  name: string;
  moment: string;
  applicable: boolean;
  sum: number;
  description?: string;
  agent?: { name?: string };
  organization?: { name?: string };
  store?: { name?: string };
  meta?: { href?: string };
  attributes?: { id?: string; name?: string; value?: unknown }[];
};

type DemandListData = {
  meta: { size: number; limit: number; offset: number };
  rows: DemandRow[];
};

type DemandListParams = {
  branchId: string;
  search?: string;
  limit?: number;
  offset?: number;
};

type CacheEntry = {
  data: DemandListData;
  createdAt: number;
};

const demandListCache = new Map<string, CacheEntry>();

function cacheKey(params: Required<DemandListParams>): string {
  return JSON.stringify(params);
}

function normalizeParams(params: DemandListParams): Required<DemandListParams> {
  return {
    branchId: params.branchId,
    search: params.search?.trim() ?? "",
    limit: Math.min(100, Math.max(1, params.limit ?? 50)),
    offset: Math.max(0, params.offset ?? 0),
  };
}

export function invalidateDemandListCache() {
  demandListCache.clear();
}

export async function loadCachedDemandList(
  params: DemandListParams
): Promise<{ ok: true; data: DemandListData; cacheHit: boolean } | { ok: false; error: string }> {
  const normalized = normalizeParams(params);
  const key = cacheKey(normalized);
  const cached = demandListCache.get(key);
  if (cached) return { ok: true, data: cached.data, cacheHit: true };

  try {
    const data = await loadLocalDemandList(normalized);
    demandListCache.set(key, { data, createdAt: Date.now() });
    return { ok: true, data, cacheHit: false };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Не удалось загрузить локальные отгрузки",
    };
  }
}
