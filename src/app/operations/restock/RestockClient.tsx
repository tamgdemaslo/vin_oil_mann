"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FilePlus2,
  Loader2,
  PackageCheck,
  PackageSearch,
  RefreshCw,
  Search,
  Settings2,
  ShoppingCart,
  Trash2,
  Truck,
  X,
} from "lucide-react";
import { EcoBadge, EcoButton, EcoInput, EcoKpi } from "@/components/platform/EcoUI";

type RestockItem = {
  productId: string;
  name: string | null;
  code: string | null;
  group: string | null;
  supplier: string | null;
  minimumBalance: number | null;
  stock: number;
  reserve?: number;
  inTransit?: number;
  shortage?: number;
  spentInPeriod?: number;
};

type Mode = "below_min" | "outflow";
type RosskoStock = {
  id: string;
  count: string | number;
  price: string | number;
  delivery: string | number;
  city: string;
  canTake: string;
};
type RosskoOffer = {
  partnumber: string;
  brand: string;
  name: string;
  stocks: RosskoStock[];
};
type RosskoSearchState = {
  open?: boolean;
  loading?: boolean;
  error?: string;
  status?: string;
  results?: RosskoOffer[];
  checkedAt?: number;
};
type RosskoCartLine = {
  partnumber: string;
  brand: string;
  stock: string;
  count: number;
  title: string;
  code: string;
  productId: string;
  price: number | null;
  delivery: string;
  available: number | null;
  city: string;
  offerName: string;
};
type RosskoHealth = {
  status: "checking" | "ok" | "error";
  checkedAt?: number;
  error?: string;
};
type RosskoBulkState = {
  active: boolean;
  current: number;
  total: number;
};

const LS_QTY = "vin-oil-restock-qty";
const LS_EXC = "vin-oil-restock-excluded";
const LS_ROSSKO_CART = "vin-oil-restock-rossko-cart";
const LS_ROSSKO_CACHE = "vin-oil-restock-rossko-search-cache";
const LS_ROSSKO_OFFER_QTY = "vin-oil-restock-rossko-offer-qty";
const ROSSKO_SUPPLIER_FIXED = 'ООО "ГРИНЛАЙТ"';
const DEFAULT_RSSK_CONTACT_NAME = "ИП Елисеенко Илья Сергеевич";
const DEFAULT_RSSK_CONTACT_PHONE = "+79058677833";

function loadJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function saveJson(key: string, val: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch {
    /* ignore */
  }
}

function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString("ru-RU", { maximumFractionDigits: 3 });
}

function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtTime(ts: number | undefined): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function defaultQty(it: RestockItem): number {
  const s = it.shortage;
  if (s !== undefined && s !== null && Number.isFinite(s)) return Math.max(1, Math.ceil(s));
  return 1;
}

function supplierName(it: RestockItem): string {
  return (it.supplier && String(it.supplier).trim()) || "Без поставщика";
}

function isRosskoItem(it: RestockItem): boolean {
  return supplierName(it) === ROSSKO_SUPPLIER_FIXED;
}

function toNum(x: unknown): number | null {
  const v = Number(String(x ?? "").replace(",", "."));
  return Number.isFinite(v) ? v : null;
}

function stockCount(stock: RosskoStock): number | null {
  return toNum(stock.count);
}

function stockPrice(stock: RosskoStock): number | null {
  return toNum(stock.price);
}

function deliveryRank(stock: RosskoStock): number {
  const raw = String(stock.delivery ?? "").toLowerCase().trim();
  if (!raw || raw === "—") return Number.MAX_SAFE_INTEGER;
  if (raw.includes("сегодня")) return 0;
  if (raw.includes("завтра")) return 1;
  const num = toNum(raw.replace(/[^\d,.]+/g, " "));
  if (num !== null) return num;
  return Number.MAX_SAFE_INTEGER - 1;
}

function deliveryLabel(stock: RosskoStock): string {
  const raw = String(stock.delivery ?? "").trim();
  if (!raw || raw === "—") return "уточняется";
  const rank = deliveryRank(stock);
  if (rank === 0 && /^\d+$/.test(raw)) return "сегодня";
  if (rank === 1 && /^\d+$/.test(raw)) return "завтра";
  return raw;
}

function offerStockKey(productId: string, offer: Pick<RosskoOffer, "brand" | "partnumber">, stock: Pick<RosskoStock, "id">): string {
  return `${productId}||${offer.brand}||${offer.partnumber}||${stock.id}`;
}

function friendlyRosskoError(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error ?? "");
  if (/text должен/i.test(msg)) return "Не задан поисковый запрос";
  if (/delivery|address|payment|key|не задан|не заданы/i.test(msg)) return "ROSSKO недоступен: проверьте настройки подключения";
  return "Не удалось получить предложения ROSSKO";
}

function normSkuBlob(s: unknown): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}

function extractLikelyBrandForRosskoQuery(nameStr: unknown): string {
  const s = String(nameStr || "");
  const skip = new Set(["FILTER", "THE", "AND", "FOR", "OIL", "TYPE", "CODE", "ART", "SKU", "PART", "TOP", "LOW", "SET", "KIT", "NEW", "ALL"]);
  const caps = s.match(/\b([A-Z]{3,})\b/g);
  if (caps) {
    for (const w of caps) {
      if (!skip.has(w)) return w;
    }
  }
  const titleCase = s.match(/\b([A-Z][a-z]{2,})\b/g);
  if (titleCase) {
    for (const w of titleCase) {
      if (!skip.has(w.toUpperCase())) return w;
    }
  }
  return "";
}

