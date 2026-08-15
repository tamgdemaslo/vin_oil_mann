"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  FilePlus2,
  History,
  Loader2,
  MoreHorizontal,
  PackageCheck,
  PackageX,
  RefreshCw,
  Search,
  Truck,
  X,
} from "lucide-react";
import { EcoBadge, EcoButton, EcoInput } from "@/components/platform/EcoUI";
import { formatServiceDateTime } from "@/lib/date-time";

type RosskoReceiptAction =
  | "MATCHED_EXISTING"
  | "CREATE_PRODUCT"
  | "FULLY_RECEIVED"
  | "PROVIDER_CLOSED"
  | "CLOSED_MANUALLY"
  | "AMBIGUOUS_PRODUCT"
  | "AMBIGUOUS_SOURCE_LINE"
  | "SOURCE_STATUS_WARNING"
  | "INVALID_LINE";

type RosskoReceiptPreviewLine = {
  sourceLineKey: string;
  article: string;
  brand: string;
  name: string;
  orderedQty: number;
  alreadyReceivedQty: number;
  manualClosedQty: number;
  providerClosedQty: number;
  remainingQty: number;
  receiveQty: number;
  purchasePrice: number;
  rosskoStatusLabel: string;
  product: { id: string; name: string; article: string; matchType: string } | null;
  action: RosskoReceiptAction;
  warnings: string[];
};

type RosskoReceiptPreview = {
  order: { id: string; createdAt: string | null; deliveryDate: string | null; deliveryType: string | null; stockAddress: string | null };
  supplier: { id: string | null; name: string; willCreate: boolean };
  store: { id: string; name: string };
  stores: Array<{ id: string; name: string; isMain: boolean }>;
  summary: {
    sourceLines: number;
    orderedQty: number;
    alreadyReceivedQty: number;
    manualClosedQty: number;
    providerClosedQty: number;
    closedQty: number;
    remainingQty: number;
  };
  lines: RosskoReceiptPreviewLine[];
};

type RosskoReceiptDraftResult = {
  documentId: string;
  documentNumber: string;
  positionsCount: number;
  totalQuantity: number;
  totalSum: number;
  store: { id: string; name: string };
  idempotent: boolean;
};

type ProductOption = { id: string; name: string; article: string; brand?: string; entityType: string };

type IncomingOrderLine = {
  sourceLineKey: string;
  partGuid: string;
  productId: string;
  localProduct: { id: string; name: string; article: string | null } | null;
  name: string;
  brand: string;
  article: string;
  orderedQty: number;
  postedReceivedQty: number;
  manualClosedQty: number;
  providerClosedQty: number;
  activeIncomingQty: number;
  closedQty: number;
  sourceStatus: number | null;
  sourceStatusLabel: string;
  state: string;
  stateLabel: string;
  expectedDate: string | null;
  previousExpectedDate: string | null;
  delayDays: number;
  canReceive: boolean;
  canClose: boolean;
  resolution: string;
  resolutionLabel: string;
};

type IncomingOrder = {
  externalOrderId: string;
  createdAt: string | null;
  expectedDate: string | null;
  previousExpectedDate: string | null;
  deliveryType: string | null;
  stockAddress: string | null;
  updatedAt: string | null;
  syncError: string | null;
  status: string;
  statusLabel: string;
  isDelayed: boolean;
  isClosed: boolean;
  hasProviderCancellation: boolean;
  hasManualClosure: boolean;
  hasPartialReceipt: boolean;
  readyToReceive: boolean;
  summary: {
    orderedQty: number;
    postedReceivedQty: number;
    activeIncomingQty: number;
    closedQty: number;
    receivableQty: number;
  };
  lines: IncomingOrderLine[];
  receiptDocuments: Array<{ id: string; number: string; status: string; createdAt: string; quantity: number }>;
  history: Array<{ id: string; at: string; action: string; label: string; actor: string | null; details: string | null }>;
};

type IncomingOrdersResponse = {
  orders?: IncomingOrder[];
  updatedAt?: string | null;
  error?: string;
};

type IncomingFilter = "active" | "all" | "delayed" | "ready" | "partial" | "cancelled" | "closed";

type ManualCloseReason = "SUPPLIER_CANCELLED" | "UNAVAILABLE" | "DELIVERY_FAILED" | "CANCELLED_IN_ROSSKO" | "NO_LONGER_NEEDED" | "OTHER";

const CLOSE_REASON_OPTIONS: Array<{ value: ManualCloseReason; label: string }> = [
  { value: "SUPPLIER_CANCELLED", label: "Поставщик отменил поставку" },
  { value: "UNAVAILABLE", label: "Товар недоступен" },
  { value: "DELIVERY_FAILED", label: "Доставка сорвана" },
  { value: "CANCELLED_IN_ROSSKO", label: "Заказ отменён вручную в ROSSKO" },
  { value: "NO_LONGER_NEEDED", label: "Заказ больше не нужен" },
  { value: "OTHER", label: "Другое" },
];

const INCOMING_FILTERS: Array<{ value: IncomingFilter; label: string }> = [
  { value: "active", label: "Активные" },
  { value: "all", label: "Все" },
  { value: "delayed", label: "Задерживаются" },
  { value: "ready", label: "Готовы к приёмке" },
  { value: "partial", label: "Частично приняты" },
  { value: "cancelled", label: "Отменённые" },
  { value: "closed", label: "Закрытые" },
];

const STORAGE_KEY = "vin-oil-restock-rossko-orders";

