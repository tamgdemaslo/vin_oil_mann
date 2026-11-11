"use client";
import KitTabs from "@/components/products/KitTabs";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Copy,
  FilePlus2,
  Loader2,
  PackageCheck,
  PackageSearch,
  RefreshCw,
  Search,
  Settings2,
  ShoppingCart,
  Trash2,
  X,
} from "lucide-react";
import { EcoBadge, EcoButton, EcoInput, EcoSelect } from "@/components/platform/EcoUI";
import { formatServiceTime, toServiceDateInput } from "@/lib/date-time";
import styles from "./QuickOrderPreview.module.css";

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
  unit?: string | null;
};

type Mode = "below_min" | "daily_usage";
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
  orderId?: string;
  orderedAt?: number;
  remoteStatus?: "ordered";
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
type SupplierOrderStatus = "ordered" | "confirmed" | "partially_received" | "received" | "cancelled" | "failed";
type SupplierOrderLine = RosskoCartLine & {
  id: string;
  orderId: string;
  externalOrderId: string;
  supplier: "ROSSKO";
  orderedQty: number;
  receivedQty: number;
  remainingQty: number;
  status: SupplierOrderStatus;
  statusLabel?: string;
  expectedAt?: number;
};
type SupplierOrder = {
  id: string;
  supplier: "ROSSKO";
  supplierType: "ROSSKO";
  externalOrderId: string;
  status: SupplierOrderStatus;
  createdAt: number;
  orderedAt: number;
  expectedAt?: number;
  lines: SupplierOrderLine[];
  comment?: string;
};
type ServerIncomingOrder = {
  externalOrderId: string;
  createdAt: string | null;
  expectedDate: string | null;
  status: string;
  statusLabel: string;
  summary: { activeIncomingQty: number };
  lines: Array<{
    sourceLineKey: string;
    productId: string;
    name: string;
    brand: string;
    article: string;
    orderedQty: number;
    postedReceivedQty: number;
    activeIncomingQty: number;
    expectedDate: string | null;
    stateLabel: string;
    sourceStatusLabel: string;
  }>;
};
type ServerIncomingResponse = { orders?: ServerIncomingOrder[]; updatedAt?: string | null; error?: string };
type ProcurementCoverage = {
  available: number;
  reserve: number;
  min: number;
  deficit: number;
  inCart: number;
  ordered: number;
  dueToday: number;
  dueTomorrow: number;
  dueLater: number;
  overdue: number;
  remaining: number;
  expectedLabel: string;
};
type QuickOrderItem = {
  productId: string;
  title: string;
  code: string;
  available: number;
  minimum: number;
  ordered: number;
  remaining: number;
  quantity: number;
  included: boolean;
  status: "ready" | "partial" | "no_offer" | "error" | "covered";
  message: string;
  offer?: RosskoOffer;
  stock?: RosskoStock;
  price: number | null;
  delivery: string;
  availableFromOffer: number | null;
};
type QuickOrderPreview = {
  createdAt: number;
  items: QuickOrderItem[];
};
type SupplierStat = {
  name: string;
  count: number;
  shortage: number;
};
type ProcurementCategory = "all" | "oils" | "filters" | "other" | "setup";
type ProcurementMode = "rossko_only" | "supplier_from_product" | "needs_setup";
type ProcurementRoute = {
  category: Exclude<ProcurementCategory, "all">;
  mode: ProcurementMode;
  channel: string;
  subcategory: string;
  setupReasons: string[];
};
type ProcurementTab = {
  id: ProcurementCategory;
  label: string;
  count: number;
};

const LS_QTY = "vin-oil-restock-qty";
const LS_EXC = "vin-oil-restock-excluded";
const LS_ROSSKO_CART = "vin-oil-restock-rossko-cart";
const LS_ROSSKO_ORDERS = "vin-oil-restock-rossko-orders";
const LS_ROSSKO_CACHE = "vin-oil-restock-rossko-search-cache";
const LS_ROSSKO_OFFER_QTY = "vin-oil-restock-rossko-offer-qty";
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
  return formatServiceTime(ts);
}

function defaultQty(it: RestockItem): number {
  if (it.spentInPeriod !== undefined) return it.spentInPeriod;
  const s = it.shortage;
  if (s !== undefined && s !== null && Number.isFinite(s)) return Math.max(1, Math.ceil(s));
  return 1;
}

function supplierName(it: RestockItem): string {
  return (it.supplier && String(it.supplier).trim()) || "Без поставщика";
}

