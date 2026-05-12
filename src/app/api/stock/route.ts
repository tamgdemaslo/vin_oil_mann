import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { moyskladFetch } from "@/lib/moysklad";
import { MOYSKLAD_BASE } from "@/lib/moysklad";

type StoreStock = { name: string; stock: number; reserve?: number };
type StockRow = {
  meta?: { href?: string };
  assortment?: { meta?: { href?: string } };
  stockByStore?: StoreStock[];
};

/** Строка отчёта остатков по ячейкам: номенклатура + ячейки с остатками. */
type BySlotRow = {
  meta?: { href?: string };
  assortment?: { meta?: { href?: string } };
  stockBySlot?: { slot?: { name?: string }; stock?: number }[];
};

const STOCK_ROUTE_CACHE_TTL_MS = Math.max(5_000, parseInt(process.env.STOCK_REPORT_CACHE_MS ?? "30000", 10) || 30_000);
let byStoreCache: { at: number; rows: StockRow[] } | null = null;
let byStoreInFlight: Promise<StockRow[]> | null = null;
const bySlotCache = new Map<string, { at: number; rows: BySlotRow[] }>();
const bySlotInFlight = new Map<string, Promise<BySlotRow[]>>();

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

export type StockByAssortmentItem = {
  quantity: number;
  reserve?: number;
  available?: number;
  slotName?: string;
};

/** GET /api/stock?storeName=...&storeId=...&assortmentHrefs=... — остатки по складу (остаток, резерв, доступно, ячейка). */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  }
  const storeName = (request.nextUrl.searchParams.get("storeName") ?? "").trim();
  const storeId = (request.nextUrl.searchParams.get("storeId") ?? "").trim();
  const assortmentHrefsParam = request.nextUrl.searchParams.get("assortmentHrefs") ?? "";
  const assortmentHrefs = assortmentHrefsParam
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!storeName || assortmentHrefs.length === 0) {
    return NextResponse.json({ stockByAssortment: {} });
  }

  const rows = await getCachedByStoreRows();
  const storeNameLower = storeName.toLowerCase();

  /** Нормализуем href до пути (entity/product/id или entity/variant/id) для сопоставления. */
  const toPath = (h: string): string => {
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
  };

  const wantByPath = new Map<string, string>();
  const stockByAssortment: Record<string, StockByAssortmentItem> = {};
  for (const href of assortmentHrefs) {
    if (!href) continue;
    const path = toPath(href);
    wantByPath.set(path, href);
    wantByPath.set(href, href);
    stockByAssortment[href] = { quantity: 0, reserve: 0, available: 0 };
  }

  for (const row of rows) {
    const rawHref = (row.assortment?.meta?.href ?? row.meta?.href ?? "").trim();
    if (!rawHref) continue;
    const path = toPath(rawHref);
    const href = wantByPath.get(path) ?? wantByPath.get(rawHref) ?? rawHref;
    const stores = row.stockByStore ?? [];
    const forStore = stores.find((s) => (s.name ?? "").toLowerCase() === storeNameLower);
    const stock = forStore?.stock ?? 0;
    const reserve = (forStore as { reserve?: number })?.reserve ?? 0;
    stockByAssortment[href] = {
      quantity: stock,
      reserve,
      available: Math.max(0, stock - reserve),
    };
  }

  if (storeId) {
    const storeHref = `${MOYSKLAD_BASE}/entity/store/${storeId}`;
    const bySlotRows = await getCachedBySlotRows(storeHref);
    if (Array.isArray(bySlotRows)) {
      for (const row of bySlotRows) {
        const rawHref = (row.assortment?.meta?.href ?? row.meta?.href ?? "").trim();
        if (!rawHref) continue;
        const path = toPath(rawHref);
        const href = wantByPath.get(path) ?? wantByPath.get(rawHref);
        if (!href || !stockByAssortment[href]) continue;
        const bySlot = row.stockBySlot ?? [];
        const firstWithStock = bySlot.find((s) => (s.stock ?? 0) > 0 && (s.slot?.name ?? "").trim());
        const slotName = firstWithStock?.slot?.name?.trim();
        if (slotName) stockByAssortment[href].slotName = slotName;
      }
    }
  }

  return NextResponse.json({ stockByAssortment });
}