function formatNumber(value: number | null | undefined) {
  return Number(value ?? 0).toLocaleString("ru-RU", { maximumFractionDigits: 3 });
}

function formatMoney(value: number | null | undefined) {
  return Number(value ?? 0).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function readTrackedOrders() {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    const result: Array<Record<string, unknown>> = [];
    for (const rawOrder of parsed) {
      const order = asRecord(rawOrder);
      const externalOrderId = String(order.externalOrderId ?? "").trim();
      if (!/^\d+$/.test(externalOrderId)) continue;
      const rawLines = Array.isArray(order.lines) ? order.lines : [];
      const lines = rawLines.map((rawLine) => {
        const line = asRecord(rawLine);
        const orderedQty = Math.max(0, Number(line.orderedQty ?? line.count ?? 0));
        return {
          productId: String(line.productId ?? ""),
          name: String(line.title ?? line.offerName ?? line.name ?? "Позиция ROSSKO"),
          brand: String(line.brand ?? ""),
          article: String(line.partnumber ?? line.article ?? line.code ?? ""),
          orderedQty,
          count: orderedQty,
          expectedAt: line.expectedAt ?? order.expectedAt ?? null,
        };
      });
      result.push({
        externalOrderId,
        createdAt: order.createdAt ?? null,
        orderedAt: order.orderedAt ?? order.createdAt ?? null,
        expectedAt: order.expectedAt ?? null,
        comment: order.comment ?? null,
        lines,
      });
    }
    return result;
  } catch {
    return [];
  }
}

function relativeUpdatedAt(value: string | null) {
  if (!value) return "ещё не обновлялось";
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 1) return "обновлено только что";
  if (minutes < 60) return `обновлено ${minutes} мин. назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `обновлено ${hours} ч. назад`;
  return `обновлено ${formatServiceDateTime(value)}`;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(value));
}

function statusTone(order: IncomingOrder): "neutral" | "success" | "warning" | "danger" | "info" {
  if (order.isDelayed) return "warning";
  if (order.hasProviderCancellation && order.isClosed) return "danger";
  if (order.isClosed) return "neutral";
  if (order.hasPartialReceipt || order.readyToReceive) return "success";
  return "info";
}

function lineTone(line: IncomingOrderLine): "neutral" | "success" | "warning" | "danger" | "info" {
  if (["UNAVAILABLE", "CANCELLED", "EXPIRED"].includes(line.state)) return "danger";
  if (["DELAYED", "RETURN"].includes(line.state)) return "warning";
  if (["RECEIVED", "PARTIALLY_RECEIVED", "AT_BRANCH"].includes(line.state)) return "success";
  if (line.state === "CLOSED_MANUALLY") return "neutral";
  return "info";
}

async function loadPreview(orderId: string, storeId?: string): Promise<RosskoReceiptPreview> {
  const response = await fetch(`/api/rossko/orders/${encodeURIComponent(orderId)}/receipt-preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(storeId ? { storeId } : {}),
  });
  const data = await response.json() as RosskoReceiptPreview & { error?: string };
  if (!response.ok || data.error) throw new Error(data.error || "Не удалось загрузить заказ ROSSKO");
  if (!data.lines.length) throw new Error("В заказе ROSSKO нет позиций для приёмки");
  return data;
}

function actionLabel(action: RosskoReceiptAction) {
  if (action === "MATCHED_EXISTING") return "Найден в каталоге";
  if (action === "CREATE_PRODUCT") return "Будет создан товар";
  if (action === "AMBIGUOUS_PRODUCT") return "Нужно выбрать товар";
  if (action === "FULLY_RECEIVED") return "Уже принято полностью";
  if (action === "PROVIDER_CLOSED") return "Закрыто ROSSKO";
  if (action === "CLOSED_MANUALLY") return "Закрыто вручную";
  if (action === "AMBIGUOUS_SOURCE_LINE") return "Неоднозначная строка ROSSKO";
  if (action === "SOURCE_STATUS_WARNING") return "Подтвердите получение";
  return "Проверьте строку";
}

function actionTone(action: RosskoReceiptAction): "neutral" | "success" | "warning" | "danger" | "info" {
  if (action === "MATCHED_EXISTING" || action === "FULLY_RECEIVED") return "success";
  if (action === "PROVIDER_CLOSED") return "danger";
  if (action === "CLOSED_MANUALLY") return "neutral";
  if (action === "CREATE_PRODUCT") return "info";
  if (action === "INVALID_LINE" || action === "AMBIGUOUS_SOURCE_LINE") return "danger";
  return "warning";
}