function isRosskoSupplierName(name: string): boolean {
  const normalized = name.toLowerCase().replace(/ё/g, "е").replace(/[«»"]/g, "").trim();
  return normalized.includes("гринлайт") || normalized === "rossko";
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

function skuCodeHintsFromName(nameText: unknown): string[] {
  const raw = String(nameText || "");
  const parts = raw.match(/\b[A-Za-zА-Яа-я0-9][A-Za-zА-Яа-я0-9._/-]{3,}\b/g) ?? [];
  const out: string[] = [];
  for (const part of parts) {
    const token = part.replace(/[.,;:]+$/g, "").trim();
    const normalized = token.toLowerCase().replace(/ё/g, "е");
    if (normalized.length < 4) continue;
    if (/^(фильтр|масляный|воздушный|салонный|топливный|масло|motor|oil|filter)$/i.test(normalized)) continue;
    if (/^\d+[wв]\W?\d+/i.test(normalized)) continue;
    if (/^\d+([.,]\d+)?\s?(л|l|ml|мл)$/i.test(normalized)) continue;
    if (!/\d/.test(normalized)) continue;
    out.push(token);
    if (out.length >= 4) break;
  }
  return out;
}

function rosskoQueryCandidates(it: RestockItem, queryOverride?: string): string[] {
  const manual = queryOverride?.trim();
  if (manual) return [manual];
  const code = String(it.code ?? "").trim();
  const name = String(it.name ?? "").trim();
  const brand = extractLikelyBrandForRosskoQuery(name);
  const codeHints = skuCodeHintsFromName(name);
  const candidates = [
    ...codeHints.flatMap((hint) => (brand ? [`${brand} ${hint}`, hint] : [hint])),
    pickQueryFor(it),
    code,
    name,
  ];
  const seen = new Set<string>();
  return candidates
    .map((candidate) => candidate.trim())
    .filter((candidate) => {
      if (candidate.length < 2) return false;
      const key = candidate.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
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
  if (!Array.isArray(lines)) return [];
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
      orderId: line.orderId || "",
      orderedAt: typeof line.orderedAt === "number" && Number.isFinite(line.orderedAt) ? line.orderedAt : undefined,
      remoteStatus: line.remoteStatus === "ordered" ? "ordered" : undefined,
    }));
}

function uuidLike(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `${prefix}_${crypto.randomUUID()}`;
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function expectedAtFromDelivery(label: string, orderedAt = Date.now()): number | undefined {
  const raw = String(label || "").toLowerCase().replace(/ё/g, "е").trim();
  const day = 24 * 60 * 60 * 1000;
  if (!raw || raw.includes("уточ")) return undefined;
  if (raw.includes("сегодня") || raw === "0") return orderedAt;
  if (raw.includes("завтра") || raw === "1") return orderedAt + day;
  const num = toNum(raw.replace(/[^\d,.]+/g, " "));
  if (num !== null) return orderedAt + Math.max(0, Math.floor(num)) * day;
  return undefined;
}

function normalizeSupplierOrders(orders: SupplierOrder[]): SupplierOrder[] {
  if (!Array.isArray(orders)) return [];
  const normalized: SupplierOrder[] = [];
  for (const order of orders) {
    if (!order || order.supplier !== "ROSSKO" || !Array.isArray(order.lines)) continue;
    const orderedAt = Number(order.orderedAt || order.createdAt || Date.now());
    const lines: SupplierOrderLine[] = [];
    for (const line of order.lines) {
      const normalizedCart = normalizeRosskoCart([line])[0];
      if (!normalizedCart) continue;
      const orderedQty = Math.max(1, Math.floor(Number(line.orderedQty ?? normalizedCart.count ?? 1)));
      const receivedQty = Math.max(0, Math.floor(Number(line.receivedQty ?? 0)));
      const remainingQty = Math.max(0, Math.floor(Number(line.remainingQty ?? orderedQty - receivedQty)));
      if (!normalizedCart.productId) continue;
      lines.push({
        ...normalizedCart,
        id: line.id || uuidLike("pol"),
        orderId: line.orderId || order.id,
        externalOrderId: line.externalOrderId || order.externalOrderId || "",
        supplier: "ROSSKO",
        orderedQty,
        receivedQty,
        remainingQty,
        status: line.status || order.status || "ordered",
        statusLabel: line.statusLabel,
        expectedAt: typeof line.expectedAt === "number" ? line.expectedAt : expectedAtFromDelivery(normalizedCart.delivery, orderedAt),
      });
    }
    normalized.push({
      id: order.id || uuidLike("po"),
      supplier: "ROSSKO",
      supplierType: "ROSSKO",
      externalOrderId: order.externalOrderId || "",
      status: order.status || "ordered",
      createdAt: Number(order.createdAt || orderedAt),
      orderedAt,
      expectedAt:
        typeof order.expectedAt === "number"
          ? order.expectedAt
          : lines.map((line) => line.expectedAt).filter((x): x is number => typeof x === "number").sort((a, b) => a - b)[0],
      lines,
      comment: order.comment || "",
    });
  }
  return normalized;
}

function supplierOrdersFromServer(orders: ServerIncomingOrder[]): SupplierOrder[] {
  return normalizeSupplierOrders(orders.map((order) => {
    const orderedAt = order.createdAt ? new Date(order.createdAt).getTime() : Date.now();
    const lines: SupplierOrderLine[] = order.lines.map((line) => ({
      id: line.sourceLineKey,
      orderId: `rossko_order:${order.externalOrderId}`,
      externalOrderId: order.externalOrderId,
      supplier: "ROSSKO",
      productId: line.productId,
      partnumber: line.article,
      brand: line.brand,
      stock: "ROSSKO",
      count: line.orderedQty,
      title: line.name,
      code: line.article,
      price: null,
      delivery: line.expectedDate ? new Date(line.expectedDate).toLocaleDateString("ru-RU") : "уточняется",
      available: null,
      city: "",
      offerName: `${line.brand} ${line.article}`.trim(),
      orderedQty: line.orderedQty,
      receivedQty: line.postedReceivedQty,
      remainingQty: line.activeIncomingQty,
      status: line.activeIncomingQty > 0
        ? line.postedReceivedQty > 0 ? "partially_received" : "confirmed"
        : line.postedReceivedQty >= line.orderedQty ? "received" : "cancelled",
      statusLabel: line.activeIncomingQty > 0 && line.sourceStatusLabel && line.sourceStatusLabel !== line.stateLabel
        ? `${line.sourceStatusLabel} · ${line.stateLabel}`
        : line.stateLabel,
      expectedAt: line.expectedDate ? new Date(line.expectedDate).getTime() : undefined,
    }));
    return {
      id: `rossko_order:${order.externalOrderId}`,
      supplier: "ROSSKO",
      supplierType: "ROSSKO",
      externalOrderId: order.externalOrderId,
      status: order.status === "received" || order.status === "cancelled" || order.status === "partially_received" ? order.status : "confirmed",
      createdAt: orderedAt,
      orderedAt,
      expectedAt: order.expectedDate ? new Date(order.expectedDate).getTime() : undefined,
      lines,
      comment: order.statusLabel,
    };
  }));
}

function cartKey(line: Pick<RosskoCartLine, "productId" | "partnumber" | "brand" | "stock">): string {
  return `${line.productId}||${line.brand}||${line.partnumber}||${line.stock}`;
}

function extractRosskoOrderId(data: unknown): string {
  const resp = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const direct = resp.OrderID ?? resp.orderId ?? resp.order_id;
  if (direct !== undefined && direct !== null && String(direct).trim()) return String(direct).trim();
  const orderIds = resp.OrderIDS ?? resp.orderIds ?? resp.order_ids;
  if (Array.isArray(orderIds) && orderIds.length) return String(orderIds[0]).trim();
  if (orderIds && typeof orderIds === "object") {
    const id = (orderIds as Record<string, unknown>).id ?? (orderIds as Record<string, unknown>).ID;
    if (Array.isArray(id) && id.length) return String(id[0]).trim();
    if (id !== undefined && id !== null) return String(id).trim();
  }
  return "";
}

function supplierStatFor(name: string, rows: RestockItem[]): SupplierStat {
  return {
    name,
    count: rows.length,
    shortage: rows.reduce((sum, item) => sum + Math.max(0, Number(item.shortage ?? 0)), 0),
  };
}

function startOfServiceDay(ts = Date.now()): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function expectedBucket(expectedAt: number | undefined): "unknown" | "overdue" | "today" | "tomorrow" | "later" {
  if (!expectedAt) return "unknown";
  const day = 24 * 60 * 60 * 1000;
  const today = startOfServiceDay();
  const date = startOfServiceDay(expectedAt);
  if (date < today) return "overdue";
  if (date === today) return "today";
  if (date === today + day) return "tomorrow";
  return "later";
}

function incomingLabel(lines: SupplierOrderLine[]): string {
  const buckets = new Map<string, number>();
  for (const line of lines) {
    const qty = Math.max(0, Number(line.remainingQty || 0));
    if (!qty) continue;
    const bucket = expectedBucket(line.expectedAt);
    const label =
      bucket === "today"
        ? "сегодня"
        : bucket === "tomorrow"
          ? "завтра"
          : bucket === "overdue"
            ? "просрочено"
            : bucket === "later"
              ? "позже"
              : line.delivery || "уточняется";
    buckets.set(label, (buckets.get(label) ?? 0) + qty);
  }
  if (!buckets.size) return "—";
  return Array.from(buckets.entries()).map(([label, qty]) => `${fmtNum(qty)} ${label}`).join(", ");
}

const supplierOrderStatusLabels: Record<SupplierOrderStatus, string> = {
  ordered: "Отправлен в ROSSKO",
  confirmed: "Подтверждён",
  partially_received: "Принято частично",
  received: "Принято",
  cancelled: "Отменено",
  failed: "Ошибка заказа",
};

function isIncomingOrderLine(line: SupplierOrderLine): boolean {
  return line.remainingQty > 0 && !["cancelled", "failed", "received"].includes(line.status);
}

function coverageForItem(item: RestockItem, cartQty: number, orderLines: SupplierOrderLine[], orderedToday = 0): ProcurementCoverage {
  const available = Number(item.stock || 0);
  const reserve = Number(item.reserve || 0);
  const min = Math.max(0, Number(item.minimumBalance || 0));
  const deficit = Math.max(0, min - available);
  const activeLines = orderLines.filter(isIncomingOrderLine);
  const ordered = activeLines.reduce((sum, line) => sum + Math.max(0, Number(line.remainingQty || 0)), 0);
  const dueToday = activeLines.filter((line) => expectedBucket(line.expectedAt) === "today").reduce((sum, line) => sum + line.remainingQty, 0);
  const dueTomorrow = activeLines.filter((line) => expectedBucket(line.expectedAt) === "tomorrow").reduce((sum, line) => sum + line.remainingQty, 0);
  const dueLater = activeLines.filter((line) => expectedBucket(line.expectedAt) === "later" || expectedBucket(line.expectedAt) === "unknown").reduce((sum, line) => sum + line.remainingQty, 0);
  const overdue = activeLines.filter((line) => expectedBucket(line.expectedAt) === "overdue").reduce((sum, line) => sum + line.remainingQty, 0);
  const remaining = Math.max(0, item.spentInPeriod !== undefined
    ? Math.ceil(item.spentInPeriod) - orderedToday - cartQty
    : min - available - ordered - cartQty);
  const expectedLabel = incomingLabel(activeLines);
  return { available, reserve, min, deficit, inCart: cartQty, ordered, dueToday, dueTomorrow, dueLater, overdue, remaining, expectedLabel };
}

function routeText(it: RestockItem): string {
  return `${it.group ?? ""} ${it.name ?? ""} ${it.code ?? ""}`.toLowerCase().replace(/ё/g, "е");
}

function hasAny(text: string, tokens: string[]): boolean {
  return tokens.some((token) => text.includes(token));
}

function filterSubcategory(text: string): string {
  if (hasAny(text, ["акпп", "atf", "transmission filter", "фильтр автомата", "фильтр кпп"])) return "АКПП";
  if (hasAny(text, ["масля", "oil filter", "масл. фильтр"])) return "Масляные";
  if (hasAny(text, ["воздуш", "air filter"])) return "Воздушные";
  if (hasAny(text, ["салон", "cabin"])) return "Салонные";
  if (hasAny(text, ["топлив", "fuel"])) return "Топливные";
  return "Другие фильтры";
}

function procurementRouteFor(it: RestockItem): ProcurementRoute {
  const text = routeText(it);
  const hasCode = Boolean(String(it.code ?? "").trim());
  const hasGroup = Boolean(String(it.group ?? "").trim());
  const supplier = supplierName(it);
  const isWithoutSupplier = supplier === "Без поставщика";
  const isRosskoSupplier = isRosskoSupplierName(supplier);
  const isFilter = hasAny(text, ["фильтр", "filter"]);
  const isOil = !isFilter && hasAny(text, ["масло", "oil", "5w", "0w", "10w", "15w", "atf", "трансмиссион"]);
  const setupReasons: string[] = [];

  if (!hasCode) setupReasons.push("нет кода / артикула");
  if (!hasGroup && !isFilter && !isOil) setupReasons.push("не определена категория");

  if (isFilter) {
    return {
      category: setupReasons.length ? "setup" : "filters",
      mode: setupReasons.length ? "needs_setup" : "rossko_only",
      channel: setupReasons.length ? "Требует настройки" : "ROSSKO",
      subcategory: filterSubcategory(text),
      setupReasons,
    };
  }

  if (isOil) {
    if (isWithoutSupplier) setupReasons.push("не указан поставщик");
    return {
      category: setupReasons.length ? "setup" : "oils",
      mode: setupReasons.length ? "needs_setup" : isRosskoSupplier ? "rossko_only" : "supplier_from_product",
      channel: setupReasons.length ? "Требует настройки" : supplier,
      subcategory: "Масла",
      setupReasons,
    };
  }

  if (isWithoutSupplier) setupReasons.push("не указан поставщик");
  return {
    category: setupReasons.length ? "setup" : "other",
    mode: setupReasons.length ? "needs_setup" : isRosskoSupplier ? "rossko_only" : "supplier_from_product",
    channel: setupReasons.length ? "Требует настройки" : supplier,
    subcategory: "Прочее",
    setupReasons,
  };
}

function categoryTitle(id: ProcurementCategory): string {
  if (id === "all") return "Все";
  if (id === "oils") return "Масла";
  if (id === "filters") return "Фильтры";
  if (id === "other") return "Прочее";
  return "Требуют настройки";
}

export default function RestockClient() {
  const [mode, setMode] = useState<Mode>("below_min");
  const [items, setItems] = useState<RestockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [usageDate, setUsageDate] = useState<{ key: string; label: string; timezone: string } | null>(null);
  const [dailyQtyDrafts, setDailyQtyDrafts] = useState<Record<string, string>>({});
  const restockRequest = useRef<AbortController | null>(null);
  const showSpend = mode === "daily_usage";

  const [procurementCategory, setProcurementCategory] = useState<ProcurementCategory>("all");
  const [selectedChannel, setSelectedChannel] = useState<string>("all");
  const [qtyByProduct, setQtyByProduct] = useState<Record<string, number>>({});
  const [excluded, setExcluded] = useState<Record<string, boolean>>({});
  const [messageText, setMessageText] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [rosskoState, setRosskoState] = useState<Record<string, RosskoSearchState>>({});
  const [rosskoCart, setRosskoCart] = useState<RosskoCartLine[]>([]);
  const [rosskoOrders, setRosskoOrders] = useState<SupplierOrder[]>([]);
  const [incomingUpdatedAt, setIncomingUpdatedAt] = useState<string | null>(null);
  const [incomingLoading, setIncomingLoading] = useState(false);
  const [rosskoOfferQty, setRosskoOfferQty] = useState<Record<string, number>>({});
  const [rosskoAddState, setRosskoAddState] = useState<Record<string, "loading" | "success" | "error">>({});
  const [rosskoHealth, setRosskoHealth] = useState<RosskoHealth>({ status: "checking" });
  const [rosskoBulk, setRosskoBulk] = useState<RosskoBulkState>({ active: false, current: 0, total: 0 });
  const [rosskoManualQuery, setRosskoManualQuery] = useState<Record<string, string>>({});
  const [toast, setToast] = useState("");
  const [cartOpen, setCartOpen] = useState(false);
  const [quickPreview, setQuickPreview] = useState<QuickOrderPreview | null>(null);
  const [quickBusy, setQuickBusy] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [offerDrawerProductId, setOfferDrawerProductId] = useState<string | null>(null);
  const [checkoutBusy, setCheckoutBusy] = useState(false);

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

  const persistRosskoOrders = useCallback((next: SupplierOrder[]) => {
    const normalized = normalizeSupplierOrders(next);
    setRosskoOrders(normalized);
    saveJson(LS_ROSSKO_ORDERS, normalized);
  }, []);

  const loadServerIncomingOrders = useCallback(async (legacyOrders: SupplierOrder[] = [], sync = true) => {
    setIncomingLoading(true);
    try {
      const response = legacyOrders.length
        ? await fetch("/api/rossko/incoming-orders", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ orders: legacyOrders, sync }),
          })
        : await fetch(`/api/rossko/incoming-orders?sync=${sync ? "1" : "0"}`, { cache: "no-store" });
      const data = await response.json() as ServerIncomingResponse;
      if (!response.ok || data.error) throw new Error(data.error || "Не удалось обновить заказы ROSSKO");
      const normalized = supplierOrdersFromServer(Array.isArray(data.orders) ? data.orders : []);
      setRosskoOrders(normalized);
      setIncomingUpdatedAt(data.updatedAt ?? null);
      saveJson(LS_ROSSKO_ORDERS, normalized);
    } catch (cause) {
      console.warn("ROSSKO incoming sync failed", cause);
      const fallback = normalizeSupplierOrders(legacyOrders);
      if (fallback.length) setRosskoOrders(fallback);
    } finally {
      setIncomingLoading(false);
    }
  }, []);

  useEffect(() => {
    const legacy = normalizeSupplierOrders(loadJson<SupplierOrder[]>(LS_ROSSKO_ORDERS, []));
    setRosskoOrders(legacy);
    void loadServerIncomingOrders(legacy, true);
  }, [loadServerIncomingOrders]);

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

  const loadRestock = useCallback(async (mode: Mode, refresh = false) => {
    restockRequest.current?.abort();
    const controller = new AbortController();
    restockRequest.current = controller;
    setLoading(true);
    setError(null);
    setItems([]);
    setUsageDate(null);
    setMessageText("");
    try {
      const params = new URLSearchParams({ mode });
      if (refresh) params.set("refresh", "1");
      const res = await fetch(`/api/local-inventory/restock?${params}`, { signal: controller.signal });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ошибка загрузки");
      if (controller.signal.aborted) return;
      setItems(data.items ?? []);
      if (mode === "daily_usage") setUsageDate({ key: data.dateFrom, label: data.dateLabel, timezone: data.timezone });
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRestock(mode);
    return () => restockRequest.current?.abort();
  }, [mode, loadRestock]);

  const routeByProduct = useMemo(() => {
    const map = new Map<string, ProcurementRoute>();
    for (const item of items) map.set(item.productId, procurementRouteFor(item));
    return map;
  }, [items]);

  useEffect(() => {
    setMessageText("");
  }, [procurementCategory, selectedChannel]);

  const filterNotFoundInRossko = useCallback(
    (item: RestockItem) => routeByProduct.get(item.productId)?.mode === "rossko_only" && rosskoState[item.productId]?.status === "not_found",
    [rosskoState, routeByProduct]
  );

  const categoryItems = useMemo(() => {
    const eligibleItems = mode === "below_min"
      ? items.filter((item) => Number(item.minimumBalance) > 0 && Number(item.minimumBalance) > item.stock)
      : items;
    if (procurementCategory === "all") return eligibleItems;
    return eligibleItems.filter((item) => {
      const route = routeByProduct.get(item.productId);
      if (!route) return false;
      if (procurementCategory === "setup") return route.category === "setup" || filterNotFoundInRossko(item);
      return route.category === procurementCategory;
    });
  }, [filterNotFoundInRossko, items, mode, procurementCategory, routeByProduct]);

  const channelStats = useMemo(() => {
    const rowsFor = (predicate: (item: RestockItem) => boolean) => categoryItems.filter(predicate);
    const stats = (name: string, rows: RestockItem[], label = name): SupplierStat & { label: string } => ({
      ...supplierStatFor(name, rows),
      label,
    });

    if (procurementCategory === "filters") {
      const allRows = rowsFor((item) => routeByProduct.get(item.productId)?.mode === "rossko_only");
      const map = new Map<string, RestockItem[]>();
      for (const item of allRows) {
        const route = routeByProduct.get(item.productId);
        const key = route?.subcategory || "Другие фильтры";
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(item);
      }
      return [
        stats("all", allRows, "Все фильтры"),
        ...Array.from(map.entries())
          .map(([name, rows]) => stats(name, rows))
          .sort((a, b) => a.label.localeCompare(b.label, "ru")),
      ];
    }

    if (procurementCategory === "setup") {
      const reasonMap = new Map<string, RestockItem[]>();
      for (const item of categoryItems) {
        const reasons = [...(routeByProduct.get(item.productId)?.setupReasons ?? [])];
        if (filterNotFoundInRossko(item)) reasons.push("не найдено в ROSSKO");
        for (const reason of reasons.length ? reasons : ["требует настройки"]) {
          if (!reasonMap.has(reason)) reasonMap.set(reason, []);
          reasonMap.get(reason)!.push(item);
        }
      }
      return [
        stats("all", categoryItems, "Все проблемы"),
        ...Array.from(reasonMap.entries())
          .map(([name, rows]) => stats(name, rows))
          .sort((a, b) => a.label.localeCompare(b.label, "ru")),
      ];
    }

    const map = new Map<string, RestockItem[]>();
    for (const item of categoryItems) {
      const route = routeByProduct.get(item.productId);
      const key = procurementCategory === "all" && route?.mode === "rossko_only" ? "ROSSKO" : route?.channel || supplierName(item);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    const all = stats("all", categoryItems, procurementCategory === "all" ? "Все каналы" : "Все поставщики");
    const channels = Array.from(map.entries())
      .map(([name, rows]) => stats(name, rows))
      .sort((a, b) => {
        if (a.name === "ROSSKO") return -1;
        if (b.name === "ROSSKO") return 1;
        return a.label.localeCompare(b.label, "ru");
      });
    return [all, ...channels];
  }, [categoryItems, filterNotFoundInRossko, procurementCategory, routeByProduct]);

  useEffect(() => {
    if (!loading && !channelStats.some((channel) => channel.name === selectedChannel)) {
      setSelectedChannel(channelStats[0]?.name ?? "all");
    }
  }, [channelStats, loading, selectedChannel]);

  const filteredItems = useMemo(() => {
    if (selectedChannel === "all") return categoryItems;
    return categoryItems.filter((item) => {
      const route = routeByProduct.get(item.productId);
      if (procurementCategory === "filters") return route?.subcategory === selectedChannel;
      if (procurementCategory === "setup") {
        if (filterNotFoundInRossko(item) && selectedChannel === "не найдено в ROSSKO") return true;
        return route?.setupReasons?.includes(selectedChannel);
      }
      if (selectedChannel === "ROSSKO") return route?.mode === "rossko_only";
      return route?.channel === selectedChannel;
    });
  }, [categoryItems, filterNotFoundInRossko, procurementCategory, routeByProduct, selectedChannel]);

  const grouped = useMemo(() => {
    const map = new Map<string, RestockItem[]>();
    for (const it of filteredItems) {
      const route = routeByProduct.get(it.productId);
      const g = route?.category === "filters" ? route.subcategory || "Другие фильтры" : (it.group && String(it.group).trim()) || "Без группы";
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
  }, [filteredItems, routeByProduct]);

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
  const orderStatusesByProduct = useMemo(() => {
    const map = new Map<string, SupplierOrderLine[]>();
    const latestOrderByProduct = new Map<string, string>();
    for (const order of [...rosskoOrders].sort((a, b) => b.orderedAt - a.orderedAt)) {
      for (const line of order.lines) {
        const latestOrderId = latestOrderByProduct.get(line.productId) ?? order.id;
        latestOrderByProduct.set(line.productId, latestOrderId);
        if (order.id !== latestOrderId && !isIncomingOrderLine(line)) continue;
        const rows = map.get(line.productId) ?? [];
        rows.push(line);
        map.set(line.productId, rows);
      }
    }
    return map;
  }, [rosskoOrders]);
  const orderedLinesByProduct = useMemo(() => {
    const map = new Map<string, SupplierOrderLine[]>();
    for (const order of rosskoOrders) {
      if (["cancelled", "failed", "received"].includes(order.status)) continue;
      for (const line of order.lines) {
        if (!isIncomingOrderLine(line)) continue;
        const rows = map.get(line.productId) ?? [];
        rows.push(line);
        map.set(line.productId, rows);
      }
    }
    return map;
  }, [rosskoOrders]);
  const orderedTodayByProduct = useMemo(() => {
    const map = new Map<string, number>();
    if (!usageDate) return map;
    const dateKey = new Intl.DateTimeFormat("sv-SE", { timeZone: usageDate.timezone, dateStyle: "short" });
    for (const order of rosskoOrders) {
      if (!Number.isFinite(order.orderedAt) || dateKey.format(order.orderedAt) !== usageDate.key) continue;
      for (const line of order.lines) {
        const incoming = isIncomingOrderLine(line) ? line.remainingQty : 0;
        map.set(line.productId, (map.get(line.productId) ?? 0) + line.receivedQty + incoming);
      }
    }
    return map;
  }, [rosskoOrders, usageDate]);
  const coverageByProduct = useMemo(() => {
    const map = new Map<string, ProcurementCoverage>();
    for (const item of items) {
      map.set(item.productId, coverageForItem(
        item,
        cartQtyByProduct.get(item.productId) ?? 0,
        orderedLinesByProduct.get(item.productId) ?? [],
        orderedTodayByProduct.get(item.productId),
      ));
    }
    return map;
  }, [cartQtyByProduct, items, orderedLinesByProduct, orderedTodayByProduct]);
  const incomingSummary = useMemo(() => {
    const lines = Array.from(orderedLinesByProduct.values()).flat();
    return {
      today: lines.filter((line) => expectedBucket(line.expectedAt) === "today").reduce((sum, line) => sum + line.remainingQty, 0),
      tomorrow: lines.filter((line) => expectedBucket(line.expectedAt) === "tomorrow").reduce((sum, line) => sum + line.remainingQty, 0),
      later: lines.filter((line) => ["later", "unknown"].includes(expectedBucket(line.expectedAt))).reduce((sum, line) => sum + line.remainingQty, 0),
      overdue: lines.filter((line) => expectedBucket(line.expectedAt) === "overdue").reduce((sum, line) => sum + line.remainingQty, 0),
      total: lines.reduce((sum, line) => sum + line.remainingQty, 0),
    };
  }, [orderedLinesByProduct]);
  const cartQtyByOffer = useMemo(() => {
    const map = new Map<string, number>();
    for (const line of rosskoCart) {
      map.set(cartKey(line), (map.get(cartKey(line)) ?? 0) + Math.max(0, Number(line.count || 0)));
    }
    return map;
  }, [rosskoCart]);
  const procurementTabs: ProcurementTab[] = (["all", "oils", "filters", "other", "setup"] as const).map((id) => ({
    id,
    label: categoryTitle(id),
    count: id === "all" ? items.length : items.filter((item) => {
      const route = routeByProduct.get(item.productId);
      return id === "setup" ? route?.category === "setup" || filterNotFoundInRossko(item) : route?.category === id;
    }).length,
  }));
  const isSetupMode = procurementCategory === "setup";
  const isRosskoMode = !isSetupMode && (
    (filteredItems.length > 0 && filteredItems.every((item) => routeByProduct.get(item.productId)?.mode === "rossko_only")) ||
    procurementCategory === "filters" ||
    (procurementCategory === "all" && selectedChannel === "ROSSKO")
  );
  const isSupplierMessageMode = !isRosskoMode && !isSetupMode && selectedChannel !== "all";
  const selectedChannelLabel = channelStats.find((channel) => channel.name === selectedChannel)?.label ?? categoryTitle(procurementCategory);
  const sidebarTitle =
    procurementCategory === "filters"
      ? "Подкатегории фильтров"
      : procurementCategory === "setup"
        ? "Что настроить"
        : procurementCategory === "all"
          ? "Каналы закупки"
          : "Поставщики";
  const offerDrawerItem = useMemo(
    () => (offerDrawerProductId ? items.find((item) => item.productId === offerDrawerProductId) ?? null : null),
    [items, offerDrawerProductId]
  );
  const canBuildMessage = useMemo(
    () => isSupplierMessageMode && filteredItems.some((it) => !excluded[it.productId] && ensureQty(it.productId, it) > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dailyQtyDrafts, excluded, filteredItems, isSupplierMessageMode, qtyByProduct, usageDate]
  );

  useEffect(() => {
    if (isRosskoMode && !rosskoHealth.checkedAt) void checkRosskoApi();
  }, [checkRosskoApi, isRosskoMode, rosskoHealth.checkedAt]);

  function ensureQty(pid: string, it: RestockItem): number {
    if (it.spentInPeriod !== undefined) {
      const draft = dailyQtyDrafts[`${usageDate?.key}:${pid}`];
      if (draft === undefined) return defaultQty(it);
      const qty = Number(draft);
      return Number.isFinite(qty) && qty > 0 ? qty : 0;
    }
    const q = qtyByProduct[pid];
    if (typeof q === "number" && q > 0) return Math.floor(q);
    return defaultQty(it);
  }

  function setQty(pid: string, it: RestockItem, value: string) {
    setMessageText("");
    if (it.spentInPeriod !== undefined) {
      setDailyQtyDrafts((drafts) => ({ ...drafts, [`${usageDate?.key}:${pid}`]: value }));
      return;
    }
    const v = Math.max(0, Math.floor(Number(value) || 0));
    persistQty({ ...qtyByProduct, [pid]: v > 0 ? v : defaultQty(it) });
  }

  function toggleExcluded(pid: string) {
    setMessageText("");
    persistExcluded({ ...excluded, [pid]: !excluded[pid] });
  }

  function composeSupplierMessage(): string {
    if (!isSupplierMessageMode) return "";
    const lines: string[] = [];
    lines.push(`Заказ поставщику: ${selectedChannelLabel}`);
    lines.push("");
    for (const it of filteredItems) {
      if (excluded[it.productId]) continue;
      const q = ensureQty(it.productId, it);
      if (q <= 0) continue;
      const code = it.code ? String(it.code) : "—";
      const name = it.name ? String(it.name) : "—";
      const quantity = `${fmtNum(q)} ${it.unit || "шт."}`;
      const stockNote = showSpend ? "" : ` (остаток ${fmtNum(it.stock)}, мин. ${fmtNum(it.minimumBalance)})`;
      lines.push(`— ${code} / ${name} — ${quantity}${stockNote}`);
    }
    return lines.length > 2 ? lines.join("\n") : "";
  }

  function buildMessage() {
    const text = composeSupplierMessage();
    setMessageText(text);
    if (!text) showToast("Нет включённых позиций к заказу");
  }

  async function copyMessage() {
    const text = composeSupplierMessage();
    if (!text) {
      showToast("Нет включённых позиций к заказу");
      return;
    }
    setMessageText(text);
    try {
      await navigator.clipboard.writeText(text);
      showToast("Сообщение скопировано");
    } catch {
      showToast("Не удалось скопировать сообщение");
    }
  }

  async function rosskoSearch(pid: string, it: RestockItem, queryOverride?: string): Promise<RosskoOffer[]> {
    setRosskoState((prev) => ({
      ...prev,
      [pid]: { ...(prev[pid] ?? {}), open: true, loading: true, error: "", status: "loading" },
    }));
    try {
      const candidates = rosskoQueryCandidates(it, queryOverride);
      if (!candidates.length) throw new Error("text должен быть не короче 2 символов");
      const cache = loadJson<Record<string, { ts: number; raw: RosskoOffer[] }>>(LS_ROSSKO_CACHE, {});

      async function fetchNormalized(text: string): Promise<RosskoOffer[]> {
        const u = new URL("/api/rossko/search", window.location.origin);
        u.searchParams.set("text", text);
        const res = await fetch(u.toString(), { headers: { Accept: "application/json" } });
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
        return normalizeSearchResult(data.data);
      }

      let shown: RosskoOffer[] = [];
      let lastError: unknown = null;
      let successfulAttempts = 0;
      for (const query of candidates) {
        try {
          const cacheKey = `${pid}||${query.toLowerCase()}`;
          let raw = cache[cacheKey]?.ts && Date.now() - cache[cacheKey].ts < 24 * 60 * 60 * 1000 ? cache[cacheKey].raw : null;
          if (!raw) {
            raw = await fetchNormalized(query);
            cache[cacheKey] = { ts: Date.now(), raw };
            saveJson(LS_ROSSKO_CACHE, cache);
          }
          successfulAttempts += 1;
          shown = finalizeRosskoOffers(raw, it);
          if (shown.length) break;
        } catch (candidateError) {
          lastError = candidateError;
          console.warn("ROSSKO search candidate failed", { productId: pid, query, error: candidateError });
        }
      }
      if (!successfulAttempts && lastError) throw lastError;

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
      return shown;
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
      return [];
    }
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

  async function buildQuickOrderPreview() {
    const rows = filteredItems.filter((item) => {
      const route = routeByProduct.get(item.productId);
      const coverage = coverageByProduct.get(item.productId);
      return route?.mode === "rossko_only" && !excluded[item.productId] && (coverage?.remaining ?? 0) > 0;
    });
    if (!rows.length || quickBusy) {
      showToast("Нет позиций ROSSKO, которые нужно заказать сейчас");
      return;
    }
    setQuickBusy(true);
    setRosskoBulk({ active: true, current: 0, total: rows.length });
    const previewRows: QuickOrderItem[] = [];
    for (let index = 0; index < rows.length; index += 1) {
      const item = rows[index];
      const coverage = coverageByProduct.get(item.productId) ?? coverageForItem(item, 0, []);
      setRosskoBulk({ active: true, current: index + 1, total: rows.length });
      const current = rosskoState[item.productId];
      const results = current?.results?.length ? current.results : await rosskoSearch(item.productId, item);
      previewRows.push(quickOrderItem(item, coverage, results));
    }
    setRosskoBulk({ active: false, current: rows.length, total: rows.length });
    setQuickPreview({ createdAt: Date.now(), items: previewRows });
    setQuickBusy(false);
  }

  function updateQuickPreviewItem(productId: string, patch: Partial<Pick<QuickOrderItem, "included" | "quantity">>) {
    setQuickPreview((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        items: prev.items.map((item) => {
          if (item.productId !== productId) return item;
          const max = item.availableFromOffer ?? Math.ceil(item.remaining);
          const quantity = patch.quantity === undefined ? item.quantity : Math.max(1, Math.min(Math.floor(patch.quantity || 1), Math.max(1, max)));
          return { ...item, ...patch, quantity };
        }),
      };
    });
  }

  async function saveQuickMinimum(productId: string, minimumBalance: number) {
    const response = await fetch(`/api/local-inventory/products/${encodeURIComponent(productId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ minimumBalance }),
    });
    const product = await response.json().catch(() => null);
    if (!response.ok || typeof product?.minimumBalance !== "number") {
      throw new Error(product?.error || "Не удалось сохранить минимальный остаток");
    }
    const savedMinimum: number = product.minimumBalance;
    const withMinimum = (item: RestockItem) => ({
      ...item,
      minimumBalance: savedMinimum,
      shortage: Math.max(0, savedMinimum - item.stock),
    });
    setItems((current) => current.map((item) => item.productId === productId ? withMinimum(item) : item));
    const source = items.find((item) => item.productId === productId);
    if (source) {
      const updated = withMinimum(source);
      const coverage = coverageForItem(updated, cartQtyByProduct.get(productId) ?? 0, orderedLinesByProduct.get(productId) ?? []);
      setQuickPreview((current) => current && ({
        ...current,
        items: current.items.map((item) => {
          if (item.productId !== productId) return item;
          const next = quickOrderItem(updated, coverage, rosskoState[productId]?.results);
          return { ...next, included: next.included && (item.included || item.status === "covered") };
        }),
      }));
    }
    showToast("Минимальный остаток сохранён");
  }

  function applyQuickOrderPreview() {
    if (!quickPreview) return;
    let added = 0;
    for (const item of quickPreview.items) {
      if (!item.included || !item.offer || !item.stock || item.quantity <= 0) continue;
      addRosskoToCart(
        {
          productId: item.productId,
          title: item.title,
          code: item.code,
          partnumber: item.offer.partnumber,
          brand: item.offer.brand,
          stock: item.stock.id,
          count: item.quantity,
          price: item.price,
          delivery: item.delivery,
          available: item.availableFromOffer,
          city: item.stock.city,
          offerName: item.offer.name,
        },
        true
      );
      added += 1;
    }
    setQuickPreview(null);
    showToast(added ? `В корзину добавлено ${added} позиций` : "Нет выбранных позиций для добавления");
  }

  function offerQty(key: string, it: RestockItem, stock: RosskoStock): number {
    const saved = showSpend ? Number(dailyQtyDrafts[`${usageDate?.key}:offer:${key}`]) : rosskoOfferQty[key];
    const available = stockCount(stock);
    const wanted = Math.max(1, Math.ceil(coverageByProduct.get(it.productId)?.remaining || defaultQty(it)));
    const fallback = available !== null ? Math.min(wanted, Math.max(1, Math.floor(available))) : wanted;
    const qty = typeof saved === "number" && saved > 0 ? Math.floor(saved) : fallback;
    if (available !== null) return Math.min(Math.max(1, qty), Math.max(1, Math.floor(available)));
    return Math.max(1, qty);
  }

  function setOfferQtyValue(key: string, value: number) {
    const quantity = Math.max(1, Math.floor(value || 1));
    if (showSpend) {
      setDailyQtyDrafts((drafts) => ({ ...drafts, [`${usageDate?.key}:offer:${key}`]: String(quantity) }));
      return;
    }
    const next = { ...rosskoOfferQty, [key]: quantity };
    persistRosskoOfferQty(next);
  }

  function addRosskoToCart(line: RosskoCartLine, silent = false) {
    const key = cartKey(line);
    setRosskoAddState((prev) => ({ ...prev, [key]: "loading" }));
    setRosskoCart((prev) => {
      const next = [...prev];
      const idx = next.findIndex((x) => cartKey(x) === cartKey(line));
      if (idx >= 0) {
        const maxAvailable = line.available ?? next[idx].available ?? null;
        const nextCount = Math.max(1, Number(next[idx].count || 1) + Number(line.count || 1));
        next[idx] = {
          ...next[idx],
          ...line,
          count: maxAvailable !== null ? Math.min(nextCount, maxAvailable) : nextCount,
          orderId: "",
          orderedAt: undefined,
          remoteStatus: undefined,
        };
      } else {
        next.push({ ...line, orderId: "", orderedAt: undefined, remoteStatus: undefined });
      }
      const normalized = normalizeRosskoCart(next);
      saveJson(LS_ROSSKO_CART, normalized);
      return normalized;
    });
    window.setTimeout(() => {
      setRosskoAddState((prev) => ({ ...prev, [key]: "success" }));
    }, 120);
    if (!silent) showToast("Позиция добавлена в корзину ROSSKO");
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

  async function checkoutRosskoCart() {
      const lines = rosskoCart
      .map((x) => ({
        partnumber: x.partnumber,
        brand: x.brand,
        stock: x.stock,
        count: Math.max(1, Math.floor(Number(x.count || 1))),
        comment: String(x.code || "").slice(0, 50),
        productId: x.productId,
        title: x.title,
        offerName: x.offerName,
        delivery: x.delivery,
        price: x.price,
        expectedAt: expectedAtFromDelivery(x.delivery),
      }))
      .filter((x) => x.partnumber && x.brand && x.stock && x.count > 0);
    if (!lines.length) return;

    setCheckoutBusy(true);
    try {
      const res = await fetch("/api/rossko/order", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          comment: `Заказ из Пополнение остатков (${toServiceDateInput(new Date())})`,
          contact_name: DEFAULT_RSSK_CONTACT_NAME,
          contact_phone: DEFAULT_RSSK_CONTACT_PHONE,
          parts: lines,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      const orderId = extractRosskoOrderId(data.data);
      const orderedAt = Date.now();
      const localOrderId = orderId ? `rossko_order:${orderId}` : uuidLike("rossko_order");
      const linesForOrder: SupplierOrderLine[] = rosskoCart.map((line, index) => {
        const count = Math.max(1, Math.floor(Number(line.count || 1)));
        return {
          ...line,
          id: `${localOrderId}:pending:${index + 1}`,
          orderId: localOrderId,
          externalOrderId: orderId,
          supplier: "ROSSKO" as const,
          orderedQty: count,
          receivedQty: 0,
          remainingQty: count,
          status: "ordered" as const,
          orderedAt,
          remoteStatus: "ordered" as const,
          expectedAt: expectedAtFromDelivery(line.delivery, orderedAt),
        };
      });
      const supplierOrder: SupplierOrder = {
        id: localOrderId,
        supplier: "ROSSKO",
        supplierType: "ROSSKO",
        externalOrderId: orderId,
        status: "ordered",
        createdAt: orderedAt,
        orderedAt,
        expectedAt: linesForOrder.map((line) => line.expectedAt).filter((x): x is number => typeof x === "number").sort((a, b) => a - b)[0],
        lines: linesForOrder,
        comment: `Заказ из Пополнение остатков (${toServiceDateInput(new Date())})`,
      };
      persistRosskoOrders([supplierOrder, ...rosskoOrders]);
      await loadServerIncomingOrders([supplierOrder, ...rosskoOrders], true);
      persistRosskoCart([]);
      setCartOpen(false);
      showToast(`Заказ ROSSKO сформирован${orderId ? ` #${orderId}` : ""}`);
    } catch (e) {
      console.warn("ROSSKO checkout failed", e);
      showToast(e instanceof Error ? e.message : "Не удалось сформировать заказ ROSSKO");
    } finally {
      setCheckoutBusy(false);
    }
  }

  return (
    <div className="eco-restock-page">
      <KitTabs section="restock" />
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
          </div>
        </div>
        <div className="eco-page-actions eco-restock-head-actions">
          {(isRosskoMode || rosskoCartTotal > 0) && (
            <EcoButton type="button" onClick={() => setCartOpen(true)}>
              <ShoppingCart size={15} />
              Корзина ROSSKO{rosskoCartTotal > 0 && <span className="eco-restock-count">{rosskoCartTotal}</span>}
            </EcoButton>
          )}
          <EcoButton type="button" variant="ghost" onClick={() => setSettingsOpen(true)}>
            <Settings2 size={15} />
            О данных
          </EcoButton>
        </div>
      </section>

      <section className="eco-restock-source" aria-label="Что пополнить">
        <div className="eco-restock-mode-group" role="group" aria-label="Режим пополнения">
          {([
            { id: "below_min", title: "Ниже минимума", hint: "Товары, которых не хватает на складе", icon: PackageSearch },
            { id: "daily_usage", title: "Расход за сегодня", hint: "Товары из отгрузок и списаний", icon: ClipboardList },
          ] as const).map(({ id, title, hint, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                if (id === mode) return;
                setLoading(true);
                setItems([]);
                setMessageText("");
                setMode(id);
              }}
              disabled={quickBusy}
              aria-pressed={mode === id}
              className="eco-restock-mode"
            >
              <Icon size={18} aria-hidden="true" />
              <span><strong>{title}</strong><small>{hint}</small></span>
              {mode === id && <CheckCircle2 size={16} className="eco-restock-mode-check" aria-hidden="true" />}
            </button>
          ))}
        </div>
        <EcoButton type="button" onClick={() => void loadRestock(mode, true)} disabled={loading || quickBusy}>
          <RefreshCw size={15} />
          Обновить список
        </EcoButton>
      </section>

      <div id="restock-selection" className="eco-restock-category-tabs" role="group" aria-label="Категории закупки">
        {procurementTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            aria-pressed={procurementCategory === tab.id}
            className={`eco-restock-category-tab ${procurementCategory === tab.id ? "is-active" : ""}`}
            onClick={() => {
              setProcurementCategory(tab.id);
              setSelectedChannel("all");
            }}
          >
            <span>{tab.label}</span>
            <span className="eco-restock-count">{tab.count}</span>
          </button>
        ))}
      </div>

      <div className={`eco-restock-layout ${sidebarCollapsed ? "is-sidebar-collapsed" : ""}`}>
      <aside className="eco-restock-sidebar">
        <label className="eco-restock-channel-select">
          <span>{sidebarTitle}</span>
          <EcoSelect value={selectedChannel} onChange={(event) => setSelectedChannel(event.target.value)}>
            {channelStats.map((channel) => (
              <option key={channel.name} value={channel.name}>{channel.label} ({channel.count})</option>
            ))}
          </EcoSelect>
        </label>
        <div className="eco-filter-rail eco-restock-rail">
          <div className="eco-restock-rail-head">
            {!sidebarCollapsed && <span>{sidebarTitle}</span>}
            <button
              type="button"
              className="eco-restock-sidebar-toggle"
              onClick={() => setSidebarCollapsed((value) => !value)}
              aria-expanded={!sidebarCollapsed}
              aria-label={sidebarCollapsed ? "Показать каналы" : "Свернуть каналы"}
              title={sidebarCollapsed ? "Показать каналы" : "Свернуть каналы"}
            >
              {sidebarCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
            </button>
          </div>
          {!sidebarCollapsed && (
            <>
              <div className="eco-restock-supplier-list">
                {channelStats.map((supplier) => (
                  <button
                    key={supplier.name}
                    type="button"
                    onClick={() => setSelectedChannel(supplier.name)}
                    aria-pressed={selectedChannel === supplier.name}
                    className={`eco-restock-supplier-btn ${selectedChannel === supplier.name ? "is-active" : ""}`}
                  >
                    <span>{supplier.label}</span>
                    <em>{supplier.count}</em>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </aside>

      <section id="restock-position-workspace" className="eco-restock-main" aria-labelledby="restock-position-title">
        <div className="eco-table-toolbar eco-restock-toolbar">
          <div className="eco-restock-toolbar__title">
            <h2 id="restock-position-title">{isSetupMode ? "Требуют настройки" : showSpend ? "Что израсходовали" : "Позиции ниже минимума"}</h2>
            <span>
              {usageDate && `${usageDate.label} · `}{selectedChannelLabel} · Позиций: {filteredItems.length}
            </span>
            {isSetupMode && <span>Откройте товар, чтобы указать категорию или поставщика.</span>}
            {!isRosskoMode && !isSetupMode && !isSupplierMessageMode && (
              <span>Выберите поставщика, чтобы сформировать заказ.</span>
            )}
          </div>
          {isRosskoMode && (
            <EcoButton
              type="button"
              variant="primary"
              onClick={() => void buildQuickOrderPreview()}
              disabled={loading || quickBusy || rosskoBulk.active || incomingLoading || !filteredItems.length || rosskoHealth.status === "error"}
            >
              {quickBusy ? <Loader2 size={15} className="eco-spin" /> : <PackageCheck size={15} />}
              Подобрать для заказа
            </EcoButton>
          )}
          {isSupplierMessageMode && (
            <EcoButton type="button" variant="primary" onClick={() => {
              buildMessage();
              document.getElementById("restock-supplier-message")?.scrollIntoView({ block: "start" });
            }} disabled={!canBuildMessage}>
              <FilePlus2 size={15} />
              Сформировать сообщение
            </EcoButton>
          )}
        </div>

        {error && (
          <div className="eco-restock-alert is-error">
            <AlertTriangle size={17} />
            <span>{error}</span>
          </div>
        )}

        {loading && (
          <div className="eco-restock-loading">
            <Loader2 size={18} className="eco-spin" />
            <span>Загружаем товары…</span>
          </div>
        )}

        {!loading && !error && items.length === 0 && (
          <div className="eco-restock-empty-state">
            <PackageSearch size={28} />
            <strong>{showSpend ? "Сегодня ещё нет проведённого расхода" : "Нет товаров ниже минимума"}</strong>
          </div>
        )}

        {!loading && items.length > 0 && isRosskoMode && (
          <div className="eco-restock-flow-stack">
            <div className="eco-restock-incoming-strip">
              <span className="eco-restock-incoming-needed">
                К заказу <b>{fmtNum(filteredItems.reduce((sum, item) => sum + (coverageByProduct.get(item.productId)?.remaining ?? 0), 0))}</b>
              </span>
              <span>В пути <b>{fmtNum(incomingSummary.total)}</b></span>
              <span>На сегодня <b>{fmtNum(incomingSummary.today)}</b></span>
              <span>На завтра <b>{fmtNum(incomingSummary.tomorrow)}</b></span>
              <span>Позже <b>{fmtNum(incomingSummary.later)}</b></span>
              {!!incomingSummary.overdue && <strong>Просрочено {fmtNum(incomingSummary.overdue)}</strong>}
              <Link className="eco-restock-orders-link" href="/inventory/receipts?rossko=1">Заказы ROSSKO</Link>
              <button
                type="button"
                onClick={() => void loadServerIncomingOrders([], true)}
                disabled={incomingLoading}
                aria-label="Обновить статусы заказов ROSSKO"
                title="Обновить статусы заказов ROSSKO"
              >
                {incomingLoading ? <Loader2 size={13} className="eco-spin" /> : <RefreshCw size={13} />}
                {incomingUpdatedAt ? `Статусы: ${fmtTime(new Date(incomingUpdatedAt).getTime())}` : "Обновить статусы заказов"}
              </button>
              {rosskoHealth.status === "ok" && (
                <button type="button" onClick={() => void bulkRosskoSearch()} disabled={!filteredItems.length || rosskoBulk.active}>
                  <PackageSearch size={13} />
                  Проверить наличие
                </button>
              )}
            </div>
            {(rosskoHealth.status !== "ok" || rosskoBulk.active) && (
              <RosskoStatusPanel health={rosskoHealth} bulk={rosskoBulk} onRetry={() => void checkRosskoApi()} />
            )}
            <RosskoItemsTable
              grouped={grouped}
              showSpend={showSpend}
              orderStatusesByProduct={orderStatusesByProduct}
              rosskoState={rosskoState}
              cartQtyByProduct={cartQtyByProduct}
              coverageByProduct={coverageByProduct}
              refreshRossko={(pid, it, query) => void rosskoSearch(pid, it, query)}
              openOffers={(pid) => setOfferDrawerProductId(pid)}
              apiUnavailable={rosskoHealth.status === "error"}
            />
          </div>
        )}

        {!loading && items.length > 0 && isSetupMode && (
          <SetupItemsTable
            grouped={grouped}
            showSpend={showSpend}
            excluded={excluded}
            toggleExcluded={toggleExcluded}
            routeByProduct={routeByProduct}
            rosskoState={rosskoState}
          />
        )}

        {!loading && items.length > 0 && !isRosskoMode && !isSetupMode && (
          <div className="eco-restock-flow-stack">
            <ItemsTable
              supplier={selectedChannelLabel}
              grouped={grouped}
              showSpend={showSpend}
              inputQty={(pid, item) => showSpend ? dailyQtyDrafts[`${usageDate?.key}:${pid}`] ?? ensureQty(pid, item) : ensureQty(pid, item)}
              setQty={setQty}
              excluded={excluded}
              toggleExcluded={toggleExcluded}
              readOnly={!isSupplierMessageMode}
            />
            <section id="restock-supplier-message" className="eco-restock-message-panel">
              <div className="eco-restock-message-head">
                <div>
                  <span>Сообщение поставщику</span>
                  <strong>{isSupplierMessageMode ? selectedChannelLabel : "Выберите поставщика"}</strong>
                </div>
                <div className="eco-restock-message-actions">
                  <EcoButton
                    type="button"
                    onClick={buildMessage}
                    disabled={!canBuildMessage}
                    title={!canBuildMessage ? "Нет включённых позиций к заказу" : undefined}
                    variant="primary"
                  >
                    <FilePlus2 size={15} />
                    Сформировать сообщение
                  </EcoButton>
                  <EcoButton
                    type="button"
                    onClick={() => void copyMessage()}
                    disabled={!canBuildMessage}
                    title={!canBuildMessage ? "Сначала включите хотя бы одну позицию" : undefined}
                  >
                    <Copy size={15} />
                    Копировать
                  </EcoButton>
                </div>
              </div>
              {messageText ? (
                <textarea
                  readOnly
                  value={messageText}
                  rows={10}
                  className="eco-restock-message-preview"
                  aria-label="Предпросмотр сообщения поставщику"
                />
              ) : (
                <div className="eco-restock-message-empty">
                  <strong>Сообщение ещё не сформировано</strong>
                  <span>
                    {isSupplierMessageMode
                      ? "Проверьте количество, исключите лишние строки и нажмите «Сформировать сообщение»."
                      : "Выберите поставщика внутри категории, чтобы подготовить заказ."}
                  </span>
                </div>
              )}
            </section>
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
          onClose={() => setCartOpen(false)}
          onQty={updateCartQty}
          onDelete={(idx) => persistRosskoCart(rosskoCart.filter((_, i) => i !== idx))}
          onClear={() => persistRosskoCart([])}
          onReplace={replaceRosskoOffer}
          onCheckout={() => void checkoutRosskoCart()}
        />
      )}

      {offerDrawerItem && (
        <RosskoOffersDrawer
          item={offerDrawerItem}
          state={rosskoState[offerDrawerItem.productId] ?? {}}
          cartQtyByOffer={cartQtyByOffer}
          offerQty={offerQty}
          setOfferQty={setOfferQtyValue}
          addState={rosskoAddState}
          manualQuery={rosskoManualQuery[offerDrawerItem.productId] ?? ""}
          setManualQuery={(pid, value) => setRosskoManualQuery((prev) => ({ ...prev, [pid]: value }))}
          refreshRossko={(pid, it, query) => void rosskoSearch(pid, it, query)}
          addToCart={addRosskoToCart}
          onClose={() => setOfferDrawerProductId(null)}
        />
      )}

      {quickPreview && (
        <QuickOrderPreviewDrawer
          preview={quickPreview}
          onClose={() => setQuickPreview(null)}
          onUpdate={updateQuickPreviewItem}
          onSaveMinimum={saveQuickMinimum}
          onApply={applyQuickOrderPreview}
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
          className="eco-restock-modal-backdrop"
          aria-label="Закрыть"
          onClick={() => setSettingsOpen(false)}
        />
      )}
      {settingsOpen && (
        <div className="eco-restock-info-modal" role="dialog" aria-modal="true" aria-labelledby="restock-info-title">
          <header>
            <div>
              <span>Источник расчёта</span>
              <h2 id="restock-info-title">О данных пополнения</h2>
            </div>
            <button type="button" className="eco-icon-btn" onClick={() => setSettingsOpen(false)} aria-label="Закрыть">
              <X size={18} />
            </button>
          </header>
          <ul>
            <li>«Ниже минимума» показывает товары, у которых доступный остаток меньше установленного минимума.</li>
            <li>«Расход за сегодня» показывает количество из проведённых отгрузок и списаний за текущий день по времени сервиса.</li>
            <li>При подборе ROSSKO из расхода вычитаются товары в корзине и позиции из сегодняшних заказов, которые ещё ждут или уже приняли.</li>
            <li>Для других поставщиков раздел готовит сообщение. Его можно скопировать и отправить поставщику.</li>
          </ul>
          <footer>
            <EcoButton type="button" variant="primary" onClick={() => setSettingsOpen(false)}>
              Понятно
            </EcoButton>
          </footer>
        </div>
      )}
    </div>
  );
}

function QuickOrderPreviewDrawer({
  preview,
  onClose,
  onUpdate,
  onSaveMinimum,
  onApply,
}: {
  preview: QuickOrderPreview;
  onClose: () => void;
  onUpdate: (productId: string, patch: Partial<Pick<QuickOrderItem, "included" | "quantity">>) => void;
  onSaveMinimum: (productId: string, value: number) => Promise<void>;
  onApply: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [minimumInput, setMinimumInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  async function saveMinimum(item: QuickOrderItem) {
    if (saving) return;
    const value = minimumInput.trim().replace(",", ".");
    if (!/^\d{1,11}(?:\.\d{1,3})?$/.test(value)) {
      setSaveError("Введите число от 0 с точностью до трёх знаков после запятой.");
      return;
    }
    const minimum = Number(value);
    if (minimum === item.minimum) {
      setEditingId(null);
      return;
    }
    setSaving(true);
    setSaveError("");
    try {
      await onSaveMinimum(item.productId, minimum);
      setEditingId(null);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Не удалось сохранить минимальный остаток");
    } finally {
      setSaving(false);
    }
  }

  function startEditing(item: QuickOrderItem) {
    setMinimumInput(String(item.minimum));
    setSaveError("");
    setEditingId(item.productId);
  }

  const ready = preview.items.filter((item) => item.included && item.offer && item.quantity > 0);
  const sum = ready.reduce((total, item) => total + Math.max(0, item.quantity) * Math.max(0, Number(item.price || 0)), 0);
  const noOffers = preview.items.filter((item) => item.status === "no_offer").length;
  return (
    <div className="eco-restock-cart-shell" role="presentation">
      <button type="button" className="eco-restock-cart-backdrop" aria-label="Закрыть быстрый заказ" onClick={onClose} disabled={saving} />
      <aside className="eco-restock-cart-drawer eco-restock-quick-drawer" role="dialog" aria-modal="true" aria-label="Предварительный заказ фильтров">
        <header className="eco-restock-cart-head">
          <div>
            <span>Предварительный заказ фильтров</span>
            <h2>Быстрый заказ ROSSKO</h2>
            <p>{ready.length} к добавлению · {noOffers} без предложения · сумма {fmtMoney(sum)} ₽</p>
          </div>
          <button type="button" className="eco-icon-btn" onClick={onClose} disabled={saving} aria-label="Закрыть">
            <X size={18} />
          </button>
        </header>
        <div className="eco-restock-cart-body">
          <div className="eco-restock-quick-list">
            {preview.items.map((item) => (
              <article key={item.productId} className={`eco-restock-quick-line ${styles.line} ${item.included ? "is-included" : ""}`}>
                <label className="eco-restock-quick-line__check">
                  <input
                    type="checkbox"
                    checked={item.included}
                    disabled={!item.offer || saving}
                    onChange={(event) => onUpdate(item.productId, { included: event.target.checked })}
                  />
                </label>
                <div className="eco-restock-quick-line__main">
                  <strong>{item.title}</strong>
                  <span>{item.code || "без кода"} · остаток {fmtNum(item.available)} · мин. {fmtNum(item.minimum)} · заказано {fmtNum(item.ordered)} · осталось {fmtNum(item.remaining)}</span>
                  <em>{item.message}</em>
                  {editingId !== item.productId && (
                    <EcoButton type="button" size="sm" variant="ghost" disabled={editingId !== null} aria-label={`Изменить минимум: ${item.title}`} onClick={() => startEditing(item)}>
                      Изменить минимум
                    </EcoButton>
                  )}
                </div>
                <div className="eco-restock-quick-line__offer">
                  {item.offer && item.stock ? (
                    <>
                      <b>{item.offer.brand} {item.offer.partnumber}</b>
                      <span>{fmtMoney(item.price)} ₽ · {item.delivery} · наличие {fmtNum(item.availableFromOffer)}</span>
                    </>
                  ) : (
                    <span>Предложение не выбрано</span>
                  )}
                </div>
                <EcoInput
                  type="number"
                  min={1}
                  max={item.availableFromOffer ?? Math.ceil(item.remaining)}
                  value={item.quantity || ""}
                  placeholder="—"
                  disabled={!item.offer || !item.included || saving}
                  onChange={(event) => onUpdate(item.productId, { quantity: parseInt(event.target.value, 10) || 1 })}
                  aria-label="Количество к заказу"
                />
                {editingId === item.productId && (
                  <form className={styles.minimumForm} onSubmit={(event) => {
                    event.preventDefault();
                    void saveMinimum(item);
                  }}>
                    <label>
                      Минимальный остаток, шт.
                      <EcoInput
                        autoFocus
                        inputMode="decimal"
                        value={minimumInput}
                        onChange={(event) => setMinimumInput(event.target.value)}
                        readOnly={saving}
                        aria-invalid={Boolean(saveError)}
                      />
                    </label>
                    <EcoButton type="submit" size="sm" variant="primary" disabled={saving}>
                      {saving ? "Сохраняем…" : "Сохранить"}
                    </EcoButton>
                    <EcoButton type="button" size="sm" disabled={saving} onClick={() => setEditingId(null)}>
                      Отмена
                    </EcoButton>
                    {saveError && <p role="alert">{saveError}</p>}
                  </form>
                )}
              </article>
            ))}
          </div>
        </div>
        <footer className="eco-restock-cart-footer">
          <EcoButton type="button" onClick={onClose} disabled={saving}>Отмена</EcoButton>
          <EcoButton type="button" variant="primary" onClick={onApply} disabled={!ready.length || editingId !== null}>
            <ShoppingCart size={15} />
            Добавить выбранное в корзину
          </EcoButton>
        </footer>
      </aside>
    </div>
  );
}


function RosskoStatusPanel({
  health,
  bulk,
  onRetry,
}: {
  health: RosskoHealth;
  bulk: RosskoBulkState;
  onRetry: () => void;
}) {
  const ok = health.status === "ok";
  const checking = health.status === "checking";
  return (
    <section className={`eco-restock-rossko-status ${ok || checking ? "is-ok" : "is-error"}`}>
      <div className="eco-restock-rossko-status__icon">
        {checking ? <Loader2 size={18} className="eco-spin" /> : ok ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
      </div>
      <div className="eco-restock-rossko-status__body">
        <strong>{checking ? "Проверяем связь с ROSSKO…" : ok ? "ROSSKO подключён" : "ROSSKO недоступен"}</strong>
        {!ok && !checking && <span>Попробуйте повторить проверку.</span>}
        {bulk.active && (
          <div className="eco-restock-rossko-progress">
            <span>Проверяем {bulk.current} из {bulk.total}…</span>
            <div><i style={{ width: `${bulk.total ? Math.round((bulk.current / bulk.total) * 100) : 0}%` }} /></div>
          </div>
        )}
      </div>
      {!ok && !checking && (
        <div className="eco-restock-rossko-status__actions">
          <EcoButton type="button" onClick={onRetry} size="sm">
            <RefreshCw size={14} />
            Повторить проверку
          </EcoButton>
        </div>
      )}
    </section>
  );
}

function RosskoCartDrawer({
  lines,
  totalQty,
  totalSum,
  checkoutBusy,
  onClose,
  onQty,
  onDelete,
  onClear,
  onReplace,
  onCheckout,
}: {
  lines: RosskoCartLine[];
  totalQty: number;
  totalSum: number;
  checkoutBusy: boolean;
  onClose: () => void;
  onQty: (idx: number, count: number) => void;
  onDelete: (idx: number) => void;
  onClear: () => void;
  onReplace: (line: RosskoCartLine) => void;
  onCheckout: () => void;
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
                      <span>
                        {line.stock}{line.city ? ` · ${line.city}` : ""}
                        {line.orderId ? ` · заказ #${line.orderId}` : ""}
                      </span>
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

function bestOffer(results: RosskoOffer[] | undefined, item: RestockItem, requestedQty?: number) {
  const rows = flattenedOffers(results);
  if (!rows.length) return null;
  const need = Math.max(1, Math.floor(requestedQty || defaultQty(item)));
  return [...rows].sort((a, b) => {
    const aCount = stockCount(a.stock);
    const bCount = stockCount(b.stock);
    const aEnough = aCount !== null && aCount >= need ? 0 : 1;
    const bEnough = bCount !== null && bCount >= need ? 0 : 1;
    if (aEnough !== bEnough) return aEnough - bEnough;
    const delivery = deliveryRank(a.stock) - deliveryRank(b.stock);
    if (delivery !== 0) return delivery;
    const aPrice = stockPrice(a.stock) ?? Number.MAX_SAFE_INTEGER;
    const bPrice = stockPrice(b.stock) ?? Number.MAX_SAFE_INTEGER;
    return aPrice - bPrice;
  })[0];
}

function quickOrderItem(item: RestockItem, coverage: ProcurementCoverage, results?: RosskoOffer[]): QuickOrderItem {
  const remaining = coverage.min > 0 ? Number(coverage.remaining.toFixed(3)) : 0;
  const needed = Math.ceil(remaining);
  const picked = needed > 0 ? bestOffer(results, item, needed) : null;
  const availableFromOffer = picked ? stockCount(picked.stock) : null;
  const quantity = picked ? Math.max(0, Math.min(needed, Math.floor(availableFromOffer ?? needed))) : 0;
  const status = needed === 0 ? "covered" : quantity === 0 ? "no_offer" : quantity < needed ? "partial" : "ready";
  const messages = {
    covered: "Пополнение не требуется",
    no_offer: "Нет предложения ROSSKO с наличием",
    partial: `Закроет частично: доступно ${fmtNum(quantity)} из ${fmtNum(needed)}`,
    ready: "Готово к добавлению",
  };
  return {
    productId: item.productId,
    title: String(item.name ?? "Товар"),
    code: String(item.code ?? ""),
    available: coverage.available,
    minimum: coverage.min,
    ordered: coverage.ordered,
    remaining,
    quantity,
    included: quantity > 0,
    status,
    message: messages[status],
    offer: quantity > 0 ? picked?.offer : undefined,
    stock: quantity > 0 ? picked?.stock : undefined,
    price: picked ? stockPrice(picked.stock) : null,
    delivery: picked ? deliveryLabel(picked.stock) : "—",
    availableFromOffer,
  };
}

function bestOfferLabel(results: RosskoOffer[] | undefined, item: RestockItem, requestedQty?: number): string {
  const best = bestOffer(results, item, requestedQty);
  if (!best) return "—";
  const count = stockCount(best.stock);
  return `${fmtMoney(stockPrice(best.stock))} ₽ · ${deliveryLabel(best.stock)} · ${fmtNum(count)} шт`;
}

function RosskoOffersDrawer({
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
  onClose,
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
  addToCart: (line: RosskoCartLine) => void | Promise<void>;
  onClose: () => void;
}) {
  return (
    <div className="eco-restock-cart-shell" role="presentation">
      <button type="button" className="eco-restock-cart-backdrop" aria-label="Закрыть предложения" onClick={onClose} />
      <aside className="eco-restock-cart-drawer eco-restock-offers-drawer" role="dialog" aria-modal="true" aria-label="Предложения ROSSKO">
        <header className="eco-restock-cart-head">
          <div>
            <span>Предложения ROSSKO</span>
            <h2>{item.name ?? "Товар"}</h2>
            <p>{item.code || "без кода"} · дефицит {fmtNum(item.shortage)}</p>
          </div>
          <button type="button" className="eco-icon-btn" onClick={onClose} aria-label="Закрыть">
            <X size={18} />
          </button>
        </header>
        <div className="eco-restock-cart-body">
          <RosskoOfferPanel
            item={item}
            state={state}
            cartQtyByOffer={cartQtyByOffer}
            offerQty={offerQty}
            setOfferQty={setOfferQty}
            addState={addState}
            manualQuery={manualQuery}
            setManualQuery={setManualQuery}
            refreshRossko={refreshRossko}
            addToCart={addToCart}
          />
        </div>
      </aside>
    </div>
  );
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
  addToCart: (line: RosskoCartLine) => void | Promise<void>;
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
          <table className="eco-restock-offers-table" aria-label="Предложения ROSSKO по складам">
            <colgroup>
              <col className="eco-restock-offers-col--brand" />
              <col className="eco-restock-offers-col--article" />
              <col />
              <col className="eco-restock-offers-col--delivery" />
              <col className="eco-restock-offers-col--stock" />
              <col className="eco-restock-offers-col--price" />
              <col className="eco-restock-offers-col--order" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Бренд</th>
                <th scope="col">Номер</th>
                <th scope="col">Наименование</th>
                <th scope="col">Доставим</th>
                <th scope="col">Остаток</th>
                <th scope="col">Цена, ₽</th>
                <th scope="col">К заказу</th>
              </tr>
            </thead>
            <tbody>
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
                const offerName = row.offer.name || item.name || "Товар без названия";
                const warning = qtyError
                  ? "Недостаточно наличия"
                  : insufficient ? `Доступно только ${fmtNum(count)} из ${fmtNum(shortage)}` : "";
                return (
                  <tr key={key} className={`eco-restock-offer ${inCart ? "is-selected" : ""}`}>
                    <td className="eco-restock-offer__brand" data-label="Бренд">
                      <span title={row.offer.brand || undefined}>{row.offer.brand || "—"}</span>
                    </td>
                    <td className="eco-restock-offer__article" data-label="Номер">
                      <span title={row.offer.partnumber || undefined}>{row.offer.partnumber || "—"}</span>
                    </td>
                    <td className="eco-restock-offer__name" data-label="Наименование">
                      <strong title={offerName}>{offerName}</strong>
                      {warning ? (
                        <p className="eco-restock-offer-warning" title={warning}>{warning}</p>
                      ) : (
                        <div className="eco-restock-offer__badges" title={badges.join(" · ") || undefined}>
                          {badges.map((badge) => <span key={badge}>{badge}</span>)}
                        </div>
                      )}
                    </td>
                    <td className="eco-restock-offer__delivery" data-label="Доставим">
                      <strong>{deliveryLabel(row.stock)}</strong>
                      <span title={row.stock.city || undefined}>{row.stock.city || "Склад ROSSKO"}</span>
                    </td>
                    <td className="eco-restock-offer__stock" data-label="Остаток">
                      {fmtNum(count)}{count !== null ? " шт." : ""}
                    </td>
                    <td className="eco-restock-offer__price" data-label="Цена, ₽">{fmtMoney(price)}</td>
                    <td className="eco-restock-offer__order" data-label="К заказу">
                      <div className="eco-restock-offer__buy">
                        <EcoInput
                          type="number"
                          min={1}
                          max={count ?? undefined}
                          step={1}
                          value={quantity}
                          onChange={(event) => setOfferQty(key, parseInt(event.target.value, 10) || 1)}
                          aria-label={`Количество ${row.offer.brand} ${row.offer.partnumber}, склад ${row.stock.id}`}
                          aria-invalid={qtyError || undefined}
                        />
                        <EcoButton
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={(!!stateKey && stateKey === "loading") || qtyError}
                          aria-label={stateKey === "loading" ? "Добавляем в корзину" : `В корзину: ${row.offer.brand} ${row.offer.partnumber}, склад ${row.stock.id}`}
                          title={inCart ? `В корзине ${inCart} шт. Добавить ещё` : "Добавить в корзину"}
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
                          {stateKey === "loading" ? <Loader2 size={18} className="eco-spin" /> : inCart ? <CheckCircle2 size={18} /> : <ShoppingCart size={18} />}
                        </EcoButton>
                      </div>
                      <span className="eco-restock-offer__cart-status" aria-live="polite">
                        {stateKey === "loading" ? "Добавляем…" : inCart ? `В корзине: ${inCart}` : ""}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RosskoItemsTable({
  grouped,
  showSpend,
  orderStatusesByProduct,
  rosskoState,
  cartQtyByProduct,
  coverageByProduct,
  refreshRossko,
  openOffers,
  apiUnavailable,
}: {
  grouped: [string, RestockItem[]][];
  showSpend: boolean;
  orderStatusesByProduct: Map<string, SupplierOrderLine[]>;
  rosskoState: Record<string, RosskoSearchState>;
  cartQtyByProduct: Map<string, number>;
  coverageByProduct: Map<string, ProcurementCoverage>;
  refreshRossko: (pid: string, it: RestockItem, query?: string) => void;
  openOffers: (pid: string) => void;
  apiUnavailable: boolean;
}) {
  if (grouped.length === 0) {
    return (
      <div className="eco-restock-empty-state">
        <PackageSearch size={28} />
        <strong>Нет позиций для ROSSKO</strong>
        <span>Проверьте mapping поставщика ROSSKO в карточках товаров текущего филиала.</span>
      </div>
    );
  }

  return (
    <div className="eco-restock-supplier-stack">
      {grouped.map(([groupName, rows]) => (
        <section key={groupName} className="eco-restock-table-section">
          <div className="eco-restock-group-label">{groupName}</div>
          <div className="eco-restock-table-wrap" tabIndex={0} role="region" aria-label={groupName}>
            <table className="eco-restock-rossko-table">
              <thead>
                <tr>
                  <th>Товар</th>
                  {showSpend && <th className="l-number">Расход сегодня</th>}
                  <th className="l-number">К заказу</th>
                  <th className="l-number">Остаток</th>
                  <th className="l-number">Мин.</th>
                  <th className="l-number">Дефицит</th>
                  <th>Заказы ROSSKO</th>
                  <th>Ожидается</th>
                  <th>Предложения ROSSKO</th>
                  <th>Действия</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((it) => {
                  const pid = it.productId;
                  const st = rosskoState[pid] ?? {};
                  const inCartQty = cartQtyByProduct.get(pid) ?? 0;
                  const coverage = coverageByProduct.get(pid) ?? coverageForItem(it, inCartQty, []);
                  const meta = statusLabel(st, inCartQty);
                  const hasResults = Boolean(st.results?.length);
                  const actionLabel = (() => {
                    if (apiUnavailable) return "Повторить проверку";
                    if (st.loading) return "Ищем…";
                    if (st.status === "error" || st.status === "not_found") return "Искать вручную";
                    if (hasResults) return "Выбрать";
                    return "Найти предложения";
                  })();
                  return (
                    <Fragment key={pid}>
                      <tr className={`eco-restock-product-row ${inCartQty ? "is-in-cart" : ""} ${coverage.remaining <= 0 ? "is-covered" : ""}`}>
                        <td className="eco-restock-product">
                          <strong>{it.name ?? "—"}</strong>
                          {it.code && <span className="l-mono">{it.code}</span>}
                        </td>
                        {showSpend && <td className="l-number eco-restock-table-emphasis">{fmtNum(it.spentInPeriod)} {it.unit || "шт."}</td>}
                        <td className="l-number">
                          {coverage.remaining > 0
                            ? <strong className="eco-restock-table-emphasis">{fmtNum(coverage.remaining)} шт.</strong>
                            : <span className="eco-restock-covered">Докупать не нужно</span>}
                          {inCartQty > 0 && <span className="eco-restock-in-cart">В корзине: {fmtNum(inCartQty)}</span>}
                        </td>
                        <td className="l-number">{fmtNum(it.stock)}</td>
                        <td className="l-number">{fmtNum(it.minimumBalance)}</td>
                        <td className="l-number is-shortage">{fmtNum(coverage.deficit)}</td>
                        <td className="eco-restock-expected-cell">
                          {coverage.ordered > 0 && <strong>В поставке: {fmtNum(coverage.ordered)} шт.</strong>}
                          {(orderStatusesByProduct.get(pid) ?? []).map((line) => (
                            <div key={`${line.orderId}:${line.id}`}>
                              {line.externalOrderId && <span>№{line.externalOrderId} · </span>}
                              {line.statusLabel || supplierOrderStatusLabels[line.status] || "Статус уточняется"}
                            </div>
                          ))}
                          {!orderStatusesByProduct.has(pid) && "—"}
                        </td>
                        <td className="eco-restock-expected-cell">{coverage.expectedLabel}</td>
                        <td>
                          <EcoBadge tone={meta.tone} dot={meta.tone === "success"}>
                            {meta.label}
                          </EcoBadge>
                          {hasResults && <span className="eco-restock-best-offer">{bestOfferLabel(st.results, it, coverage.remaining)}</span>}
                          {st.checkedAt && <span className="eco-restock-check-time">Проверено: {fmtTime(st.checkedAt)}</span>}
                        </td>
                        <td className="eco-restock-row-actions">
                          <EcoButton
                            type="button"
                            size="sm"
                            disabled={apiUnavailable || !!st.loading || (coverage.remaining <= 0 && !hasResults)}
                            onClick={() => {
                              if (hasResults || st.status === "error" || st.status === "not_found") openOffers(pid);
                              else refreshRossko(pid, it);
                            }}
                            variant="secondary"
                          >
                            {st.loading ? <Loader2 size={14} className="eco-spin" /> : hasResults ? <ChevronDown size={14} /> : <Search size={14} />}
                            {actionLabel}
                          </EcoButton>
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

function ItemsTable({
  supplier,
  grouped,
  showSpend,
  inputQty,
  setQty,
  excluded,
  toggleExcluded,
  readOnly,
}: {
  supplier: string;
  grouped: [string, RestockItem[]][];
  showSpend: boolean;
  inputQty: (pid: string, it: RestockItem) => number | string;
  setQty: (pid: string, it: RestockItem, value: string) => void;
  excluded: Record<string, boolean>;
  toggleExcluded: (pid: string) => void;
  readOnly: boolean;
}) {
  if (grouped.length === 0) {
    return (
      <div className="eco-restock-empty-state">
        <PackageSearch size={28} />
        <strong>Нет позиций для отображения</strong>
        <span>{showSpend ? "В этой выборке сегодня не было расхода." : "В этой выборке нет товаров ниже минимума."}</span>
      </div>
    );
  }

  return (
    <div className="eco-restock-supplier-stack">
      {grouped.map(([groupName, rows]) => (
        <section key={groupName} className="eco-restock-supplier-group">
          <header className="eco-restock-supplier-group__head">
            <div>
              <span>{supplier}</span>
              <strong>{groupName}</strong>
            </div>
            <div className="eco-restock-supplier-group__stats">
              <span>{rows.length} позиций</span>
              {!showSpend && <span>Дефицит {fmtNum(rows.reduce((sum, item) => sum + Math.max(0, Number(item.shortage ?? 0)), 0))}</span>}
            </div>
          </header>
          <div className="eco-restock-table-wrap" tabIndex={0} role="region" aria-label={groupName}>
            <table className="eco-restock-supplier-table">
              <thead>
                <tr>
                  <th>Товар</th>
                  {showSpend && <th className="l-number">Расход сегодня</th>}
                  <th>Код / артикул</th>
                  <th className="l-number">Остаток</th>
                  <th className="l-number">Мин.</th>
                  <th className="l-number">Дефицит</th>
                  {!readOnly && (
                    <>
                      <th className="l-number">К заказу</th>
                      <th>Вкл. / исключить</th>
                      <th>Действия</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((it) => {
                  const isExcluded = excluded[it.productId];
                  return (
                  <tr
                    key={it.productId}
                    className={`eco-restock-supplier-row ${isExcluded ? "is-excluded" : ""}`}
                  >
                    <td className="eco-restock-product">
                      <strong>{it.name ?? "—"}</strong>
                      {it.group && <span>{it.group}</span>}
                    </td>
                    {showSpend && <td className="l-number eco-restock-table-emphasis">{fmtNum(it.spentInPeriod)} {it.unit || "шт."}</td>}
                    <td className="l-mono">{it.code ?? "—"}</td>
                    <td className="l-number">{fmtNum(it.stock)}</td>
                    <td className="l-number">{fmtNum(it.minimumBalance)}</td>
                    <td className="l-number is-shortage">{fmtNum(it.shortage)}</td>
                    {!readOnly && (
                      <>
                        <td className="eco-restock-order-qty">
                          <EcoInput
                            type="number"
                            min={showSpend ? 0.001 : 1}
                            step={showSpend ? "any" : 1}
                            value={inputQty(it.productId, it)}
                            onChange={(e) => setQty(it.productId, it, e.target.value)}
                            disabled={isExcluded}
                            aria-label={`Количество к заказу: ${it.name ?? it.code ?? "товар"}`}
                          />
                        </td>
                        <td>
                          <EcoBadge tone={isExcluded ? "neutral" : "success"} dot={!isExcluded}>
                            {isExcluded ? "Исключено" : "Включено"}
                          </EcoBadge>
                        </td>
                        <td className="eco-restock-row-actions">
                          <EcoButton type="button" size="sm" onClick={() => toggleExcluded(it.productId)}>
                            {isExcluded ? "Вернуть" : "Исключить"}
                          </EcoButton>
                        </td>
                      </>
                    )}
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

function SetupItemsTable({
  grouped,
  showSpend,
  excluded,
  toggleExcluded,
  routeByProduct,
  rosskoState,
}: {
  grouped: [string, RestockItem[]][];
  showSpend: boolean;
  excluded: Record<string, boolean>;
  toggleExcluded: (pid: string) => void;
  routeByProduct: Map<string, ProcurementRoute>;
  rosskoState: Record<string, RosskoSearchState>;
}) {
  if (grouped.length === 0) {
    return (
      <div className="eco-restock-empty-state">
        <PackageCheck size={28} />
        <strong>Нет позиций, требующих настройки</strong>
        <span>Все товары в текущей выборке уже привязаны к понятному сценарию закупки.</span>
      </div>
    );
  }

  return (
    <div className="eco-restock-supplier-stack">
      {grouped.map(([groupName, rows]) => (
        <section key={groupName} className="eco-restock-supplier-group">
          <header className="eco-restock-supplier-group__head">
            <div>
              <span>Требуют настройки</span>
              <strong>{groupName}</strong>
            </div>
            <div className="eco-restock-supplier-group__stats">
              <span>{rows.length} позиций</span>
              {!showSpend && <span>Дефицит {fmtNum(rows.reduce((sum, item) => sum + Math.max(0, Number(item.shortage ?? 0)), 0))}</span>}
            </div>
          </header>
          <div className="eco-restock-table-wrap" tabIndex={0} role="region" aria-label={groupName}>
            <table className="eco-restock-supplier-table eco-restock-setup-table">
              <thead>
                <tr>
                  <th>Товар</th>
                  <th>Код / артикул</th>
                  <th>Причина</th>
                  <th className="l-number">Остаток</th>
                  <th className="l-number">Мин.</th>
                  <th className="l-number">Дефицит</th>
                  {showSpend && <th className="l-number">Потратили сегодня</th>}
                  <th>Статус</th>
                  <th>Действия</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((it) => {
                  const isExcluded = excluded[it.productId];
                  const reasons = [...(routeByProduct.get(it.productId)?.setupReasons ?? [])];
                  if (rosskoState[it.productId]?.status === "not_found") reasons.push("не найдено в ROSSKO");
                  const productQuery = encodeURIComponent(String(it.code || it.name || ""));
                  return (
                    <tr key={it.productId} className={`eco-restock-supplier-row ${isExcluded ? "is-excluded" : ""}`}>
                      <td className="eco-restock-product">
                        <strong>{it.name ?? "—"}</strong>
                        {it.group && <span>{it.group}</span>}
                      </td>
                      <td className="l-mono">{it.code ?? "—"}</td>
                      <td>
                        <div className="eco-restock-reason-list">
                          {(reasons.length ? reasons : ["требует настройки"]).map((reason) => (
                            <EcoBadge key={reason} tone="warning">
                              {reason}
                            </EcoBadge>
                          ))}
                        </div>
                      </td>
                      <td className="l-number">{fmtNum(it.stock)}</td>
                      <td className="l-number">{fmtNum(it.minimumBalance)}</td>
                      <td className="l-number is-shortage">{fmtNum(it.shortage)}</td>
                      {showSpend && <td className="l-number">{fmtNum(it.spentInPeriod)} {it.unit || "шт."}</td>}
                      <td>
                        <EcoBadge tone={isExcluded ? "neutral" : "warning"} dot={!isExcluded}>
                          {isExcluded ? "Исключено" : "Нужно настроить"}
                        </EcoBadge>
                      </td>
                      <td className="eco-restock-row-actions">
                        <Link href={`/inventory/products?search=${productQuery}`} className="eco-link-button">
                          Открыть товар
                        </Link>
                        <EcoButton type="button" size="sm" onClick={() => toggleExcluded(it.productId)}>
                          {isExcluded ? "Вернуть" : "Исключить"}
                        </EcoButton>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
