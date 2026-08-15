"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  FilePlus2,
  Loader2,
  PackageCheck,
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
  remainingQty: number;
  receiveQty: number;
  purchasePrice: number;
  rosskoStatusLabel: string;
  product: { id: string; name: string; article: string; matchType: string } | null;
  action: RosskoReceiptAction;
  warnings: string[];
};

type RosskoReceiptPreview = {
  order: { id: string; createdAt: string | null; stockAddress: string | null };
  supplier: { id: string | null; name: string; willCreate: boolean };
  store: { id: string; name: string };
  stores: Array<{ id: string; name: string; isMain: boolean }>;
  summary: {
    sourceLines: number;
    orderedQty: number;
    alreadyReceivedQty: number;
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

type TrackedOrderLine = {
  key: string;
  productId: string;
  name: string;
  brand: string;
  article: string;
  orderedQty: number;
  receivedQty: number;
  remainingQty: number;
};

type TrackedOrder = {
  externalOrderId: string;
  createdAt: string | null;
  stockAddress: string | null;
  lines: TrackedOrderLine[];
};

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

function readTrackedOrders(): TrackedOrder[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    const result: TrackedOrder[] = [];
    for (const rawOrder of parsed) {
      const order = asRecord(rawOrder);
      const externalOrderId = String(order.externalOrderId ?? "").trim();
      if (!/^\d+$/.test(externalOrderId)) continue;
      const rawLines = Array.isArray(order.lines) ? order.lines : [];
      const lines = rawLines.map((rawLine, index) => {
        const line = asRecord(rawLine);
        const orderedQty = Math.max(0, Number(line.orderedQty ?? line.count ?? 0));
        const receivedQty = Math.max(0, Number(line.receivedQty ?? 0));
        return {
          key: String(line.id ?? `${externalOrderId}:${index}`),
          productId: String(line.productId ?? ""),
          name: String(line.title ?? line.offerName ?? line.name ?? "Позиция ROSSKO"),
          brand: String(line.brand ?? ""),
          article: String(line.partnumber ?? line.article ?? line.code ?? ""),
          orderedQty,
          receivedQty,
          remainingQty: Math.max(0, Number(line.remainingQty ?? orderedQty - receivedQty)),
        };
      });
      result.push({
        externalOrderId,
        createdAt: typeof order.createdAt === "string" ? order.createdAt : Number.isFinite(Number(order.createdAt)) ? new Date(Number(order.createdAt)).toISOString() : null,
        stockAddress: null,
        lines,
      });
    }
    return result;
  } catch {
    return [];
  }
}

function previewToTrackedOrder(preview: RosskoReceiptPreview): TrackedOrder {
  return {
    externalOrderId: preview.order.id,
    createdAt: preview.order.createdAt,
    stockAddress: preview.order.stockAddress,
    lines: preview.lines.map((line) => ({
      key: line.sourceLineKey,
      productId: line.product?.id ?? "",
      name: line.name,
      brand: line.brand,
      article: line.article,
      orderedQty: line.orderedQty,
      receivedQty: line.alreadyReceivedQty,
      remainingQty: line.remainingQty,
    })),
  };
}

function saveTrackedOrder(order: TrackedOrder, current: TrackedOrder[]) {
  const next = [order, ...current.filter((item) => item.externalOrderId !== order.externalOrderId)];
  try {
    const legacy = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]") as unknown;
    const legacyOrders = Array.isArray(legacy) ? legacy.filter((value) => String(asRecord(value).externalOrderId ?? "") !== order.externalOrderId) : [];
    localStorage.setItem(STORAGE_KEY, JSON.stringify([
      {
        id: `rossko_order:${order.externalOrderId}`,
        supplier: "ROSSKO",
        supplierType: "ROSSKO",
        externalOrderId: order.externalOrderId,
        status: order.lines.every((line) => line.remainingQty <= 0) ? "received" : order.lines.some((line) => line.receivedQty > 0) ? "partially_received" : "ordered",
        createdAt: order.createdAt ? new Date(order.createdAt).getTime() : Date.now(),
        orderedAt: order.createdAt ? new Date(order.createdAt).getTime() : Date.now(),
        lines: order.lines.map((line) => ({
          id: line.key,
          orderId: `rossko_order:${order.externalOrderId}`,
          externalOrderId: order.externalOrderId,
          supplier: "ROSSKO",
          productId: line.productId,
          title: line.name,
          code: line.article,
          partnumber: line.article,
          brand: line.brand,
          stock: order.stockAddress ?? "ROSSKO",
          count: line.orderedQty,
          orderedQty: line.orderedQty,
          receivedQty: line.receivedQty,
          remainingQty: line.remainingQty,
          status: line.remainingQty <= 0 ? "received" : line.receivedQty > 0 ? "partially_received" : "ordered",
        })),
      },
      ...legacyOrders,
    ]));
  } catch {
    // The receipt preview remains usable even when browser storage is unavailable.
  }
  return next;
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
  if (action === "AMBIGUOUS_SOURCE_LINE") return "Неоднозначная строка ROSSKO";
  if (action === "SOURCE_STATUS_WARNING") return "Подтвердите получение";
  return "Проверьте строку";
}