export default function RosskoReceiptWorkspace({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (result: RosskoReceiptDraftResult) => void;
}) {
  const [orders, setOrders] = useState<IncomingOrder[]>([]);
  const [orderId, setOrderId] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);
  const [filter, setFilter] = useState<IncomingFilter>("active");
  const [expandedOrderIds, setExpandedOrderIds] = useState<Set<string>>(new Set());
  const [historyOrderIds, setHistoryOrderIds] = useState<Set<string>>(new Set());
  const [actionOrderId, setActionOrderId] = useState<string | null>(null);
  const [closeOrder, setCloseOrder] = useState<IncomingOrder | null>(null);
  const [closeQuantities, setCloseQuantities] = useState<Record<string, number>>({});
  const [closeReason, setCloseReason] = useState<ManualCloseReason>("SUPPLIER_CANCELLED");
  const [closeComment, setCloseComment] = useState("");
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState("");
  const [closeIdempotencyKey, setCloseIdempotencyKey] = useState("");
  const legacyImportedRef = useRef(false);

  const applyOrdersResponse = useCallback((data: IncomingOrdersResponse) => {
    setOrders(Array.isArray(data.orders) ? data.orders : []);
    setUpdatedAt(data.updatedAt ?? null);
  }, []);

  const loadOrders = useCallback(async (sync = true, importLegacy = false) => {
    setLoadingOrders(true);
    setError("");
    try {
      const legacyOrders = importLegacy && !legacyImportedRef.current ? readTrackedOrders() : [];
      legacyImportedRef.current = legacyImportedRef.current || importLegacy;
      const response = legacyOrders.length
        ? await fetch("/api/rossko/incoming-orders", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ orders: legacyOrders, sync }),
          })
        : await fetch(`/api/rossko/incoming-orders?sync=${sync ? "1" : "0"}`, { cache: "no-store" });
      const data = await response.json() as IncomingOrdersResponse;
      if (!response.ok || data.error) throw new Error(data.error || "Не удалось загрузить заказы ROSSKO");
      applyOrdersResponse(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось загрузить заказы ROSSKO");
    } finally {
      setLoadingOrders(false);
    }
  }, [applyOrdersResponse]);

  useEffect(() => {
    void loadOrders(true, true);
  }, [loadOrders]);

  async function addOrder() {
    const id = orderId.trim();
    if (!/^\d+$/.test(id) || busy) {
      setError("Укажите корректный номер заказа ROSSKO");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/rossko/incoming-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ orderIds: [id], sync: true }),
      });
      const data = await response.json() as IncomingOrdersResponse;
      if (!response.ok || data.error) throw new Error(data.error || "Не удалось добавить заказ ROSSKO");
      applyOrdersResponse(data);
      setOrderId("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось добавить заказ ROSSKO");
    } finally {
      setBusy(false);
    }
  }

  async function refreshTrackedOrder(id: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/rossko/incoming-orders/${encodeURIComponent(id)}/sync`, { method: "POST" });
      const data = await response.json() as IncomingOrdersResponse;
      if (!response.ok || data.error) throw new Error(data.error || "Не удалось обновить статус ROSSKO");
      applyOrdersResponse(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось обновить статус ROSSKO");
    } finally {
      setBusy(false);
    }
  }

  function openCloseDialog(order: IncomingOrder, reason: ManualCloseReason = "SUPPLIER_CANCELLED") {
    setActionOrderId(null);
    setCloseOrder(order);
    setCloseReason(reason);
    setCloseComment("");
    setCloseError("");
    setCloseIdempotencyKey(typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${order.externalOrderId}-${Date.now()}`);
    setCloseQuantities(Object.fromEntries(order.lines.filter((line) => line.canClose).map((line) => [line.sourceLineKey, line.activeIncomingQty])));
  }

  async function submitManualClose() {
    if (!closeOrder || closing) return;
    const lines = closeOrder.lines
      .map((line) => ({ sourceLineKey: line.sourceLineKey, quantity: Math.max(0, Math.floor(Number(closeQuantities[line.sourceLineKey] ?? 0))) }))
      .filter((line) => line.quantity > 0);
    if (!lines.length) {
      setCloseError("Укажите закрываемое количество хотя бы для одной позиции.");
      return;
    }
    setClosing(true);
    setCloseError("");
    try {
      const response = await fetch(`/api/rossko/incoming-orders/${encodeURIComponent(closeOrder.externalOrderId)}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ reason: closeReason, comment: closeComment, idempotencyKey: closeIdempotencyKey, lines }),
      });
      const data = await response.json() as IncomingOrdersResponse;
      if (!response.ok || data.error) throw new Error(data.error || "Не удалось закрыть позиции");
      applyOrdersResponse(data);
      setCloseOrder(null);
    } catch (cause) {
      setCloseError(cause instanceof Error ? cause.message : "Не удалось закрыть позиции");
    } finally {
      setClosing(false);
    }
  }

  const filteredOrders = useMemo(() => orders.filter((order) => {
    if (filter === "all") return true;
    if (filter === "active") return !order.isClosed;
    if (filter === "delayed") return order.isDelayed;
    if (filter === "ready") return order.readyToReceive;
    if (filter === "partial") return order.hasPartialReceipt;
    if (filter === "cancelled") return order.hasProviderCancellation;
    return order.isClosed;
  }), [filter, orders]);

  const filterCount = useCallback((value: IncomingFilter) => orders.filter((order) => {
    if (value === "all") return true;
    if (value === "active") return !order.isClosed;
    if (value === "delayed") return order.isDelayed;
    if (value === "ready") return order.readyToReceive;
    if (value === "partial") return order.hasPartialReceipt;
    if (value === "cancelled") return order.hasProviderCancellation;
    return order.isClosed;
  }).length, [orders]);

  if (activeOrderId) {
    return (
      <RosskoReceiptEditor
        orderId={activeOrderId}
        onClose={() => {
          void refreshTrackedOrder(activeOrderId);
          setActiveOrderId(null);
        }}
        onCreated={(result) => {
          onCreated(result);
          void refreshTrackedOrder(activeOrderId);
        }}
      />
    );
  }

  return (
    <div className="eco-restock-cart-shell is-workspace" role="presentation">
      <button type="button" className="eco-restock-cart-backdrop" aria-label="Закрыть приёмку из ROSSKO" onClick={onClose} />
      <section className="eco-restock-cart-drawer eco-restock-incoming-drawer is-workspace" role="dialog" aria-modal="true" aria-labelledby="rossko-workspace-title">
        <header className="eco-restock-cart-head">
          <div>
            <span>Склад · Приёмка</span>
            <h2 id="rossko-workspace-title">Приёмка из ROSSKO</h2>
            <p>Актуальные статусы GetOrders, локальные закрытия и история приёмок.</p>
          </div>
          <div className="eco-restock-incoming-head-actions">
            <span>{relativeUpdatedAt(updatedAt)}</span>
            <EcoButton type="button" size="sm" onClick={() => void loadOrders(true)} disabled={busy || loadingOrders}>
              {loadingOrders ? <Loader2 size={14} className="eco-spin" /> : <RefreshCw size={14} />}
              Обновить статусы
            </EcoButton>
            <button type="button" className="eco-icon-btn" onClick={onClose} aria-label="Закрыть"><X size={18} /></button>
          </div>
        </header>

        <div className="eco-restock-cart-body">
          <section className="eco-restock-import-group" aria-label="Добавить заказ ROSSKO">
            <label className="eco-restock-import-order">
              <span>№ заказа ROSSKO</span>
              <EcoInput
                value={orderId}
                onChange={(event) => setOrderId(event.target.value.replace(/\D/g, ""))}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void addOrder();
                  }
                }}
                inputMode="numeric"
                autoFocus
                placeholder="Например, 182269117"
              />
            </label>
            <EcoButton type="button" variant="primary" onClick={() => void addOrder()} disabled={busy || !orderId.trim()}>
              {busy ? <Loader2 size={15} className="eco-spin" /> : <FilePlus2 size={15} />}
              Добавить
            </EcoButton>
          </section>

          {error && <div className="eco-restock-receipt-error" role="alert"><AlertTriangle size={16} /><span>{error}</span></div>}

          <div className="eco-restock-incoming-filters" role="tablist" aria-label="Фильтр заказов ROSSKO">
            {INCOMING_FILTERS.map((item) => (
              <button key={item.value} type="button" role="tab" aria-selected={filter === item.value} className={filter === item.value ? "is-active" : ""} onClick={() => setFilter(item.value)}>
                <span>{item.label}</span>
                <strong>{filterCount(item.value)}</strong>
              </button>
            ))}
          </div>

          <div className="eco-restock-incoming-list" aria-label="Заказы ROSSKO в пути">
            {loadingOrders ? Array.from({ length: 3 }).map((_, index) => <div key={index} className="eco-restock-incoming-skeleton" aria-hidden="true"><span /><span /><span /></div>) : filteredOrders.length ? filteredOrders.map((order) => {
              const expanded = expandedOrderIds.has(order.externalOrderId);
              const historyOpen = historyOrderIds.has(order.externalOrderId);
              const actionsOpen = actionOrderId === order.externalOrderId;
              return (
                <article key={order.externalOrderId} className={`eco-rossko-incoming-order ${order.isDelayed ? "is-delayed" : ""} ${order.isClosed ? "is-closed" : ""}`}>
                  <div className="eco-rossko-incoming-order__head">
                    <button type="button" className="eco-rossko-incoming-order__toggle" onClick={() => setExpandedOrderIds((current) => { const next = new Set(current); if (next.has(order.externalOrderId)) next.delete(order.externalOrderId); else next.add(order.externalOrderId); return next; })} aria-expanded={expanded}>
                      <ChevronDown size={16} />
                      <span><strong>Заказ ROSSKO №{order.externalOrderId}</strong><small>{order.createdAt ? `Создан ${formatDate(order.createdAt)}` : "Дата создания не передана"}</small></span>
                    </button>
                    <div className="eco-rossko-incoming-order__delivery">
                      <CalendarClock size={15} />
                      <span><small>Ожидаемая доставка</small><strong>{formatDate(order.expectedDate)}</strong></span>
                      {order.previousExpectedDate && <em>было {formatDate(order.previousExpectedDate)}</em>}
                    </div>
                    <EcoBadge tone={statusTone(order)}>{order.statusLabel}</EcoBadge>
                    <button type="button" className="eco-icon-btn" onClick={() => setActionOrderId(actionsOpen ? null : order.externalOrderId)} aria-label={`Действия заказа ${order.externalOrderId}`} aria-expanded={actionsOpen}><MoreHorizontal size={18} /></button>
                  </div>

                  {order.isDelayed && <p className="eco-rossko-incoming-order__warning"><AlertTriangle size={14} />{order.previousExpectedDate ? `Доставка перенесена: было ${formatDate(order.previousExpectedDate)} · сейчас ${formatDate(order.expectedDate)}.` : `Доставка ожидалась ${formatDate(order.expectedDate)} · задержка ${Math.max(...order.lines.map((line) => line.delayDays), 0)} дн.`} Сначала проверьте актуальный статус ROSSKO.</p>}
                  {order.syncError && <p className="eco-rossko-incoming-order__error"><AlertTriangle size={14} />{order.syncError}</p>}

                  <dl className="eco-rossko-incoming-order__summary">
                    <div><dt>Заказано</dt><dd>{formatNumber(order.summary.orderedQty)}</dd></div>
                    <div><dt>Принято</dt><dd>{formatNumber(order.summary.postedReceivedQty)}</dd></div>
                    <div><dt>В пути</dt><dd>{formatNumber(order.summary.activeIncomingQty)}</dd></div>
                    <div><dt>Закрыто</dt><dd>{formatNumber(order.summary.closedQty)}</dd></div>
                  </dl>

                  {actionsOpen && <div className="eco-rossko-incoming-actions" aria-label={`Действия заказа ${order.externalOrderId}`}>
                    <button type="button" onClick={() => void refreshTrackedOrder(order.externalOrderId)}><RefreshCw size={14} />Обновить статус ROSSKO</button>
                    <button type="button" onClick={() => { setExpandedOrderIds((current) => new Set(current).add(order.externalOrderId)); setActionOrderId(null); }}><ChevronDown size={14} />Открыть детали</button>
                    {order.readyToReceive && <button type="button" onClick={() => setActiveOrderId(order.externalOrderId)}><PackageCheck size={14} />Принять на склад</button>}
                    {order.lines.some((line) => line.canClose) && <button type="button" onClick={() => openCloseDialog(order)}><PackageX size={14} />Закрыть оставшиеся позиции</button>}
                    {order.lines.some((line) => line.canClose) && <button type="button" onClick={() => openCloseDialog(order, "NO_LONGER_NEEDED")}><X size={14} />Пометить заказ неактуальным</button>}
                    <button type="button" onClick={() => { setExpandedOrderIds((current) => new Set(current).add(order.externalOrderId)); setHistoryOrderIds((current) => new Set(current).add(order.externalOrderId)); setActionOrderId(null); }}><History size={14} />Показать историю</button>
                  </div>}

                  {expanded && <div className="eco-rossko-incoming-detail">
                    <div className="eco-rossko-incoming-meta">
                      <span>Доставка: <strong>{order.deliveryType || "не указана"}</strong></span>
                      <span>Адрес: <strong>{order.stockAddress || "не указан"}</strong></span>
                      <span>{relativeUpdatedAt(order.updatedAt)}</span>
                    </div>
                    <div className="eco-rossko-incoming-lines">
                      {order.lines.map((line) => <div key={line.sourceLineKey} className="eco-rossko-incoming-line-detail">
                        <div className="eco-rossko-incoming-line-detail__product"><strong>{line.brand} {line.article}</strong><span>{line.name}</span>{line.localProduct && <small>Каталог: {line.localProduct.name}</small>}</div>
                        <EcoBadge tone={lineTone(line)}>{line.stateLabel}</EcoBadge>
                        <dl>
                          <div><dt>Заказано</dt><dd>{formatNumber(line.orderedQty)}</dd></div>
                          <div><dt>Принято</dt><dd>{formatNumber(line.postedReceivedQty)}</dd></div>
                          <div><dt>В пути</dt><dd>{formatNumber(line.activeIncomingQty)}</dd></div>
                          <div><dt>Закрыто</dt><dd>{formatNumber(line.closedQty)}</dd></div>
                        </dl>
                        <div className="eco-rossko-incoming-line-detail__status"><span>ROSSKO: <strong>{line.sourceStatusLabel}</strong></span><small>{line.resolutionLabel}</small>{line.expectedDate && <small>Ожидается: {formatDate(line.expectedDate)}{line.delayDays ? ` · задержка ${line.delayDays} дн.` : ""}</small>}</div>
                        {line.canClose && <EcoButton type="button" size="sm" onClick={() => { openCloseDialog(order); setCloseQuantities(Object.fromEntries(order.lines.map((candidate) => [candidate.sourceLineKey, candidate.sourceLineKey === line.sourceLineKey ? candidate.activeIncomingQty : 0]))); }}>Закрыть количество</EcoButton>}
                      </div>)}
                    </div>
                    {!!order.receiptDocuments.length && <div className="eco-rossko-incoming-documents"><strong>Документы приёмки</strong>{order.receiptDocuments.map((document) => <Link key={document.id} href={`/inventory/receipts?document=${encodeURIComponent(document.id)}&open=view`}>{document.number} · {formatNumber(document.quantity)} шт. · {document.status}</Link>)}</div>}
                    <button type="button" className="eco-rossko-history-toggle" onClick={() => setHistoryOrderIds((current) => { const next = new Set(current); if (next.has(order.externalOrderId)) next.delete(order.externalOrderId); else next.add(order.externalOrderId); return next; })}><History size={14} />История изменений <ChevronDown size={14} /></button>
                    {historyOpen && <div className="eco-rossko-incoming-history">{order.history.length ? order.history.map((item) => <div key={item.id}><time>{formatServiceDateTime(item.at)}</time><span><strong>{item.label}</strong>{item.details && <small>{item.details}</small>}{item.actor && <small>Пользователь: {item.actor}</small>}</span></div>) : <span>История появится после первого обновления.</span>}</div>}
                  </div>}

                  <div className="eco-rossko-incoming-order__footer">
                    <span>{order.summary.activeIncomingQty > 0 ? `${formatNumber(order.summary.activeIncomingQty)} шт. реально ожидается` : "Активных позиций в пути нет"}</span>
                    {order.readyToReceive && <EcoButton type="button" size="sm" variant="primary" onClick={() => setActiveOrderId(order.externalOrderId)}><PackageCheck size={14} />Принять на склад</EcoButton>}
                    {order.lines.some((line) => line.canClose) && <EcoButton type="button" size="sm" onClick={() => openCloseDialog(order)}>Закрыть остаток</EcoButton>}
                  </div>
                </article>
              );
            }) : (
              <div className="eco-restock-cart-empty">
                <Truck size={30} />
                <strong>{orders.length ? "В этом фильтре нет заказов" : "Заказы ещё не добавлены"}</strong>
                <span>{orders.length ? "Выберите другой статус выше." : "Введите номер заказа ROSSKO выше. Заказ сохранится для всего филиала и обновится через GetOrders."}</span>
              </div>
            )}
          </div>
        </div>

        <footer className="eco-restock-cart-footer">
          <span>Черновик не меняет остатки до штатного проведения приёмки.</span>
          <EcoButton type="button" onClick={onClose}>Закрыть</EcoButton>
        </footer>
      </section>

      {closeOrder && <>
        <button type="button" className="eco-rossko-close-backdrop" aria-label="Закрыть диалог" onClick={() => !closing && setCloseOrder(null)} />
        <section className="eco-rossko-close-dialog" role="dialog" aria-modal="true" aria-labelledby="rossko-close-title">
          <header><div><span>Локальное закрытие</span><h2 id="rossko-close-title">Заказ ROSSKO №{closeOrder.externalOrderId}</h2><p>Закройте всё оставшееся количество или только ту часть, которая больше не приедет.</p></div><button type="button" className="eco-icon-btn" onClick={() => setCloseOrder(null)} disabled={closing} aria-label="Закрыть"><X size={18} /></button></header>
          <div className="eco-rossko-close-body">
            <div className="eco-rossko-close-lines">{closeOrder.lines.filter((line) => line.canClose).map((line) => <label key={line.sourceLineKey}><span><strong>{line.brand} {line.article}</strong><small>{line.name} · в пути {formatNumber(line.activeIncomingQty)} шт.</small></span><EcoInput type="number" min={0} max={line.activeIncomingQty} step={1} value={closeQuantities[line.sourceLineKey] ?? 0} onChange={(event) => setCloseQuantities((current) => ({ ...current, [line.sourceLineKey]: Math.max(0, Math.min(line.activeIncomingQty, parseInt(event.target.value, 10) || 0)) }))} aria-label={`Закрыть количество: ${line.name}`} /></label>)}</div>
            <label className="eco-rossko-close-field"><span>Причина</span><select value={closeReason} onChange={(event) => setCloseReason(event.target.value as ManualCloseReason)}>{CLOSE_REASON_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <label className="eco-rossko-close-field"><span>Комментарий {closeReason === "OTHER" ? "· обязательно" : "· необязательно"}</span><textarea value={closeComment} onChange={(event) => setCloseComment(event.target.value)} rows={3} placeholder="Что произошло с поставкой" /></label>
            <p className="eco-rossko-close-warning"><AlertTriangle size={15} /><span><strong>Заказ в ROSSKO не отменяется.</strong> Действие только перестаёт учитывать выбранное количество как товар в пути и не меняет складские остатки. Для отмены используйте личный кабинет ROSSKO, затем обновите статус.</span></p>
            {closeError && <p className="eco-rossko-close-error" role="alert"><AlertTriangle size={15} />{closeError}</p>}
          </div>
          <footer><span>Будет закрыто {formatNumber(Object.values(closeQuantities).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0))} шт.</span><EcoButton type="button" onClick={() => setCloseOrder(null)} disabled={closing}>Отмена</EcoButton><EcoButton type="button" variant="primary" onClick={() => void submitManualClose()} disabled={closing || !Object.values(closeQuantities).some((value) => Number(value) > 0) || (closeReason === "OTHER" && !closeComment.trim())}>{closing ? <Loader2 size={15} className="eco-spin" /> : <PackageX size={15} />}Закрыть позиции</EcoButton></footer>
        </section>
      </>}
    </div>
  );
}

function RosskoReceiptEditor({
  orderId,
  onClose,
  onCreated,
}: {
  orderId: string;
  onClose: () => void;
  onCreated: (result: RosskoReceiptDraftResult) => void;
}) {
  const [preview, setPreview] = useState<RosskoReceiptPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [storeId, setStoreId] = useState("");
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [selectedProducts, setSelectedProducts] = useState<Record<string, string>>({});
  const [pickerLineKey, setPickerLineKey] = useState<string | null>(null);
  const [productSearch, setProductSearch] = useState("");
  const [productOptions, setProductOptions] = useState<ProductOption[]>([]);
  const [productsBusy, setProductsBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<RosskoReceiptDraftResult | null>(null);

  const fetchPreview = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await loadPreview(orderId, storeId || undefined);
      setPreview(data);
      setStoreId((current) => current || data.store.id);
      setEnabled(Object.fromEntries(data.lines.map((line) => [line.sourceLineKey, line.receiveQty > 0])));
      setQuantities(Object.fromEntries(data.lines.map((line) => [line.sourceLineKey, line.receiveQty])));
      setSelectedProducts({});
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось загрузить заказ ROSSKO");
    } finally {
      setLoading(false);
    }
  }, [orderId, storeId]);

  useEffect(() => {
    void fetchPreview();
    // The selected store is sent when the draft is created; changing it must not reload the source order.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  async function searchProducts(line: RosskoReceiptPreviewLine, queryOverride?: string) {
    const query = ((queryOverride ?? productSearch) || `${line.brand} ${line.article}`).trim();
    if (query.length < 2) return;
    setProductsBusy(true);
    setError("");
    try {
      const params = new URLSearchParams({ search: query, limit: "30" });
      const response = await fetch(`/api/local-inventory/products?${params.toString()}`, { cache: "no-store" });
      const data = await response.json() as { products?: ProductOption[]; error?: string };
      if (!response.ok) throw new Error(data.error || "Не удалось найти товары");
      setProductOptions((data.products ?? []).filter((product) => product.entityType !== "service"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось найти товары");
    } finally {
      setProductsBusy(false);
    }
  }

  function toggleLine(line: RosskoReceiptPreviewLine, checked: boolean) {
    setEnabled((current) => ({ ...current, [line.sourceLineKey]: checked }));
    setQuantities((current) => ({
      ...current,
      [line.sourceLineKey]: checked ? Math.max(1, current[line.sourceLineKey] || line.remainingQty) : 0,
    }));
  }

  async function createDraft() {
    if (!preview || saving) return;
    const lines = preview.lines
      .filter((line) => enabled[line.sourceLineKey] && Number(quantities[line.sourceLineKey]) > 0)
      .map((line) => ({
        sourceLineKey: line.sourceLineKey,
        receiveQty: Number(quantities[line.sourceLineKey]),
        selectedProductId: selectedProducts[line.sourceLineKey] || null,
        createProduct: !line.product && line.action !== "AMBIGUOUS_PRODUCT",
      }));
    if (!lines.length) {
      setError("Выберите хотя бы одну позицию и укажите фактически принятое количество.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/rossko/orders/${encodeURIComponent(orderId)}/receipt-draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ storeId, lines }),
      });
      const data = await response.json() as RosskoReceiptDraftResult & { error?: string };
      if (!response.ok || data.error) throw new Error(data.error || "Не удалось создать черновик приёмки");
      setCreated(data);
      onCreated(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось создать черновик приёмки");
    } finally {
      setSaving(false);
    }
  }

  const selectedLines = useMemo(
    () => preview?.lines.filter((line) => enabled[line.sourceLineKey] && Number(quantities[line.sourceLineKey]) > 0) ?? [],
    [enabled, preview, quantities],
  );
  const selectedQty = selectedLines.reduce((sum, line) => sum + Number(quantities[line.sourceLineKey] || 0), 0);
  const selectedSum = selectedLines.reduce((sum, line) => sum + Number(quantities[line.sourceLineKey] || 0) * line.purchasePrice, 0);
  const nothingReceivable = Boolean(preview?.lines.length && preview.lines.every((line) => line.remainingQty <= 0));

  return (
    <div className="eco-restock-cart-shell is-workspace" role="presentation">
      <button type="button" className="eco-restock-cart-backdrop" aria-label="Закрыть заказ ROSSKO" onClick={onClose} />
      <section className="eco-restock-cart-drawer eco-restock-receipt-drawer is-workspace" role="dialog" aria-modal="true" aria-labelledby="rossko-receipt-title">
        <header className="eco-restock-cart-head">
          <div>
            <span>Склад · Приёмка из ROSSKO</span>
            <h2 id="rossko-receipt-title">Заказ ROSSKO №{orderId}</h2>
            {preview?.order.createdAt && <p>Создан {formatServiceDateTime(preview.order.createdAt)}</p>}
          </div>
          <button type="button" className="eco-icon-btn" onClick={onClose} aria-label="Назад к заказам"><X size={18} /></button>
        </header>

        {created ? (
          <div className="eco-restock-receipt-success">
            <CheckCircle2 size={34} />
            <div><h3>Черновик приёмки создан</h3><p>Остатки не изменены. Откройте документ и проведите его штатной кнопкой.</p></div>
            <dl>
              <div><dt>Документ</dt><dd>{created.documentNumber}</dd></div>
              <div><dt>Позиции</dt><dd>{created.positionsCount}</dd></div>
              <div><dt>Количество</dt><dd>{formatNumber(created.totalQuantity)}</dd></div>
              <div><dt>Сумма</dt><dd>{formatMoney(created.totalSum)} ₽</dd></div>
              <div><dt>Склад</dt><dd>{created.store.name}</dd></div>
            </dl>
            {created.idempotent && <EcoBadge tone="info">Открыт ранее созданный черновик</EcoBadge>}
          </div>
        ) : loading ? (
          <div className="eco-restock-receipt-loading" aria-live="polite">
            <Loader2 size={24} className="eco-spin" />
            <strong>Получаем заказ и сверяем приёмки…</strong>
            <span>Количество, цены и сопоставление считаются на сервере.</span>
          </div>
        ) : preview ? (
          <>
            <div className="eco-restock-receipt-meta">
              <div><span>Поставщик</span><strong>{preview.supplier.name}</strong>{preview.supplier.willCreate && <small>будет создан при сохранении</small>}</div>
              <label><span>Склад</span><select value={storeId} onChange={(event) => setStoreId(event.target.value)}>{preview.stores.map((store) => <option key={store.id} value={store.id}>{store.name}{store.isMain ? " · основной" : ""}</option>)}</select></label>
              <div><span>Источник</span><strong>ROSSKO</strong><small>{preview.order.stockAddress || "Адрес не указан"}</small></div>
              <div><span>Активно в пути</span><strong>{formatNumber(preview.summary.remainingQty)} шт.</strong><small>принято {formatNumber(preview.summary.alreadyReceivedQty)} · закрыто {formatNumber(preview.summary.closedQty)}</small></div>
            </div>

            <div className="eco-restock-cart-body eco-restock-receipt-body">
              {nothingReceivable ? (
                <div className="eco-restock-cart-empty"><PackageCheck size={30} /><strong>Нет позиций для приёмки</strong><span>Позиции уже приняты, закрыты ROSSKO или закрыты локально. Они не попадут в новый черновик.</span></div>
              ) : (
                <div className="eco-restock-receipt-table-wrap">
                  <table className="eco-restock-receipt-table">
                    <thead><tr><th aria-label="Выбрать" /><th>Товар</th><th>Артикул</th><th>Статус</th><th className="l-number">Заказано</th><th className="l-number">Принято</th><th className="l-number">В пути</th><th className="l-number">Закрыто</th><th className="l-number">Принимаем</th><th>Каталог</th><th className="l-number">Закупка</th></tr></thead>
                    <tbody>
                      {preview.lines.map((line) => {
                        const blocked = ["FULLY_RECEIVED", "PROVIDER_CLOSED", "CLOSED_MANUALLY", "SOURCE_STATUS_WARNING", "INVALID_LINE", "AMBIGUOUS_SOURCE_LINE"].includes(line.action);
                        const needsProduct = line.action === "AMBIGUOUS_PRODUCT" && !selectedProducts[line.sourceLineKey];
                        const pickerOpen = pickerLineKey === line.sourceLineKey;
                        return (
                          <Fragment key={line.sourceLineKey}>
                            <tr className={blocked ? "is-disabled" : line.warnings.length ? "has-warning" : ""}>
                              <td><input type="checkbox" checked={Boolean(enabled[line.sourceLineKey])} disabled={blocked || needsProduct} onChange={(event) => toggleLine(line, event.target.checked)} aria-label={`Принять ${line.name}`} /></td>
                              <td className="eco-restock-receipt-product"><strong>{line.name}</strong><span>{line.brand}</span></td>
                              <td className="l-mono">{line.article}</td>
                              <td>{line.rosskoStatusLabel}</td>
                              <td className="l-number">{formatNumber(line.orderedQty)}</td>
                              <td className="l-number">{formatNumber(line.alreadyReceivedQty)}</td>
                              <td className="l-number"><strong>{formatNumber(line.remainingQty)}</strong></td>
                              <td className="l-number">{formatNumber(line.manualClosedQty + line.providerClosedQty)}</td>
                              <td className="l-number"><EcoInput type="number" min={0} max={line.remainingQty} step={1} value={quantities[line.sourceLineKey] ?? 0} disabled={!enabled[line.sourceLineKey] || blocked} onChange={(event) => setQuantities((current) => ({ ...current, [line.sourceLineKey]: Math.max(0, Math.min(line.remainingQty, parseInt(event.target.value, 10) || 0)) }))} aria-label={`Фактически принято: ${line.name}`} /></td>
                              <td className="eco-restock-receipt-match">
                                <EcoBadge tone={actionTone(line.action)}>{actionLabel(line.action)}</EcoBadge>
                                {line.product && <small>{line.product.name}</small>}
                                {selectedProducts[line.sourceLineKey] && <small>Товар выбран вручную</small>}
                                {line.action === "AMBIGUOUS_PRODUCT" && <EcoButton type="button" size="sm" onClick={() => { setPickerLineKey(pickerOpen ? null : line.sourceLineKey); setProductSearch(`${line.brand} ${line.article}`); if (!pickerOpen) void searchProducts(line, `${line.brand} ${line.article}`); }}><Search size={14} /> Выбрать</EcoButton>}
                              </td>
                              <td className="l-number">{formatMoney(line.purchasePrice)} ₽</td>
                            </tr>
                            {(line.warnings.length > 0 || pickerOpen) && (
                              <tr className="eco-restock-receipt-detail-row"><td /><td colSpan={10}>
                                {line.warnings.map((warning) => <p key={warning}><AlertTriangle size={14} />{warning}</p>)}
                                {pickerOpen && <div className="eco-restock-receipt-picker">
                                  <EcoInput value={productSearch} onChange={(event) => setProductSearch(event.target.value)} placeholder="Название, артикул или бренд" />
                                  <EcoButton type="button" size="sm" onClick={() => void searchProducts(line)} disabled={productsBusy}>{productsBusy ? <Loader2 size={14} className="eco-spin" /> : <Search size={14} />} Найти</EcoButton>
                                  <select value={selectedProducts[line.sourceLineKey] ?? ""} onChange={(event) => { const productId = event.target.value; setSelectedProducts((current) => ({ ...current, [line.sourceLineKey]: productId })); if (productId) toggleLine(line, true); }}>
                                    <option value="">Выберите товар из каталога</option>
                                    {productOptions.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.brand || "без бренда"} · {product.article || "без артикула"}</option>)}
                                  </select>
                                </div>}
                              </td></tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        ) : null}

        {error && <div className="eco-restock-receipt-error" role="alert"><AlertTriangle size={16} /><span>{error}</span></div>}
        <footer className="eco-restock-cart-footer eco-restock-receipt-footer">
          {created ? (
            <><EcoButton type="button" onClick={onClose}>К заказам</EcoButton><Link className="eco-btn eco-btn--primary" href={`/inventory/receipts?document=${encodeURIComponent(created.documentId)}&open=edit`}>Открыть приёмку</Link></>
          ) : (
            <><div className="eco-restock-receipt-totals"><span>{selectedLines.length} поз. · {formatNumber(selectedQty)} шт.</span><strong>{formatMoney(selectedSum)} ₽</strong></div><EcoButton type="button" onClick={onClose}>Назад</EcoButton>{error && !preview && <EcoButton type="button" onClick={() => void fetchPreview()}>Повторить</EcoButton>}<EcoButton type="button" variant="primary" onClick={() => void createDraft()} disabled={!preview || nothingReceivable || !selectedLines.length || saving}>{saving ? <Loader2 size={15} className="eco-spin" /> : <FilePlus2 size={15} />} Создать черновик приёмки</EcoButton></>
          )}
        </footer>
      </section>
    </div>
  );
}