function skuNameHintsForFilter(nameText: unknown): string[] {
  const raw = String(nameText || "").trim();
  if (!raw) return [];
  const split = raw
    .replace(/[,;|]+/g, " ")
    .replace(/[()]+/g, " ")
    .replace(/[–—]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const skip = new Set([
    "моторное",
    "масло",
    "масла",
    "масляный",
    "масляного",
    "синтетическое",
    "синтет",
    "полусинтетическое",
    "полусинт",
    "фильтр",
    "фильтра",
    "фильтром",
    "воздушный",
    "воздушного",
    "топливный",
    "топливного",
    "салонный",
    "салонного",
    "комплект",
    "для",
    "оригинал",
    "oem",
    "номер",
    "арт",
    "артикул",
    "код",
    "шт",
    "уп",
    "литр",
    "л",
    "ml",
    "filter",
  ]);
  const out: string[] = [];
  for (const p of split) {
    const t = normSkuBlob(p.replace(/^[#\-–—\[(]+/, "").replace(/[,.\])]+$/, "").replace(/\s+/g, ""));
    if (t.length < 3) continue;
    if (/^\d+$/.test(t)) continue;
    if (/^\d+[wм]\s*-\s*\d+/i.test(t) || /\d+w[-\s]?\d+/i.test(t)) continue;
    if (skip.has(t)) continue;
    out.push(t);
    if (out.length >= 5) break;
  }
  return out;
}

function pickQueryFor(it: RestockItem): string {
  const code = String(it.code ?? "").trim();
  const name = String(it.name ?? "");
  if (!code) return name.trim();
  const brandTok = extractLikelyBrandForRosskoQuery(name);
  if (brandTok) return `${brandTok} ${code}`.trim();
  const head = skuNameHintsForFilter(name)[0];
  if (head && head.length >= 3) return `${head} ${code}`.trim();
  return code;
}

function normalizeSearchResult(payload: unknown): RosskoOffer[] {
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const partsContainer = p.PartsList ?? p.partslist ?? p.parts ?? [];
  const partValue =
    partsContainer && typeof partsContainer === "object" && !Array.isArray(partsContainer)
      ? ((partsContainer as Record<string, unknown>).Part ?? (partsContainer as Record<string, unknown>).part ?? partsContainer)
      : partsContainer;
  const parts = Array.isArray(partValue) ? partValue : partValue ? [partValue] : [];
  const out: RosskoOffer[] = [];
  for (const pitRaw of parts.slice(0, 80)) {
    if (!pitRaw || typeof pitRaw !== "object") continue;
    const pit = pitRaw as Record<string, unknown>;
    const partnumber = String(pit.partnumber ?? pit.PartNumber ?? "").trim();
    const brand = String(pit.brand ?? pit.Brand ?? "").trim();
    const name = String(pit.name ?? pit.Name ?? "");
    const stocksContainer = pit.stocks ?? pit.StocksList ?? pit.stocksList ?? [];
    const stockValue =
      stocksContainer && typeof stocksContainer === "object" && !Array.isArray(stocksContainer)
        ? ((stocksContainer as Record<string, unknown>).stock ?? (stocksContainer as Record<string, unknown>).Stock ?? stocksContainer)
        : stocksContainer;
    const stocksRaw = Array.isArray(stockValue) ? stockValue : stockValue ? [stockValue] : [];
    const stocks: RosskoStock[] = [];
    for (const sRaw of stocksRaw) {
      if (!sRaw || typeof sRaw !== "object") continue;
      const s = sRaw as Record<string, unknown>;
      const id = String(s.id ?? s.StockID ?? "").trim();
      const count = toNum(s.count ?? s.Count);
      if (!id) continue;
      if (count !== null && count <= 0) continue;
      stocks.push({
        id,
        count: (s.count ?? s.Count ?? "—") as string | number,
        price: (s.price ?? s.Price ?? "—") as string | number,
        delivery: (s.delivery ?? s.DeliveryTime ?? "—") as string | number,
        city: String(s.city ?? s.City ?? ""),
        canTake: String(s.deliveryEnd ?? s.DeliveryEnd ?? s.deliveryStart ?? s.DeliveryStart ?? ""),
      });
    }
    if (!partnumber || !brand || !stocks.length) continue;
    out.push({ partnumber, brand, name, stocks });
  }
  return out;
}

function finalizeRosskoOffers(offers: RosskoOffer[], it: RestockItem): RosskoOffer[] {
  const tokens = skuNameHintsForFilter(it.name ?? "");
  if (!tokens.length) return offers.slice(0, 24);
  const filtered = offers.filter((o) => {
    const brand = normSkuBlob(o.brand);
    const title = normSkuBlob(o.name);
    return tokens.some((t) => brand.includes(t) || title.includes(t));
  });
  return (filtered.length ? filtered : offers).slice(0, 24);
}

function normalizeRosskoCart(lines: RosskoCartLine[]): RosskoCartLine[] {
  return lines
    .filter((line) => line && line.partnumber && line.brand && line.stock && line.productId)
    .map((line) => ({
      ...line,
      count: Math.max(1, Math.floor(Number(line.count || 1))),
      price: typeof line.price === "number" && Number.isFinite(line.price) ? line.price : null,
      delivery: line.delivery || "уточняется",
      available: typeof line.available === "number" && Number.isFinite(line.available) ? line.available : null,
      city: line.city || "",
      offerName: line.offerName || `${line.brand} ${line.partnumber}`,
    }));
}

function cartKey(line: Pick<RosskoCartLine, "productId" | "partnumber" | "brand" | "stock">): string {
  return `${line.productId}||${line.brand}||${line.partnumber}||${line.stock}`;
}

export default function RestockClient() {
  const [mode, setMode] = useState<Mode>("below_min");
  const [items, setItems] = useState<RestockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<{
    dateLabel?: string;
    note?: string;
    fetchedRows?: number;
    catalogSize?: number;
  }>({});

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [outflowLoaded, setOutflowLoaded] = useState(false);

  const [selected, setSelected] = useState<string>("ROSSKO");
  const [qtyByProduct, setQtyByProduct] = useState<Record<string, number>>({});
  const [excluded, setExcluded] = useState<Record<string, boolean>>({});
  const [messageText, setMessageText] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [rosskoState, setRosskoState] = useState<Record<string, RosskoSearchState>>({});
  const [rosskoCart, setRosskoCart] = useState<RosskoCartLine[]>([]);
  const [rosskoOfferQty, setRosskoOfferQty] = useState<Record<string, number>>({});
  const [rosskoAddState, setRosskoAddState] = useState<Record<string, "loading" | "success" | "error">>({});
  const [rosskoHealth, setRosskoHealth] = useState<RosskoHealth>({ status: "checking" });
  const [rosskoBulk, setRosskoBulk] = useState<RosskoBulkState>({ active: false, current: 0, total: 0 });
  const [rosskoManualQuery, setRosskoManualQuery] = useState<Record<string, string>>({});
  const [toast, setToast] = useState("");
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [receiptDraftBusy, setReceiptDraftBusy] = useState(false);

  useEffect(() => {
    setQtyByProduct(loadJson<Record<string, number>>(LS_QTY, {}));
    setExcluded(loadJson<Record<string, boolean>>(LS_EXC, {}));
    setRosskoCart(normalizeRosskoCart(loadJson<RosskoCartLine[]>(LS_ROSSKO_CART, [])));
    setRosskoOfferQty(loadJson<Record<string, number>>(LS_ROSSKO_OFFER_QTY, {}));
  }, []);

  const persistQty = useCallback((next: Record<string, number>) => {
    setQtyByProduct(next);
    saveJson(LS_QTY, next);
  }, []);

  const persistExcluded = useCallback((next: Record<string, boolean>) => {
    setExcluded(next);
    saveJson(LS_EXC, next);
  }, []);

  const persistRosskoCart = useCallback((next: RosskoCartLine[]) => {
    const normalized = normalizeRosskoCart(next);
    setRosskoCart(normalized);
    saveJson(LS_ROSSKO_CART, normalized);
  }, []);

  const persistRosskoOfferQty = useCallback((next: Record<string, number>) => {
    setRosskoOfferQty(next);
    saveJson(LS_ROSSKO_OFFER_QTY, next);
  }, []);

  const showToast = useCallback((text: string) => {
    setToast(text);
    window.setTimeout(() => setToast(""), 2800);
  }, []);

  const checkRosskoApi = useCallback(async () => {
    setRosskoHealth((prev) => ({ ...prev, status: "checking", error: undefined }));
    try {
      const res = await fetch("/api/rossko/checkout-details", { headers: { Accept: "application/json" }, cache: "no-store" });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      setRosskoHealth({ status: "ok", checkedAt: Date.now() });
    } catch (e) {
      console.warn("ROSSKO health-check failed", e);
      setRosskoHealth({ status: "error", checkedAt: Date.now(), error: friendlyRosskoError(e) });
    }
  }, []);

  const loadBelowMin = useCallback(async (refresh: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const u = new URL("/api/local-inventory/restock", window.location.origin);
      u.searchParams.set("mode", "below_min");
      if (refresh) u.searchParams.set("refresh", "1");
      const res = await fetch(u.toString());
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ошибка загрузки");
      setItems(data.items ?? []);
      setMeta({
        fetchedRows: data.fetchedRows,
        catalogSize: data.catalogSize,
        note: data.note,
      });
      setOutflowLoaded(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadOutflow = useCallback(async (refresh: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const u = new URL("/api/local-inventory/restock", window.location.origin);
      u.searchParams.set("mode", "outflow");
      if (refresh) u.searchParams.set("refresh", "1");
      if (dateFrom && dateTo) {
        u.searchParams.set("date_from", dateFrom);
        u.searchParams.set("date_to", dateTo);
      }
      const res = await fetch(u.toString());
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ошибка загрузки");
      setItems(data.items ?? []);
      setMeta({
        dateLabel: data.dateLabel,
        note: data.note,
        fetchedRows: data.fetchedRows,
        catalogSize: data.catalogSize,
      });
      setOutflowLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo]);

  const loadOutflowRef = useRef(loadOutflow);
  loadOutflowRef.current = loadOutflow;

  useEffect(() => {
    if (mode === "below_min") void loadBelowMin(false);
    else void loadOutflowRef.current(false);
  }, [mode, loadBelowMin]);

  useEffect(() => {
    if (selected === "ROSSKO" && !rosskoHealth.checkedAt) void checkRosskoApi();
  }, [checkRosskoApi, rosskoHealth.checkedAt, selected]);

  const suppliers = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) {
      if (isRosskoItem(it)) continue;
      const s = supplierName(it);
      set.add(s);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ru"));
  }, [items]);

  const filteredItems = useMemo(() => {
    if (selected === "ROSSKO") return items.filter(isRosskoItem);
    return items.filter((it) => {
      return supplierName(it) === selected;
    });
  }, [items, selected]);

  const grouped = useMemo(() => {
    const map = new Map<string, RestockItem[]>();
    for (const it of filteredItems) {
      const g = (it.group && String(it.group).trim()) || "Без группы";
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(it);
    }
    const pairs = Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0], "ru"));
    for (const [, arr] of pairs) {
      arr.sort((a, b) => {
        const ds = (b.shortage ?? 0) - (a.shortage ?? 0);
        if (ds !== 0) return ds;
        return String(a.name ?? "").localeCompare(String(b.name ?? ""), "ru");
      });
    }
    return pairs;
  }, [filteredItems]);

  const rosskoCartTotal = useMemo(
    () => rosskoCart.reduce((sum, x) => sum + Math.max(0, Number(x.count || 0)), 0),
    [rosskoCart]
  );
  const rosskoCartSum = useMemo(
    () => rosskoCart.reduce((sum, x) => sum + Math.max(0, Number(x.count || 0)) * Math.max(0, Number(x.price || 0)), 0),
    [rosskoCart]
  );
  const cartQtyByProduct = useMemo(() => {
    const map = new Map<string, number>();
    for (const line of rosskoCart) {
      map.set(line.productId, (map.get(line.productId) ?? 0) + Math.max(0, Number(line.count || 0)));
    }
    return map;
  }, [rosskoCart]);
  const cartQtyByOffer = useMemo(() => {
    const map = new Map<string, number>();
    for (const line of rosskoCart) {
      map.set(cartKey(line), (map.get(cartKey(line)) ?? 0) + Math.max(0, Number(line.count || 0)));
    }
    return map;
  }, [rosskoCart]);
  const restockStats = useMemo(
    () => ({
      all: items.length,
      shown: filteredItems.length,
      shortage: filteredItems.reduce((sum, item) => sum + Math.max(0, Number(item.shortage ?? 0)), 0),
      suppliers: suppliers.length + (items.some(isRosskoItem) ? 1 : 0),
      excluded: filteredItems.filter((item) => excluded[item.productId]).length,
    }),
    [excluded, filteredItems, items, suppliers.length]
  );

  function ensureQty(pid: string, it: RestockItem): number {
    const q = qtyByProduct[pid];
    if (typeof q === "number" && q > 0) return Math.floor(q);
    return defaultQty(it);
  }

  function setQty(pid: string, it: RestockItem, value: number) {
    const v = Math.max(0, Math.floor(value));
    persistQty({ ...qtyByProduct, [pid]: v > 0 ? v : defaultQty(it) });
  }

  function toggleExcluded(pid: string) {
    persistExcluded({ ...excluded, [pid]: !excluded[pid] });
  }

  function buildMessage() {
    if (selected === "ROSSKO") return;
    const lines: string[] = [];
    lines.push(`Заказ поставщику: ${selected}`);
    lines.push("");
    for (const it of filteredItems) {
      if (excluded[it.productId]) continue;
      const q = ensureQty(it.productId, it);
      if (q <= 0) continue;
      const code = it.code ? String(it.code) : "—";
      const name = it.name ? String(it.name) : "—";
      lines.push(`— ${code} / ${name} — ${q} шт. (остаток ${fmtNum(it.stock)}, мин. ${fmtNum(it.minimumBalance)})`);
    }
    const text = lines.join("\n");
    setMessageText(text);
  }

  async function copyMessage() {
    if (!messageText) return;
    try {
      await navigator.clipboard.writeText(messageText);
    } catch {
      /* ignore */
    }
  }

  async function rosskoSearch(pid: string, it: RestockItem, queryOverride?: string) {
    setRosskoState((prev) => ({
      ...prev,
      [pid]: { ...(prev[pid] ?? {}), open: true, loading: true, error: "", status: "loading" },
    }));
    try {
      const primary = (queryOverride?.trim() || pickQueryFor(it)).trim();
      if (primary.length < 2) throw new Error("text должен быть не короче 2 символов");
      const cache = loadJson<Record<string, { ts: number; raw: RosskoOffer[] }>>(LS_ROSSKO_CACHE, {});
      const cacheKey = `${pid}||${primary.toLowerCase()}`;
      let raw = cache[cacheKey]?.ts && Date.now() - cache[cacheKey].ts < 24 * 60 * 60 * 1000 ? cache[cacheKey].raw : null;

      async function fetchNormalized(text: string): Promise<RosskoOffer[]> {
        const u = new URL("/api/rossko/search", window.location.origin);
        u.searchParams.set("text", text);
        const res = await fetch(u.toString(), { headers: { Accept: "application/json" } });
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
        return normalizeSearchResult(data.data);
      }

      if (!raw) {
        raw = await fetchNormalized(primary);
        cache[cacheKey] = { ts: Date.now(), raw };
        saveJson(LS_ROSSKO_CACHE, cache);
      }

      let shown = finalizeRosskoOffers(raw, it);
      const codeOnly = String(it.code ?? "").trim();
      if (!shown.length && codeOnly && primary.toLowerCase() !== codeOnly.toLowerCase()) {
        raw = await fetchNormalized(codeOnly);
        shown = finalizeRosskoOffers(raw, it);
      }

      setRosskoState((prev) => ({
        ...prev,
        [pid]: {
          ...(prev[pid] ?? {}),
          open: true,
          loading: false,
          error: "",
          status: shown.length ? "found" : "not_found",
          results: shown,
          checkedAt: Date.now(),
        },
      }));
    } catch (e) {
      console.warn("ROSSKO search failed", e);
      setRosskoState((prev) => ({
        ...prev,
        [pid]: {
          ...(prev[pid] ?? {}),
          open: true,
          loading: false,
          status: "error",
          error: friendlyRosskoError(e),
          results: [],
          checkedAt: Date.now(),
        },
      }));
    }
  }

  function toggleRossko(pid: string, it: RestockItem) {
    const current = rosskoState[pid];
    const open = !current?.open;
    setRosskoState((prev) => ({ ...prev, [pid]: { ...(prev[pid] ?? {}), open } }));
    if (open && !current?.results && !current?.loading) void rosskoSearch(pid, it);
  }

  function setRosskoRowOpen(pid: string, open: boolean) {
    setRosskoState((prev) => ({ ...prev, [pid]: { ...(prev[pid] ?? {}), open } }));
  }

  async function bulkRosskoSearch() {
    const rows = filteredItems.filter((it) => !rosskoState[it.productId]?.loading);
    if (!rows.length || rosskoBulk.active) return;
    setRosskoBulk({ active: true, current: 0, total: rows.length });
    for (let index = 0; index < rows.length; index += 1) {
      const item = rows[index];
      setRosskoBulk({ active: true, current: index + 1, total: rows.length });
      await rosskoSearch(item.productId, item);
    }
    setRosskoBulk({ active: false, current: rows.length, total: rows.length });
  }

  function offerQty(key: string, it: RestockItem, stock: RosskoStock): number {
    const saved = rosskoOfferQty[key];
    const available = stockCount(stock);
    const wanted = defaultQty(it);
    const fallback = available !== null ? Math.min(wanted, Math.max(1, Math.floor(available))) : wanted;
    const qty = typeof saved === "number" && saved > 0 ? Math.floor(saved) : fallback;
    if (available !== null) return Math.min(Math.max(1, qty), Math.max(1, Math.floor(available)));
    return Math.max(1, qty);
  }

  function setOfferQtyValue(key: string, value: number) {
    const next = { ...rosskoOfferQty, [key]: Math.max(1, Math.floor(value || 1)) };
    persistRosskoOfferQty(next);
  }

  function addRosskoToCart(line: RosskoCartLine) {
    const key = cartKey(line);
    setRosskoAddState((prev) => ({ ...prev, [key]: "loading" }));
    const next = [...rosskoCart];
    const idx = next.findIndex((x) => cartKey(x) === cartKey(line));
    if (idx >= 0) {
      const maxAvailable = line.available ?? next[idx].available ?? null;
      const nextCount = Math.max(1, Number(next[idx].count || 1) + Number(line.count || 1));
      next[idx] = { ...next[idx], ...line, count: maxAvailable !== null ? Math.min(nextCount, maxAvailable) : nextCount };
    } else {
      next.push(line);
    }
    persistRosskoCart(next);
    setRosskoAddState((prev) => ({ ...prev, [key]: "success" }));
    showToast("Позиция добавлена в корзину ROSSKO");
  }

  function updateCartQty(idx: number, count: number) {
    const next = [...rosskoCart];
    if (!next[idx]) return;
    const available = next[idx].available;
    const safeCount = Math.max(1, Math.floor(count || 1));
    next[idx] = { ...next[idx], count: available !== null ? Math.min(safeCount, available) : safeCount };
    persistRosskoCart(next);
  }

  function replaceRosskoOffer(line: RosskoCartLine) {
    setCartOpen(false);
    setRosskoRowOpen(line.productId, true);
    const item = items.find((row) => row.productId === line.productId);
    const current = rosskoState[line.productId];
    if (item && !current?.results && !current?.loading) void rosskoSearch(line.productId, item);
  }

  async function createReceiptDraftFromRosskoCart() {
    const lines = rosskoCart
      .filter((line) => line.productId && Number(line.count) > 0)
      .map((line) => ({
        productId: line.productId,
        quantity: Math.max(1, Math.floor(Number(line.count || 1))),
        price: Number(line.price || 0),
        raw: {
          source: "ROSSKO",
          partnumber: line.partnumber,
          brand: line.brand,
          stock: line.stock,
          delivery: line.delivery,
        },
      }));
    if (!lines.length) return;
    setReceiptDraftBusy(true);
    try {
      const res = await fetch("/api/local-inventory/movements", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          type: "receipt",
          applicable: false,
          counterpartyId: `supplier:${encodeURIComponent(ROSSKO_SUPPLIER_FIXED)}`,
          documentDate: new Date().toISOString().slice(0, 10),
          description: "Черновик приёмки из корзины ROSSKO. Остатки не увеличены.",
          positions: lines,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error || !data.id) throw new Error(data.error || "Не удалось создать черновик приёмки");
      showToast("Черновик приёмки создан");
      window.location.href = `/inventory/receipts?document=${encodeURIComponent(data.id)}&open=edit`;
    } catch (e) {
      console.warn("ROSSKO receipt draft failed", e);
      showToast(e instanceof Error ? e.message : "Не удалось создать черновик приёмки");
    } finally {
      setReceiptDraftBusy(false);
    }
  }

  async function checkoutRosskoCart() {
    const lines = rosskoCart
      .map((x) => ({
        partnumber: x.partnumber,
        brand: x.brand,
        stock: x.stock,
        count: Math.max(1, Math.floor(Number(x.count || 1))),
        comment: String(x.code || "").slice(0, 50),
        productId: x.productId,
      }))
      .filter((x) => x.partnumber && x.brand && x.stock && x.count > 0);
    if (!lines.length) return;

    setCheckoutBusy(true);
    try {
      const res = await fetch("/api/rossko/order", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          comment: `Заказ из Пополнение остатков (${new Date().toISOString().slice(0, 10)})`,
          contact_name: DEFAULT_RSSK_CONTACT_NAME,
          contact_phone: DEFAULT_RSSK_CONTACT_PHONE,
          parts: lines,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      const resp = (data.data ?? {}) as Record<string, unknown>;
      let orderId = String(resp.OrderID ?? "");
      const orderIds = resp.OrderIDS as { id?: unknown } | unknown[] | undefined;
      if (!orderId && orderIds) {
        if (Array.isArray(orderIds) && orderIds.length) orderId = String(orderIds[0]);
        else if (typeof orderIds === "object" && "id" in orderIds && Array.isArray(orderIds.id) && orderIds.id.length) {
          orderId = String(orderIds.id[0]);
        }
      }
      persistRosskoCart([]);
      setCartOpen(false);
      showToast(`Заказ ROSSKO сформирован${orderId ? ` #${orderId}` : ""}`);
    } catch (e) {
      console.warn("ROSSKO checkout failed", e);
      showToast("Не удалось сформировать заказ ROSSKO");
    } finally {
      setCheckoutBusy(false);
    }
  }

  return (
    <div className="eco-restock-page">
      <section className="eco-page-head eco-restock-head">
        <div>
          <div className="eco-page-crumbs">
            <Link href="/">Главная</Link>
            <span className="sep">/</span>
            <span>Склад</span>
            <span className="sep">/</span>
            <span className="cur">Пополнение</span>
          </div>
          <div className="eco-title-row">
            <h1 className="eco-page-title">Пополнение остатков</h1>
            <EcoBadge tone="rust">{mode === "below_min" ? "ниже минимума" : "расход за период"}</EcoBadge>
            <EcoBadge tone="success" dot>
              {selected}
            </EcoBadge>
          </div>
          <p className="eco-page-subtitle">
            Товары с остатком ниже неснижаемого по локальной БД. Поставщик берётся из карточки товара.
          </p>
        </div>
        <div className="eco-page-actions">
          <div className="eco-seg">
            <button
              type="button"
              onClick={() => setMode("below_min")}
              className={`eco-seg-btn ${mode === "below_min" ? "is-active" : ""}`}
            >
              Ниже минимума
            </button>
            <button
              type="button"
              onClick={() => setMode("outflow")}
              className={`eco-seg-btn ${mode === "outflow" ? "is-active" : ""}`}
            >
              С расходом
            </button>
          </div>
          {mode === "below_min" && (
            <EcoButton type="button" onClick={() => void loadBelowMin(true)} disabled={loading}>
              <RefreshCw size={15} />
              Обновить
            </EcoButton>
          )}
          <EcoButton type="button" variant="primary" onClick={() => setCartOpen(true)}>
            <ShoppingCart size={15} />
            Корзина ({rosskoCartTotal})
          </EcoButton>
        </div>
      </section>

      <div className="eco-grid eco-grid--kpi eco-restock-metrics">
        <EcoKpi label="Всего позиций" value={restockStats.all} tone="info" />
        <EcoKpi label="Показано" value={restockStats.shown} sub={`${restockStats.excluded} исключено`} tone="neutral" />
        <EcoKpi label="Дефицит" value={fmtNum(restockStats.shortage)} tone="warning" />
        <EcoKpi label="Поставщики" value={restockStats.suppliers} tone="success" />
      </div>

      <div className="eco-restock-layout">
      <aside className="lg:w-64 lg:shrink-0">
        <div className="eco-filter-rail eco-restock-rail">
          <div className="eco-filter-title">
            Поставщики
          </div>
          <div className="mt-3 flex flex-col gap-1">
            <button
              type="button"
              onClick={() => setSelected("ROSSKO")}
              className={`rounded-xl px-3 py-2 text-left text-sm font-medium transition ${
                selected === "ROSSKO"
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950"
                  : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
              }`}
            >
              ROSSKO
            </button>
            {suppliers.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSelected(s)}
                className={`rounded-xl px-3 py-2 text-left text-sm transition ${
                  selected === s
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950"
                    : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-2 border-t border-zinc-100 pt-4 dark:border-zinc-800">
            <EcoButton
              type="button"
              onClick={() => setSettingsOpen(true)}
              size="sm"
            >
              <Settings2 size={14} />
              О данных
            </EcoButton>
          </div>
        </div>
      </aside>

      <section className="eco-restock-main">
        <div className="eco-table-toolbar eco-restock-toolbar">
          <span className="l-meta">
            {selected} · {restockStats.shown} позиций · дефицит {fmtNum(restockStats.shortage)}
          </span>
          <div className="grow" />
          <div className="flex flex-wrap gap-2">
            {mode === "below_min" && (
              <EcoButton
                type="button"
                onClick={() => void loadBelowMin(true)}
                disabled={loading}
                size="sm"
              >
                <RefreshCw size={14} />
                Обновить
              </EcoButton>
            )}
            {selected === "ROSSKO" && rosskoCartTotal > 0 && (
              <EcoBadge tone="success">ROSSKO: {rosskoCartTotal}</EcoBadge>
            )}
          </div>
        </div>

        {mode === "outflow" && (
          <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-zinc-200 bg-zinc-50/80 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
            <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
              С даты
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
              По дату
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              />
            </label>
            <EcoButton
              type="button"
              onClick={() => void loadOutflow(true)}
              disabled={loading}
              variant="primary"
            >
              <Truck size={15} />
              Загрузить
            </EcoButton>
            {outflowLoaded && meta.dateLabel && (
              <span className="text-sm text-zinc-600 dark:text-zinc-400">
                Период: <span className="font-medium text-zinc-900 dark:text-zinc-100">{meta.dateLabel}</span>
              </span>
            )}
          </div>
        )}

        {meta.fetchedRows !== undefined && (
          <p className="text-xs text-zinc-500 dark:text-zinc-500">
            Товаров проверено: {meta.fetchedRows}, позиций в каталоге: {meta.catalogSize ?? "—"}.
            {meta.note && <span className="ml-1">{meta.note}</span>}
          </p>
        )}

        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
            {error}
          </div>
        )}

        {loading && (
          <div className="rounded-2xl border border-zinc-200 bg-white px-6 py-12 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
            Загрузка данных из локальной БД…
          </div>
        )}

        {!loading && selected === "ROSSKO" && (
          <div className="space-y-4">
            <RosskoStatusPanel
              health={rosskoHealth}
              bulk={rosskoBulk}
              disabled={!filteredItems.length || rosskoBulk.active || rosskoHealth.status === "error"}
              onRetry={() => void checkRosskoApi()}
              onBulk={() => void bulkRosskoSearch()}
            />
            <RosskoItemsTable
              grouped={grouped}
              showSpend={mode === "outflow" && outflowLoaded}
              ensureQty={ensureQty}
              rosskoState={rosskoState}
              cartQtyByProduct={cartQtyByProduct}
              cartQtyByOffer={cartQtyByOffer}
              offerQty={offerQty}
              setOfferQty={setOfferQtyValue}
              addState={rosskoAddState}
              manualQuery={rosskoManualQuery}
              setManualQuery={(pid, value) => setRosskoManualQuery((prev) => ({ ...prev, [pid]: value }))}
              toggleRossko={toggleRossko}
              refreshRossko={(pid, it, query) => void rosskoSearch(pid, it, query)}
              addToCart={addRosskoToCart}
              apiUnavailable={rosskoHealth.status === "error"}
            />
          </div>
        )}

        {!loading && selected !== "ROSSKO" && (
          <div className="space-y-4">
            <ItemsTable
              grouped={grouped}
              showSpend={mode === "outflow" && outflowLoaded}
              ensureQty={ensureQty}
              setQty={setQty}
              excluded={excluded}
              toggleExcluded={toggleExcluded}
              readOnly={false}
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={buildMessage}
                className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-white"
              >
                Сформировать сообщение
              </button>
              <button
                type="button"
                onClick={() => void copyMessage()}
                disabled={!messageText}
                className="rounded-xl border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-100 dark:hover:bg-zinc-800"
              >
                Копировать
              </button>
            </div>
            {messageText ? (
              <textarea
                readOnly
                value={messageText}
                rows={10}
                className="w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-2 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              />
            ) : null}
          </div>
        )}
      </section>
      </div>

      {cartOpen && (
        <RosskoCartDrawer
          lines={rosskoCart}
          totalQty={rosskoCartTotal}
          totalSum={rosskoCartSum}
          checkoutBusy={checkoutBusy}
          receiptDraftBusy={receiptDraftBusy}
          onClose={() => setCartOpen(false)}
          onQty={updateCartQty}
          onDelete={(idx) => persistRosskoCart(rosskoCart.filter((_, i) => i !== idx))}
          onClear={() => persistRosskoCart([])}
          onReplace={replaceRosskoOffer}
          onCheckout={() => void checkoutRosskoCart()}
          onReceiptDraft={() => void createReceiptDraftFromRosskoCart()}
        />
      )}

      {toast && (
        <div className="eco-restock-toast" role="status">
          <CheckCircle2 size={17} />
          <span>{toast}</span>
        </div>
      )}

      {settingsOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 cursor-default bg-black/40"
          aria-label="Закрыть"
          onClick={() => setSettingsOpen(false)}
        />
      )}
      {settingsOpen && (
        <div className="fixed left-1/2 top-1/2 z-50 w-[min(100%,420px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
          <div className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">О данных</div>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-zinc-600 dark:text-zinc-400">
            <li>В список попадают только локальные товары с заполненным неснижаемым остатком.</li>
            <li>Условие: доступный остаток в локальной БД меньше неснижаемого.</li>
            <li>
              Режим «С расходом за период» дополнительно отбирает позиции, по которым был расход за выбранные даты
              (локальные отгрузки и списания).
            </li>
            <li>Количества для сообщения и исключения позиций хранятся в браузере на этом устройстве.</li>
          </ul>
          <button
            type="button"
            onClick={() => setSettingsOpen(false)}
            className="mt-5 w-full rounded-xl bg-zinc-900 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-950"
          >
            Понятно
          </button>
        </div>
      )}
    </div>
  );
}

function RosskoStatusPanel({
  health,
  bulk,
  disabled,
  onRetry,
  onBulk,
}: {
  health: RosskoHealth;
  bulk: RosskoBulkState;
  disabled: boolean;
  onRetry: () => void;
  onBulk: () => void;
}) {
  const ok = health.status === "ok";
  const checking = health.status === "checking";
  return (
    <section className={`eco-restock-rossko-status ${ok || checking ? "is-ok" : "is-error"}`}>
      <div className="eco-restock-rossko-status__icon">
        {checking ? <Loader2 size={18} className="eco-spin" /> : ok ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
      </div>
      <div className="eco-restock-rossko-status__body">
        <strong>{ok || checking ? "ROSSKO подключён" : "ROSSKO недоступен"}</strong>
        <span>
          {ok || checking
            ? "Можно искать наличие, добавлять позиции в корзину и оформлять заказ"
            : "Поиск предложений временно невозможен. Попробуйте обновить позже"}
        </span>
        <em>Проверено: {fmtTime(health.checkedAt)}</em>
        {bulk.active && (
          <div className="eco-restock-rossko-progress">
            <span>Проверяем {bulk.current} из {bulk.total}…</span>
            <div><i style={{ width: `${bulk.total ? Math.round((bulk.current / bulk.total) * 100) : 0}%` }} /></div>
          </div>
        )}
      </div>
      <div className="eco-restock-rossko-status__actions">
        {ok && (
          <EcoButton type="button" onClick={onBulk} disabled={disabled} size="sm" variant="primary">
            {bulk.active ? <Loader2 size={14} className="eco-spin" /> : <PackageSearch size={14} />}
            Проверить наличие ROSSKO
          </EcoButton>
        )}
        {!ok && (
          <EcoButton type="button" onClick={onRetry} disabled={checking} size="sm">
            <RefreshCw size={14} className={checking ? "eco-spin" : ""} />
            Повторить проверку
          </EcoButton>
        )}
      </div>
    </section>
  );
}

function RosskoCartDrawer({
  lines,
  totalQty,
  totalSum,
  checkoutBusy,
  receiptDraftBusy,
  onClose,
  onQty,
  onDelete,
  onClear,
  onReplace,
  onCheckout,
  onReceiptDraft,
}: {
  lines: RosskoCartLine[];
  totalQty: number;
  totalSum: number;
  checkoutBusy: boolean;
  receiptDraftBusy: boolean;
  onClose: () => void;
  onQty: (idx: number, count: number) => void;
  onDelete: (idx: number) => void;
  onClear: () => void;
  onReplace: (line: RosskoCartLine) => void;
  onCheckout: () => void;
  onReceiptDraft: () => void;
}) {
  return (
    <div className="eco-restock-cart-shell" role="presentation">
      <button type="button" className="eco-restock-cart-backdrop" aria-label="Закрыть корзину" onClick={onClose} />
      <aside className="eco-restock-cart-drawer" role="dialog" aria-modal="true" aria-label="Корзина пополнения">
        <header className="eco-restock-cart-head">
          <div>
            <span>Корзина пополнения</span>
            <h2>ROSSKO</h2>
          </div>
          <button type="button" className="eco-icon-btn" onClick={onClose} aria-label="Закрыть">
            <X size={18} />
          </button>
        </header>

        <div className="eco-restock-cart-summary">
          <div><span>Поставщик</span><strong>ROSSKO</strong></div>
          <div><span>Позиции</span><strong>{lines.length}</strong></div>
          <div><span>Единицы</span><strong>{fmtNum(totalQty)}</strong></div>
          <div><span>Сумма</span><strong>{fmtMoney(totalSum)} ₽</strong></div>
        </div>

        <div className="eco-restock-cart-body">
          {lines.length ? (
            <div className="eco-restock-cart-group">
              {lines.map((line, idx) => {
                const sum = Math.max(0, Number(line.count || 0)) * Math.max(0, Number(line.price || 0));
                return (
                  <article key={`${cartKey(line)}:${idx}`} className="eco-restock-cart-line">
                    <div className="eco-restock-cart-line__main">
                      <strong>{line.title || "Локальный товар"}</strong>
                      <span>{line.code || "без кода"}</span>
                    </div>
                    <div className="eco-restock-cart-line__offer">
                      <b>{line.brand} {line.partnumber}</b>
                      <span>{line.stock}{line.city ? ` · ${line.city}` : ""}</span>
                    </div>
                    <dl>
                      <div><dt>Цена</dt><dd>{fmtMoney(line.price)} ₽</dd></div>
                      <div><dt>Доставка</dt><dd>{line.delivery || "уточняется"}</dd></div>
                      <div><dt>Сумма</dt><dd>{fmtMoney(sum)} ₽</dd></div>
                    </dl>
                    <div className="eco-restock-cart-line__actions">
                      <EcoInput
                        type="number"
                        min={1}
                        max={line.available ?? undefined}
                        step={1}
                        value={line.count}
                        onChange={(event) => onQty(idx, parseInt(event.target.value, 10) || 1)}
                        aria-label="Количество"
                      />
                      <EcoButton type="button" size="sm" onClick={() => onReplace(line)}>
                        Заменить
                      </EcoButton>
                      <button type="button" onClick={() => onDelete(idx)} aria-label="Удалить" className="eco-restock-icon-danger">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="eco-restock-cart-empty">
              <ShoppingCart size={28} />
              <strong>Корзина пустая</strong>
              <span>Добавьте предложение ROSSKO из строки товара, чтобы собрать заказ или черновик приёмки.</span>
            </div>
          )}
        </div>

        <footer className="eco-restock-cart-footer">
          {!!lines.length && (
            <button type="button" className="eco-restock-clear" onClick={onClear}>
              Очистить корзину
            </button>
          )}
          <EcoButton type="button" onClick={onClose}>
            Закрыть
          </EcoButton>
          <EcoButton type="button" onClick={onReceiptDraft} disabled={!lines.length || receiptDraftBusy} variant="primary">
            {receiptDraftBusy ? <Loader2 size={15} className="eco-spin" /> : <FilePlus2 size={15} />}
            Создать черновик приёмки
          </EcoButton>
          <EcoButton type="button" onClick={onCheckout} disabled={!lines.length || checkoutBusy} className="eco-restock-order-btn">
            {checkoutBusy ? <Loader2 size={15} className="eco-spin" /> : <PackageCheck size={15} />}
            Сформировать заказ
          </EcoButton>
        </footer>
      </aside>
    </div>
  );
}

function statusLabel(st: RosskoSearchState, inCartQty: number): { label: string; tone: "neutral" | "success" | "warning" | "danger" | "info" } {
  if (inCartQty > 0) return { label: "В корзине", tone: "success" };
  if (st.loading) return { label: "Ищем…", tone: "info" };
  if (st.error || st.status === "error") return { label: "Ошибка", tone: "danger" };
  if (st.status === "not_found") return { label: "Не найдено", tone: "warning" };
  if (st.results?.length) return { label: `${st.results.reduce((sum, offer) => sum + offer.stocks.length, 0)} предложения`, tone: "success" };
  return { label: "Не искали", tone: "neutral" };
}

function offerBadges(rows: { offer: RosskoOffer; stock: RosskoStock }[], it: RestockItem, row: { offer: RosskoOffer; stock: RosskoStock }) {
  const price = stockPrice(row.stock);
  const count = stockCount(row.stock);
  const need = defaultQty(it);
  const prices = rows.map((x) => stockPrice(x.stock)).filter((x): x is number => x !== null);
  const ranks = rows.map((x) => deliveryRank(x.stock));
  const counts = rows.map((x) => stockCount(x.stock)).filter((x): x is number => x !== null);
  const minPrice = prices.length ? Math.min(...prices) : null;
  const minDelivery = ranks.length ? Math.min(...ranks) : null;
  const maxCount = counts.length ? Math.max(...counts) : null;
  const hasEnough = count !== null && count >= need;
  const recommended = hasEnough && (minPrice === null || price === minPrice);
  const badges: string[] = [];
  if (recommended) badges.push("Рекомендуем");
  if (price !== null && minPrice !== null && price === minPrice) badges.push("Лучшая цена");
  if (minDelivery !== null && deliveryRank(row.stock) === minDelivery) badges.push("Быстрее всего");
  if (count !== null && maxCount !== null && count === maxCount && count > need) badges.push("Много в наличии");
  return badges.slice(0, 3);
}

function flattenedOffers(results: RosskoOffer[] | undefined) {
  return (results ?? []).flatMap((offer) => offer.stocks.map((stock) => ({ offer, stock })));
}

function RosskoManualSearch({
  pid,
  value,
  loading,
  onChange,
  onSubmit,
}: {
  pid: string;
  value: string;
  loading: boolean;
  onChange: (pid: string, value: string) => void;
  onSubmit: (query: string) => void;
}) {
  return (
    <form
      className="eco-restock-manual-search"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(value);
      }}
    >
      <Search size={15} />
      <EcoInput
        value={value}
        onChange={(event) => onChange(pid, event.target.value)}
        placeholder="Ручной поиск по названию, артикулу или бренду"
      />
      <EcoButton type="submit" size="sm" disabled={loading || value.trim().length < 2}>
        {loading ? <Loader2 size={14} className="eco-spin" /> : <Search size={14} />}
        Найти
      </EcoButton>
    </form>
  );
}

function RosskoOfferPanel({
  item,
  state,
  cartQtyByOffer,
  offerQty,
  setOfferQty,
  addState,
  manualQuery,
  setManualQuery,
  refreshRossko,
  addToCart,
}: {
  item: RestockItem;
  state: RosskoSearchState;
  cartQtyByOffer: Map<string, number>;
  offerQty: (key: string, item: RestockItem, stock: RosskoStock) => number;
  setOfferQty: (key: string, value: number) => void;
  addState: Record<string, "loading" | "success" | "error">;
  manualQuery: string;
  setManualQuery: (pid: string, value: string) => void;
  refreshRossko: (pid: string, item: RestockItem, query?: string) => void;
  addToCart: (line: RosskoCartLine) => void;
}) {
  const rows = flattenedOffers(state.results);
  return (
    <div className="eco-restock-offer-panel">
      <div className="eco-restock-offer-panel__head">
        <div>
          <span>Предложения ROSSKO для:</span>
          <strong>{item.name ?? "товар без названия"}</strong>
        </div>
        <EcoButton type="button" size="sm" onClick={() => refreshRossko(item.productId, item)} disabled={!!state.loading}>
          {state.loading ? <Loader2 size={14} className="eco-spin" /> : <RefreshCw size={14} />}
          Обновить
        </EcoButton>
      </div>

      {state.loading && (
        <div className="eco-restock-offer-state">
          <Loader2 size={16} className="eco-spin" />
          Ищем предложения ROSSKO…
        </div>
      )}
      {state.error && (
        <div className="eco-restock-offer-state is-error">
          <AlertTriangle size={16} />
          <div>
            <strong>{state.error}</strong>
            <span>Технические детали сохранены в dev/log.</span>
          </div>
        </div>
      )}
      {!state.loading && !state.error && state.status === "not_found" && (
        <div className="eco-restock-offer-state is-empty">
          <AlertTriangle size={16} />
          <div>
            <strong>Предложений не найдено</strong>
            <span>Можно повторить поиск или подобрать товар вручную.</span>
          </div>
        </div>
      )}

      {(state.error || state.status === "not_found") && (
        <RosskoManualSearch
          pid={item.productId}
          value={manualQuery}
          loading={!!state.loading}
          onChange={setManualQuery}
          onSubmit={(query) => refreshRossko(item.productId, item, query)}
        />
      )}

      {!!rows.length && (
        <div className="eco-restock-offer-list">
          {rows.map((row) => {
            const key = offerStockKey(item.productId, row.offer, row.stock);
            const quantity = offerQty(key, item, row.stock);
            const count = stockCount(row.stock);
            const price = stockPrice(row.stock);
            const inCart = cartQtyByOffer.get(key) ?? 0;
            const badges = offerBadges(rows, item, row);
            const shortage = defaultQty(item);
            const insufficient = count !== null && count < shortage;
            const qtyError = count !== null && quantity > count;
            const stateKey = addState[key];
            return (
              <article key={key} className={`eco-restock-offer ${inCart ? "is-selected" : ""}`}>
                <div className="eco-restock-offer__title">
                  <strong>{row.offer.partnumber}</strong>
                  <span>{row.offer.brand}{row.stock.city ? ` · ${row.stock.city}` : ""}</span>
                </div>
                <div className="eco-restock-offer__facts">
                  <span>Наличие: <b>{fmtNum(count)}</b></span>
                  <span>Цена: <b>{fmtMoney(price)} ₽</b></span>
                  <span>Доставка: <b>{deliveryLabel(row.stock)}</b></span>
                </div>
                {!!badges.length && (
                  <div className="eco-restock-offer__badges">
                    {badges.map((badge) => <span key={badge}>{badge}</span>)}
                  </div>
                )}
                <div className="eco-restock-offer__buy">
                  <label>
                    <span>К заказу</span>
                    <EcoInput
                      type="number"
                      min={1}
                      max={count ?? undefined}
                      step={1}
                      value={quantity}
                      onChange={(event) => setOfferQty(key, parseInt(event.target.value, 10) || 1)}
                    />
                  </label>
                  <EcoButton
                    type="button"
                    size="sm"
                    variant={inCart ? "secondary" : "primary"}
                    disabled={(!!stateKey && stateKey === "loading") || qtyError}
                    onClick={() =>
                      addToCart({
                        productId: item.productId,
                        title: String(item.name ?? ""),
                        code: String(item.code ?? ""),
                        partnumber: row.offer.partnumber,
                        brand: row.offer.brand,
                        stock: row.stock.id,
                        count: quantity,
                        price,
                        delivery: deliveryLabel(row.stock),
                        available: count,
                        city: row.stock.city,
                        offerName: row.offer.name,
                      })
                    }
                  >
                    {stateKey === "loading" ? <Loader2 size={14} className="eco-spin" /> : inCart ? <CheckCircle2 size={14} /> : <ShoppingCart size={14} />}
                    {stateKey === "loading" ? "Добавляем…" : inCart ? `В корзине: ${inCart}` : "В корзину"}
                  </EcoButton>
                </div>
                {insufficient && <p className="eco-restock-offer-warning">Доступно только {fmtNum(count)} из {fmtNum(shortage)}</p>}
                {qtyError && <p className="eco-restock-offer-warning">Недостаточно наличия</p>}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RosskoItemsTable({
  grouped,
  showSpend,
  ensureQty,
  rosskoState,
  cartQtyByProduct,
  cartQtyByOffer,
  offerQty,
  setOfferQty,
  addState,
  manualQuery,
  setManualQuery,
  toggleRossko,
  refreshRossko,
  addToCart,
  apiUnavailable,
}: {
  grouped: [string, RestockItem[]][];
  showSpend: boolean;
  ensureQty: (pid: string, it: RestockItem) => number;
  rosskoState: Record<string, RosskoSearchState>;
  cartQtyByProduct: Map<string, number>;
  cartQtyByOffer: Map<string, number>;
  offerQty: (key: string, item: RestockItem, stock: RosskoStock) => number;
  setOfferQty: (key: string, value: number) => void;
  addState: Record<string, "loading" | "success" | "error">;
  manualQuery: Record<string, string>;
  setManualQuery: (pid: string, value: string) => void;
  toggleRossko: (pid: string, it: RestockItem) => void;
  refreshRossko: (pid: string, it: RestockItem, query?: string) => void;
  addToCart: (line: RosskoCartLine) => void;
  apiUnavailable: boolean;
}) {
  if (grouped.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-zinc-300 px-6 py-12 text-center text-sm text-zinc-500 dark:border-zinc-700">
        Нет позиций для ROSSKO. Проверьте поставщика в карточках товаров: ожидается {ROSSKO_SUPPLIER_FIXED}.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {grouped.map(([groupName, rows]) => (
        <div key={groupName}>
          <div className="mb-2 text-sm font-semibold text-zinc-800 dark:text-zinc-100">{groupName}</div>
          <div className="eco-restock-table-wrap">
            <table className="eco-restock-rossko-table">
              <thead>
                <tr>
                  <th>Товар</th>
                  <th>Код / артикул</th>
                  <th>Остаток</th>
                  <th>Мин.</th>
                  <th>Дефицит</th>
                  {showSpend && (
                    <th>Расход</th>
                  )}
                  <th>Предложения ROSSKO</th>
                  <th>К заказу</th>
                  <th>Действия</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((it) => {
                  const pid = it.productId;
                  const st = rosskoState[pid] ?? {};
                  const inCartQty = cartQtyByProduct.get(pid) ?? 0;
                  const meta = statusLabel(st, inCartQty);
                  const colSpan = showSpend ? 9 : 8;
                  const hasResults = Boolean(st.results?.length);
                  const actionLabel = (() => {
                    if (apiUnavailable) return "Повторить проверку";
                    if (st.loading) return "Ищем…";
                    if (st.status === "error" || st.status === "not_found") return "Повторить";
                    if (hasResults) return st.open ? "Скрыть" : `${flattenedOffers(st.results).length} предложения`;
                    return "Найти предложения";
                  })();
                  return (
                    <Fragment key={pid}>
                      <tr className={`eco-restock-product-row ${inCartQty ? "is-in-cart" : ""}`}>
                        <td className="eco-restock-product">
                          <strong>{it.name ?? "—"}</strong>
                          {it.group && <span>{it.group}</span>}
                        </td>
                        <td className="l-mono">{it.code ?? "—"}</td>
                        <td className="l-number">{fmtNum(it.stock)}</td>
                        <td className="l-number">{fmtNum(it.minimumBalance)}</td>
                        <td className="l-number is-shortage">{fmtNum(it.shortage)}</td>
                        {showSpend && <td className="l-number">{fmtNum(it.spentInPeriod)}</td>}
                        <td>
                          <EcoBadge tone={meta.tone} dot={meta.tone === "success"}>
                            {meta.label}
                          </EcoBadge>
                          {st.checkedAt && <span className="eco-restock-check-time">Проверено: {fmtTime(st.checkedAt)}</span>}
                        </td>
                        <td className="l-number">
                          {inCartQty ? (
                            <span className="eco-restock-in-cart">В корзине: {fmtNum(inCartQty)}</span>
                          ) : (
                            <span>{fmtNum(ensureQty(pid, it))} шт.</span>
                          )}
                        </td>
                        <td className="eco-restock-row-actions">
                          <EcoButton
                            type="button"
                            size="sm"
                            disabled={apiUnavailable || !!st.loading}
                            onClick={() => toggleRossko(pid, it)}
                            variant={hasResults || st.open ? "secondary" : "primary"}
                          >
                            {st.loading ? <Loader2 size={14} className="eco-spin" /> : hasResults && st.open ? <ChevronUp size={14} /> : hasResults ? <ChevronDown size={14} /> : <Search size={14} />}
                            {actionLabel}
                          </EcoButton>
                        </td>
                      </tr>
                      {st.open && (
                        <tr className="eco-restock-offer-row">
                          <td colSpan={colSpan}>
                            <RosskoOfferPanel
                              item={it}
                              state={st}
                              cartQtyByOffer={cartQtyByOffer}
                              offerQty={offerQty}
                              setOfferQty={setOfferQty}
                              addState={addState}
                              manualQuery={manualQuery[pid] ?? ""}
                              setManualQuery={setManualQuery}
                              refreshRossko={refreshRossko}
                              addToCart={addToCart}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

function ItemsTable({
  grouped,
  showSpend,
  ensureQty,
  setQty,
  excluded,
  toggleExcluded,
  readOnly,
}: {
  grouped: [string, RestockItem[]][];
  showSpend: boolean;
  ensureQty: (pid: string, it: RestockItem) => number;
  setQty: (pid: string, it: RestockItem, value: number) => void;
  excluded: Record<string, boolean>;
  toggleExcluded: (pid: string) => void;
  readOnly: boolean;
}) {
  if (grouped.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-zinc-300 px-6 py-12 text-center text-sm text-zinc-500 dark:border-zinc-700">
        Нет позиций для отображения.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {grouped.map(([groupName, rows]) => (
        <div key={groupName}>
          <div className="mb-2 text-sm font-semibold text-zinc-800 dark:text-zinc-100">{groupName}</div>
          <div className="overflow-x-auto rounded-2xl border border-zinc-200 dark:border-zinc-800">
            <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
              <thead className="bg-zinc-50 dark:bg-zinc-900/80">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-zinc-600 dark:text-zinc-400">Код</th>
                  <th className="px-3 py-2 text-left font-medium text-zinc-600 dark:text-zinc-400">Название</th>
                  <th className="px-3 py-2 text-right font-medium text-zinc-600 dark:text-zinc-400">Остаток</th>
                  <th className="px-3 py-2 text-right font-medium text-zinc-600 dark:text-zinc-400">Мин.</th>
                  <th className="px-3 py-2 text-right font-medium text-zinc-600 dark:text-zinc-400">Дефицит</th>
                  {showSpend && (
                    <th className="px-3 py-2 text-right font-medium text-zinc-600 dark:text-zinc-400">
                      Расход за период
                    </th>
                  )}
                  {!readOnly && (
                    <>
                      <th className="px-3 py-2 text-right font-medium text-zinc-600 dark:text-zinc-400">Заказ</th>
                      <th className="px-3 py-2 text-center font-medium text-zinc-600 dark:text-zinc-400">Вкл.</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 bg-white dark:divide-zinc-800 dark:bg-zinc-950">
                {rows.map((it) => (
                  <tr
                    key={it.productId}
                    className={excluded[it.productId] ? "opacity-50" : ""}
                  >
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-zinc-700 dark:text-zinc-300">
                      {it.code ?? "—"}
                    </td>
                    <td className="max-w-[min(360px,45vw)] px-3 py-2 text-zinc-900 dark:text-zinc-100">
                      <span className="line-clamp-2">{it.name ?? "—"}</span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{fmtNum(it.stock)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                      {fmtNum(it.minimumBalance)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums text-amber-700 dark:text-amber-400">
                      {fmtNum(it.shortage)}
                    </td>
                    {showSpend && (
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                        {fmtNum(it.spentInPeriod)}
                      </td>
                    )}
                    {!readOnly && (
                      <>
                        <td className="whitespace-nowrap px-3 py-2 text-right">
                          <input
                            type="number"
                            min={1}
                            step={1}
                            value={ensureQty(it.productId, it)}
                            onChange={(e) => setQty(it.productId, it, parseInt(e.target.value, 10) || 0)}
                            className="w-20 rounded-lg border border-zinc-200 px-2 py-1 text-right dark:border-zinc-700 dark:bg-zinc-900"
                          />
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-center">
                          <button
                            type="button"
                            onClick={() => toggleExcluded(it.productId)}
                            className="text-xs font-medium text-zinc-600 underline-offset-2 hover:underline dark:text-zinc-400"
                          >
                            {excluded[it.productId] ? "Вернуть" : "Исключить"}
                          </button>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