function actionTone(action: RosskoReceiptAction): "neutral" | "success" | "warning" | "danger" | "info" {
  if (action === "MATCHED_EXISTING" || action === "FULLY_RECEIVED") return "success";
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
  const [orders, setOrders] = useState<TrackedOrder[]>([]);
  const [orderId, setOrderId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);

  useEffect(() => setOrders(readTrackedOrders()), []);

  async function addOrder() {
    const id = orderId.trim();
    if (!/^\d+$/.test(id) || busy) {
      setError("Укажите корректный номер заказа ROSSKO");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const preview = await loadPreview(id);
      setOrders((current) => saveTrackedOrder(previewToTrackedOrder(preview), current));
      setOrderId("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось добавить заказ ROSSKO");
    } finally {
      setBusy(false);
    }
  }

  async function refreshTrackedOrder(id: string) {
    try {
      const preview = await loadPreview(id);
      setOrders((current) => saveTrackedOrder(previewToTrackedOrder(preview), current));
    } catch {
      // The created document is already safe; a later page refresh can update the optional browser list.
    }
  }

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
    <div className="eco-restock-cart-shell" role="presentation">
      <button type="button" className="eco-restock-cart-backdrop" aria-label="Закрыть приёмку из ROSSKO" onClick={onClose} />
      <aside className="eco-restock-cart-drawer eco-restock-incoming-drawer" role="dialog" aria-modal="true" aria-labelledby="rossko-workspace-title">
        <header className="eco-restock-cart-head">
          <div>
            <span>Склад · Приёмка</span>
            <h2 id="rossko-workspace-title">Приёмка из ROSSKO</h2>
            <p>Добавьте номер заказа, проверьте поставку и создайте черновик.</p>
          </div>
          <button type="button" className="eco-icon-btn" onClick={onClose} aria-label="Закрыть"><X size={18} /></button>
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

          <div className="eco-restock-incoming-list" aria-label="Заказы ROSSKO в пути">
            {orders.length ? orders.map((order) => {
              const ordered = order.lines.reduce((sum, line) => sum + line.orderedQty, 0);
              const received = order.lines.reduce((sum, line) => sum + line.receivedQty, 0);
              const remaining = order.lines.reduce((sum, line) => sum + line.remainingQty, 0);
              return (
                <article key={order.externalOrderId} className={`eco-restock-incoming-line ${remaining <= 0 ? "is-today" : "is-later"}`}>
                  <div>
                    <strong>Заказ ROSSKO №{order.externalOrderId}</strong>
                    <span>{order.lines.slice(0, 3).map((line) => `${line.brand} ${line.article}`.trim()).filter(Boolean).join(" · ") || "Состав загрузится при открытии"}{order.lines.length > 3 ? ` · ещё ${order.lines.length - 3}` : ""}</span>
                  </div>
                  <dl>
                    <div><dt>Заказано</dt><dd>{formatNumber(ordered)}</dd></div>
                    <div><dt>Принято</dt><dd>{formatNumber(received)}</dd></div>
                    <div><dt>Осталось</dt><dd>{formatNumber(remaining)}</dd></div>
                  </dl>
                  <div className="eco-restock-incoming-line__actions">
                    <EcoBadge tone={remaining <= 0 ? "success" : "info"}>{remaining <= 0 ? "Принят полностью" : "В пути"}</EcoBadge>
                    <EcoButton type="button" size="sm" onClick={() => setActiveOrderId(order.externalOrderId)}>
                      <PackageCheck size={14} />
                      {remaining <= 0 ? "Проверить" : "Принять на склад"}
                    </EcoButton>
                  </div>
                </article>
              );
            }) : (
              <div className="eco-restock-cart-empty">
                <Truck size={30} />
                <strong>Заказы ещё не добавлены</strong>
                <span>Введите номер заказа ROSSKO выше. Заказ будет проверен на сервере текущего филиала.</span>
              </div>
            )}
          </div>
        </div>

        <footer className="eco-restock-cart-footer">
          <span>Черновик не меняет остатки до штатного проведения приёмки.</span>
          <EcoButton type="button" onClick={onClose}>Закрыть</EcoButton>
        </footer>
      </aside>
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
  const allReceived = Boolean(preview?.lines.length && preview.lines.every((line) => line.remainingQty <= 0));

  return (
    <div className="eco-restock-cart-shell" role="presentation">
      <button type="button" className="eco-restock-cart-backdrop" aria-label="Закрыть заказ ROSSKO" onClick={onClose} />
      <aside className="eco-restock-cart-drawer eco-restock-receipt-drawer" role="dialog" aria-modal="true" aria-labelledby="rossko-receipt-title">
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
              <div><span>Осталось</span><strong>{formatNumber(preview.summary.remainingQty)} шт.</strong><small>принято {formatNumber(preview.summary.alreadyReceivedQty)} из {formatNumber(preview.summary.orderedQty)}</small></div>
            </div>

            <div className="eco-restock-cart-body eco-restock-receipt-body">
              {allReceived ? (
                <div className="eco-restock-cart-empty"><PackageCheck size={30} /><strong>Заказ полностью принят</strong><span>Проведённые приёмки уже покрывают количество заказа ROSSKO.</span></div>
              ) : (
                <div className="eco-restock-receipt-table-wrap">
                  <table className="eco-restock-receipt-table">
                    <thead><tr><th aria-label="Выбрать" /><th>Товар</th><th>Артикул</th><th>Статус</th><th className="l-number">Заказано</th><th className="l-number">Принято</th><th className="l-number">Осталось</th><th className="l-number">Принимаем</th><th>Каталог</th><th className="l-number">Закупка</th></tr></thead>
                    <tbody>
                      {preview.lines.map((line) => {
                        const blocked = ["FULLY_RECEIVED", "INVALID_LINE", "AMBIGUOUS_SOURCE_LINE"].includes(line.action);
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
                              <tr className="eco-restock-receipt-detail-row"><td /><td colSpan={9}>
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
            <><div className="eco-restock-receipt-totals"><span>{selectedLines.length} поз. · {formatNumber(selectedQty)} шт.</span><strong>{formatMoney(selectedSum)} ₽</strong></div><EcoButton type="button" onClick={onClose}>Назад</EcoButton>{error && !preview && <EcoButton type="button" onClick={() => void fetchPreview()}>Повторить</EcoButton>}<EcoButton type="button" variant="primary" onClick={() => void createDraft()} disabled={!preview || allReceived || !selectedLines.length || saving}>{saving ? <Loader2 size={15} className="eco-spin" /> : <FilePlus2 size={15} />} Создать черновик приёмки</EcoButton></>
          )}
        </footer>
      </aside>
    </div>
  );
}
