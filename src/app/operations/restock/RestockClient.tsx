"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
};
type RosskoCartLine = {
  partnumber: string;
  brand: string;
  stock: string;
  count: number;
  title: string;
  code: string;
  productId: string;
};

const LS_QTY = "vin-oil-restock-qty";
const LS_EXC = "vin-oil-restock-excluded";
const LS_ROSSKO_CART = "vin-oil-restock-rossko-cart";
const LS_ROSSKO_CACHE = "vin-oil-restock-rossko-search-cache";
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

function cartKey(line: Pick<RosskoCartLine, "partnumber" | "brand" | "stock">): string {
  return `${line.brand}||${line.partnumber}||${line.stock}`;
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
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutBusy, setCheckoutBusy] = useState(false);

  useEffect(() => {
    setQtyByProduct(loadJson<Record<string, number>>(LS_QTY, {}));
    setExcluded(loadJson<Record<string, boolean>>(LS_EXC, {}));
    setRosskoCart(loadJson<RosskoCartLine[]>(LS_ROSSKO_CART, []));
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
    setRosskoCart(next);
    saveJson(LS_ROSSKO_CART, next);
  }, []);

  const loadBelowMin = useCallback(async (refresh: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const u = new URL("/api/restock/needs-order", window.location.origin);
      if (refresh) u.searchParams.set("refresh", "1");
      const res = await fetch(u.toString());
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ошибка загрузки");
      setItems(data.items ?? []);
      setMeta({
        fetchedRows: data.fetchedRows,
        catalogSize: data.catalogSize,
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
      const u = new URL("/api/restock/outflow-needs", window.location.origin);
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

  async function rosskoSearch(pid: string, it: RestockItem) {
    setRosskoState((prev) => ({
      ...prev,
      [pid]: { ...(prev[pid] ?? {}), open: true, loading: true, error: "", status: "поиск..." },
    }));
    try {
      const primary = pickQueryFor(it);
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
          status: shown.length ? "найдено" : "не найдено",
          results: shown,
        },
      }));
    } catch (e) {
      setRosskoState((prev) => ({
        ...prev,
        [pid]: {
          ...(prev[pid] ?? {}),
          open: true,
          loading: false,
          status: "ошибка",
          error: e instanceof Error ? e.message : String(e),
          results: [],
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

  function addRosskoToCart(line: RosskoCartLine) {
    const next = [...rosskoCart];
    const idx = next.findIndex((x) => cartKey(x) === cartKey(line));
    if (idx >= 0) {
      next[idx] = { ...next[idx], count: Math.max(1, Number(next[idx].count || 1) + Number(line.count || 1)) };
    } else {
      next.push(line);
    }
    persistRosskoCart(next);
    setCartOpen(true);
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
      alert(`ROSSKO: заказ оформлен${orderId ? ` #${orderId}` : ""}`);
    } catch (e) {
      alert(`Не удалось оформить заказ ROSSKO: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setCheckoutBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <aside className="lg:w-64 lg:shrink-0">
        <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
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
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              О данных
            </button>
          </div>
        </div>
      </aside>

      <section className="min-w-0 flex-1 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              Пополнение остатков
            </h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              Товары с остатком ниже неснижаемого (по данным МойСклад). Поставщик берётся из карточки товара.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="inline-flex rounded-xl border border-zinc-200 p-0.5 dark:border-zinc-700">
              <button
                type="button"
                onClick={() => setMode("below_min")}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                  mode === "below_min"
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950"
                    : "text-zinc-600 dark:text-zinc-400"
                }`}
              >
                Ниже минимума
              </button>
              <button
                type="button"
                onClick={() => setMode("outflow")}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                  mode === "outflow"
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950"
                    : "text-zinc-600 dark:text-zinc-400"
                }`}
              >
                С расходом за период
              </button>
            </div>
            {mode === "below_min" && (
              <button
                type="button"
                onClick={() => void loadBelowMin(true)}
                disabled={loading}
                className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-amber-600 disabled:opacity-60 dark:bg-amber-600 dark:hover:bg-amber-700"
              >
                Обновить из МойСклад
              </button>
            )}
            {selected === "ROSSKO" && (
              <button
                type="button"
                onClick={() => setCartOpen((prev) => !prev)}
                className="rounded-xl border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-100 dark:hover:bg-zinc-800"
              >
                Корзина ROSSKO ({rosskoCartTotal})
              </button>
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
            <button
              type="button"
              onClick={() => void loadOutflow(true)}
              disabled={loading}
              className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-60 dark:bg-amber-600 dark:hover:bg-amber-700"
            >
              Загрузить
            </button>
            {outflowLoaded && meta.dateLabel && (
              <span className="text-sm text-zinc-600 dark:text-zinc-400">
                Период: <span className="font-medium text-zinc-900 dark:text-zinc-100">{meta.dateLabel}</span>
              </span>
            )}
          </div>
        )}

        {meta.fetchedRows !== undefined && (
          <p className="text-xs text-zinc-500 dark:text-zinc-500">
            Строк отчёта остатков: {meta.fetchedRows}, позиций в каталоге: {meta.catalogSize ?? "—"}.
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
            Загрузка данных из МойСклад…
          </div>
        )}

        {!loading && selected === "ROSSKO" && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950 dark:border-emerald-900/60 dark:bg-emerald-950/35 dark:text-emerald-100">
              ROSSKO подключен через серверный SOAP API: можно искать наличие, добавлять позиции в корзину и оформлять заказ.
            </div>
            {cartOpen && (
              <RosskoCart
                lines={rosskoCart}
                checkoutBusy={checkoutBusy}
                onQty={(idx, count) => {
                  const next = [...rosskoCart];
                  if (!next[idx]) return;
                  next[idx] = { ...next[idx], count: Math.max(1, Math.floor(count || 1)) };
                  persistRosskoCart(next);
                }}
                onDelete={(idx) => persistRosskoCart(rosskoCart.filter((_, i) => i !== idx))}
                onClear={() => persistRosskoCart([])}
                onCheckout={() => void checkoutRosskoCart()}
              />
            )}
            <RosskoItemsTable
              grouped={grouped}
              showSpend={mode === "outflow" && outflowLoaded}
              ensureQty={ensureQty}
              rosskoState={rosskoState}
              toggleRossko={toggleRossko}
              refreshRossko={(pid, it) => void rosskoSearch(pid, it)}
              addToCart={addRosskoToCart}
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
            <li>В список попадают только товары с заполненным неснижаемым остатком в МойСклад.</li>
            <li>Условие: текущий остаток меньше неснижаемого.</li>
            <li>
              Режим «С расходом за период» дополнительно отбирает позиции, по которым был расход за выбранные даты
              (отгрузки, розница, списания).
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

function RosskoCart({
  lines,
  checkoutBusy,
  onQty,
  onDelete,
  onClear,
  onCheckout,
}: {
  lines: RosskoCartLine[];
  checkoutBusy: boolean;
  onQty: (idx: number, count: number) => void;
  onDelete: (idx: number) => void;
  onClear: () => void;
  onCheckout: () => void;
}) {
  const total = lines.reduce((sum, x) => sum + Math.max(0, Number(x.count || 0)), 0);
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-base font-semibold text-zinc-900 dark:text-zinc-50">Корзина ROSSKO</div>
          <div className="text-sm text-zinc-500 dark:text-zinc-400">Позиций: {total}</div>
        </div>
        {!!lines.length && (
          <button
            type="button"
            onClick={onClear}
            className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Очистить
          </button>
        )}
      </div>
      {lines.length ? (
        <div className="mt-3 space-y-2">
          {lines.map((x, idx) => (
            <div
              key={`${cartKey(x)}:${idx}`}
              className="flex flex-col gap-2 rounded-xl border border-zinc-100 p-3 dark:border-zinc-800 sm:flex-row sm:items-center"
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {x.brand} {x.partnumber} <span className="font-mono text-xs text-zinc-500">{x.stock}</span>
                </div>
                <div className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">
                  {x.title} {x.code ? `(${x.code})` : ""}
                </div>
              </div>
              <input
                type="number"
                min={1}
                step={1}
                value={x.count}
                onChange={(e) => onQty(idx, parseInt(e.target.value, 10) || 1)}
                className="w-20 rounded-lg border border-zinc-200 px-2 py-1 text-right text-sm dark:border-zinc-700 dark:bg-zinc-950"
              />
              <button
                type="button"
                onClick={() => onDelete(idx)}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Удалить
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={onCheckout}
            disabled={checkoutBusy}
            className="mt-2 rounded-xl bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-60 dark:bg-amber-600 dark:hover:bg-amber-700"
          >
            {checkoutBusy ? "Оформляем..." : "Оформить заказ"}
          </button>
        </div>
      ) : (
        <div className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">Корзина пустая.</div>
      )}
    </div>
  );
}

function RosskoItemsTable({
  grouped,
  showSpend,
  ensureQty,
  rosskoState,
  toggleRossko,
  refreshRossko,
  addToCart,
}: {
  grouped: [string, RestockItem[]][];
  showSpend: boolean;
  ensureQty: (pid: string, it: RestockItem) => number;
  rosskoState: Record<string, RosskoSearchState>;
  toggleRossko: (pid: string, it: RestockItem) => void;
  refreshRossko: (pid: string, it: RestockItem) => void;
  addToCart: (line: RosskoCartLine) => void;
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
          <div className="overflow-x-auto rounded-2xl border border-zinc-200 dark:border-zinc-800">
            <table className="min-w-full divide-y divide-zinc-200 text-base dark:divide-zinc-800">
              <thead className="bg-zinc-50 dark:bg-zinc-900/80">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-zinc-600 dark:text-zinc-400">Код</th>
                  <th className="px-4 py-3 text-left font-medium text-zinc-600 dark:text-zinc-400">Название</th>
                  <th className="px-4 py-3 text-right font-medium text-zinc-600 dark:text-zinc-400">Остаток</th>
                  <th className="px-4 py-3 text-right font-medium text-zinc-600 dark:text-zinc-400">Мин.</th>
                  <th className="px-4 py-3 text-right font-medium text-zinc-600 dark:text-zinc-400">Дефицит</th>
                  {showSpend && (
                    <th className="px-4 py-3 text-right font-medium text-zinc-600 dark:text-zinc-400">Расход</th>
                  )}
                  <th className="px-4 py-3 text-right font-medium text-zinc-600 dark:text-zinc-400">ROSSKO</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 bg-white dark:divide-zinc-800 dark:bg-zinc-950">
                {rows.map((it) => {
                  const pid = it.productId;
                  const st = rosskoState[pid] ?? {};
                  return (
                    <tr key={pid} className="align-top">
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-sm text-zinc-700 dark:text-zinc-300">
                        {it.code ?? "—"}
                      </td>
                      <td className="min-w-[520px] max-w-[720px] px-4 py-3 text-zinc-900 dark:text-zinc-100">
                        <span className="line-clamp-2">{it.name ?? "—"}</span>
                        {st.open && (
                          <div className="mt-4 rounded-2xl border border-zinc-200 bg-zinc-50 p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
                            <div className="mb-3 flex items-center justify-between gap-3">
                              <span className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                                Предложения ROSSKO
                              </span>
                              <button
                                type="button"
                                onClick={() => refreshRossko(pid, it)}
                                disabled={!!st.loading}
                                className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-800"
                              >
                                Обновить
                              </button>
                            </div>
                            {st.loading && <div className="py-2 text-base text-zinc-500">Запрос к ROSSKO...</div>}
                            {st.error && <div className="py-2 text-base text-red-600 dark:text-red-400">{st.error}</div>}
                            {!st.loading && !st.error && st.results && !st.results.length && (
                              <div className="py-2 text-base text-zinc-500">Ничего не найдено.</div>
                            )}
                            {!st.loading && !st.error && st.results?.map((offer) => (
                              <div
                                key={`${offer.brand}:${offer.partnumber}`}
                                className="mt-3 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
                              >
                                <div className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
                                  {offer.brand} {offer.partnumber}
                                </div>
                                {offer.name && (
                                  <div className="mt-1 text-sm leading-5 text-zinc-600 dark:text-zinc-300">
                                    {offer.name}
                                  </div>
                                )}
                                <div className="mt-3 space-y-2">
                                  {offer.stocks.map((stock) => (
                                    <div
                                      key={`${offer.partnumber}:${stock.id}`}
                                      className="grid gap-3 rounded-xl bg-zinc-50 p-3 text-sm dark:bg-zinc-900 sm:grid-cols-[minmax(110px,1fr)_90px_110px_110px_auto] sm:items-center"
                                    >
                                      <span className="font-mono text-sm text-zinc-500 dark:text-zinc-400">{stock.id}</span>
                                      <span className="font-medium text-zinc-900 dark:text-zinc-100">
                                        Нал: {fmtNum(toNum(stock.count) ?? undefined)}
                                      </span>
                                      <span className="text-zinc-700 dark:text-zinc-300">
                                        Цена: {fmtNum(toNum(stock.price) ?? undefined)}
                                      </span>
                                      <span className="text-zinc-700 dark:text-zinc-300">
                                        Доставка: {String(stock.delivery)}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          addToCart({
                                            partnumber: offer.partnumber,
                                            brand: offer.brand,
                                            stock: stock.id,
                                            count: ensureQty(pid, it),
                                            title: String(it.name ?? ""),
                                            code: String(it.code ?? ""),
                                            productId: pid,
                                          })
                                        }
                                        className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950"
                                      >
                                        В корзину
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{fmtNum(it.stock)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{fmtNum(it.minimumBalance)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums text-amber-700 dark:text-amber-400">
                        {fmtNum(it.shortage)}
                      </td>
                      {showSpend && <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{fmtNum(it.spentInPeriod)}</td>}
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => toggleRossko(pid, it)}
                          className="rounded-xl border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                        >
                          {st.open ? "Скрыть" : "Найти"}
                        </button>
                        {st.status && <div className="mt-1.5 text-sm text-zinc-500">{st.status}</div>}
                      </td>
                    </tr>
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
