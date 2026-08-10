"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  PackageCheck,
  RefreshCw,
  Search,
  Truck,
  X,
} from "lucide-react";
import type {
  RosskoImportCreatedProduct,
  RosskoImportExecuteResult,
  RosskoImportPreview,
  RosskoImportPreviewRow,
  RosskoImportStatus,
} from "@/lib/rossko-product-import";

const ROSSKO_ORDERS_STORAGE_KEY = "vin-oil-restock-rossko-orders";

type StoredOrder = {
  externalOrderId: string;
  orderedAt: number;
  createdAt: number;
  lines: Array<{ count?: number; orderedQty?: number; price?: number | null }>;
};

type OrderChoice = {
  id: string;
  orderedAt: number;
  positions: number;
  total: number;
};

type PreviewFilter = "all" | RosskoImportStatus;

const statusLabels: Record<RosskoImportStatus, string> = {
  EXISTS: "Уже есть",
  NEW: "Новый",
  REVIEW: "Требует проверки",
  POSSIBLE_DUPLICATE: "Возможный дубль",
  ERROR: "Ошибка",
};

function money(cents: number | null | undefined) {
  if (cents == null) return "—";
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(cents / 100)} ₽`;
}

function dateLabel(timestamp: number) {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "Дата не сохранена";
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(new Date(timestamp));
}

function readStoredOrders(): OrderChoice[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(ROSSKO_ORDERS_STORAGE_KEY) || "[]") as StoredOrder[];
    const seen = new Set<string>();
    return (Array.isArray(parsed) ? parsed : [])
      .flatMap((order) => {
        const id = String(order?.externalOrderId ?? "").trim();
        if (!/^\d+$/.test(id) || seen.has(id)) return [];
        seen.add(id);
        const lines = Array.isArray(order.lines) ? order.lines : [];
        return [{
          id,
          orderedAt: Number(order.orderedAt || order.createdAt || 0),
          positions: lines.length,
          total: lines.reduce((sum, line) => {
            const quantity = Math.max(1, Number(line.orderedQty ?? line.count ?? 1));
            const price = Number(line.price ?? 0);
            return sum + (Number.isFinite(price) ? price * quantity : 0);
          }, 0),
        }];
      })
      .sort((left, right) => right.orderedAt - left.orderedAt)
      .slice(0, 30);
  } catch {
    return [];
  }
}

function rowCanBeSelected(row: RosskoImportPreviewRow) {
  return row.status !== "EXISTS" && row.status !== "ERROR" && Boolean(
    row.brand.trim() && row.article.trim() && row.name.trim() && row.category.trim() && row.retailPriceCents != null
  );
}

function computeSummary(rows: RosskoImportPreviewRow[]) {
  return {
    total: rows.length,
    exists: rows.filter((row) => row.status === "EXISTS").length,
    new: rows.filter((row) => row.status === "NEW").length,
    review: rows.filter((row) => row.status === "REVIEW").length,
    possibleDuplicate: rows.filter((row) => row.status === "POSSIBLE_DUPLICATE").length,
    error: rows.filter((row) => row.status === "ERROR").length,
    selected: rows.filter((row) => row.selected && rowCanBeSelected(row)).length,
  };
}

export default function RosskoProductImportDialog({
  open,
  onClose,
  onShowCreated,
}: {
  open: boolean;
  onClose: () => void;
  onShowCreated: (products: RosskoImportCreatedProduct[]) => void;
}) {
  const [orders, setOrders] = useState<OrderChoice[]>([]);
  const [orderId, setOrderId] = useState("");
  const [manualOrderId, setManualOrderId] = useState("");
  const [preview, setPreview] = useState<RosskoImportPreview | null>(null);
  const [rows, setRows] = useState<RosskoImportPreviewRow[]>([]);
  const [filter, setFilter] = useState<PreviewFilter>("all");
  const [query, setQuery] = useState("");
  const [brandFilter, setBrandFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [expandedOemRowId, setExpandedOemRowId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RosskoImportExecuteResult | null>(null);

  useEffect(() => {
    if (!open) return;
    const choices = readStoredOrders();
    setOrders(choices);
    setOrderId((current) => current || choices[0]?.id || "");
    setError(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !loading && !creating) onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [creating, loading, onClose, open]);

  const summary = useMemo(() => computeSummary(rows), [rows]);
  const brands = useMemo(() => [...new Set(rows.map((row) => row.brand).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ru")), [rows]);
  const visibleRows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("ru-RU");
    return rows.filter((row) => {
      if (filter !== "all" && row.status !== filter) return false;
      if (brandFilter && row.brand !== brandFilter) return false;
      if (categoryFilter && row.category !== categoryFilter) return false;
      if (needle && ![row.brand, row.article, row.name, row.sourceName, ...row.oemParts].join(" ").toLocaleLowerCase("ru-RU").includes(needle)) return false;
      return true;
    });
  }, [brandFilter, categoryFilter, filter, query, rows]);

  async function loadPreview(id = orderId) {
    const cleanId = id.trim();
    if (!/^\d+$/.test(cleanId) || loading) {
      setError("Укажите номер заказа ROSSKO");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/products/rossko/import/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ orderId: cleanId }),
      });
      const data = await response.json() as RosskoImportPreview & { error?: string };
      if (!response.ok || data.error) throw new Error(data.error || "Не удалось проверить заказ ROSSKO");
      setOrderId(cleanId);
      setPreview(data);
      setRows(data.rows);
      setFilter("all");
      setQuery("");
      setBrandFilter("");
      setCategoryFilter("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось проверить заказ ROSSKO");
    } finally {
      setLoading(false);
    }
  }

  function patchRow(rowId: string, patch: Partial<RosskoImportPreviewRow>) {
    setRows((current) => current.map((row) => {
      if (row.rowId !== rowId) return row;
      const next = { ...row, ...patch };
      if (next.status === "REVIEW" && next.brand.trim() && next.article.trim() && next.name.trim() && next.category.trim() && next.retailPriceCents != null) {
        next.status = "NEW";
        next.statusReason = "Проверено пользователем и готово к созданию";
      }
      if (!rowCanBeSelected(next)) next.selected = false;
      return next;
    }));
  }

  function selectAllNew() {
    setRows((current) => current.map((row) => ({ ...row, selected: row.status === "NEW" && rowCanBeSelected(row) })));
  }

  function clearSelection() {
    setRows((current) => current.map((row) => ({ ...row, selected: false })));
  }

  function recalculateRetail() {
    setRows((current) => current.map((row) => ({
      ...row,
      retailPriceCents: row.recommendedRetailCents,
    })));
  }

  async function executeImport() {
    if (!preview || !summary.selected || creating || preview.blocker) return;
    setCreating(true);
    setError(null);
    try {
      const selectedRows = rows.filter((row) => row.selected && rowCanBeSelected(row));
      const response = await fetch("/api/products/rossko/import/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          orderId: preview.order.id,
          rows: selectedRows.map((row) => ({
            rowId: row.rowId,
            selected: true,
            brand: row.brand,
            article: row.article,
            name: row.name,
            category: row.category,
            oemParts: row.oemParts,
            retailPriceCents: row.retailPriceCents,
          })),
        }),
      });
      const data = await response.json() as RosskoImportExecuteResult & { error?: string };
      if (!response.ok || data.error) throw new Error(data.error || "Не удалось создать товары");
      const resultByRow = new Map(data.rows.map((row) => [row.rowId, row]));
      setRows((current) => current.map((row) => {
        const outcome = resultByRow.get(row.rowId);
        if (!outcome) return row;
        return {
          ...row,
          selected: false,
          status: outcome.status === "FAILED" ? "ERROR" : "EXISTS",
          statusReason: outcome.message,
          existingProductId: outcome.productId,
        };
      }));
      setResult(data);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось создать товары");
    } finally {
      setCreating(false);
    }
  }

  if (!open) return null;

  return (
    <div className="rossko-import-backdrop" role="presentation">
      <button type="button" className="rossko-import-backdrop__dismiss" onClick={onClose} aria-label="Закрыть импорт из ROSSKO" />
      <section className="rossko-import-dialog" role="dialog" aria-modal="true" aria-labelledby="rossko-import-title">
        <header className="rossko-import-header">
          <div>
            <div className="rossko-import-header__context"><Truck size={15} /> Каталог текущего филиала</div>
            <h2 id="rossko-import-title">Импорт товаров из ROSSKO</h2>
            <p>Создаются только карточки с нулевым остатком. Приёмка и складские движения не выполняются.</p>
          </div>
          <button type="button" className="rossko-import-close" onClick={onClose} disabled={loading || creating} aria-label="Закрыть">
            <X size={19} />
          </button>
        </header>

        <div className="rossko-import-steps" aria-label="Шаги импорта">
          <span className={preview ? "is-done" : "is-active"}><b>1</b> Заказ</span>
          <span className={preview && !result ? "is-active" : preview ? "is-done" : ""}><b>2</b> Проверка</span>
          <span className={result ? "is-active" : ""}><b>3</b> Результат</span>
        </div>

        {!preview ? (
          <div className="rossko-import-order-step">
            <div className="rossko-import-section-head">
              <div><h3>Выберите заказ ROSSKO</h3><p>Список собран из заказов, уже созданных в разделе пополнения.</p></div>
            </div>
            {orders.length ? (
              <div className="rossko-import-orders">
                {orders.map((order) => (
                  <label key={order.id} className={`rossko-import-order ${orderId === order.id ? "is-selected" : ""}`}>
                    <input type="radio" name="rossko-order" checked={orderId === order.id} onChange={() => setOrderId(order.id)} />
                    <span><b>№ {order.id}</b><small>{dateLabel(order.orderedAt)}</small></span>
                    <dl><div><dt>Позиций</dt><dd>{order.positions}</dd></div><div><dt>Сумма</dt><dd>{order.total > 0 ? `${order.total.toLocaleString("ru-RU")} ₽` : "уточняется"}</dd></div></dl>
                    <em>ООО «Грин Лайт»</em>
                  </label>
                ))}
              </div>
            ) : (
              <div className="rossko-import-empty-orders">
                <Truck size={27} />
                <strong>Сохранённых заказов в этом браузере нет</strong>
                <span>Введите номер существующего заказа ROSSKO ниже.</span>
              </div>
            )}
            <div className="rossko-import-manual-order">
              <label><span>Номер другого заказа</span><input inputMode="numeric" value={manualOrderId} onChange={(event) => setManualOrderId(event.target.value.replace(/\D+/g, ""))} placeholder="12345678" /></label>
              <button type="button" className="eco-btn" onClick={() => { if (manualOrderId) { setOrderId(manualOrderId); void loadPreview(manualOrderId); } }} disabled={!manualOrderId || loading}>Проверить номер</button>
            </div>
            {error ? <div className="rossko-import-error"><AlertTriangle size={16} />{error}</div> : null}
            <footer className="rossko-import-footer">
              <button type="button" className="eco-btn" onClick={onClose}>Отмена</button>
              <button type="button" className="eco-btn eco-btn--primary" onClick={() => void loadPreview()} disabled={!orderId || loading}>
                {loading ? <Loader2 size={16} className="animate-spin" /> : <PackageCheck size={16} />}
                {loading ? "Анализируем заказ…" : "Загрузить позиции"}
              </button>
            </footer>
          </div>
        ) : result ? (
          <div className="rossko-import-result">
            <div className={`rossko-import-result__icon ${result.failed ? "has-warning" : ""}`}>
              {result.failed ? <AlertTriangle size={28} /> : <CheckCircle2 size={28} />}
            </div>
            <div><h3>Импорт завершён</h3><p>Заказ ROSSKO № {result.orderId}. Остатки новых карточек равны нулю.</p></div>
            <dl className="rossko-import-result__stats">
              <div><dt>Создано</dt><dd>{result.created}</dd></div>
              <div><dt>Уже существовало</dt><dd>{preview.summary.exists}</dd></div>
              <div><dt>Пропущено</dt><dd>{result.skipped}</dd></div>
              <div><dt>Требует проверки</dt><dd>{summary.review + summary.possibleDuplicate}</dd></div>
              <div><dt>Ошибок</dt><dd>{result.failed}</dd></div>
            </dl>
            {error ? <div className="rossko-import-error"><AlertTriangle size={16} />{error}</div> : null}
            <footer className="rossko-import-footer">
              <button type="button" className="eco-btn" onClick={onClose}>Вернуться к товарам</button>
              {summary.review + summary.possibleDuplicate + summary.error > 0 ? (
                <button type="button" className="eco-btn" onClick={() => setResult(null)}>Продолжить проверку ({summary.review + summary.possibleDuplicate + summary.error})</button>
              ) : null}
              {result.createdProducts.length ? (
                <button type="button" className="eco-btn eco-btn--primary" onClick={() => onShowCreated(result.createdProducts)}>Открыть созданные товары</button>
              ) : null}
            </footer>
          </div>
        ) : (
          <div className="rossko-import-preview">
            <div className="rossko-import-preview__topline">
              <div><strong>Заказ № {preview.order.id}</strong><span>{preview.order.positions} позиций · {money(preview.order.totalCents)} · ООО «Грин Лайт»</span></div>
              <button type="button" className="eco-btn" onClick={() => { setPreview(null); setRows([]); setError(null); }} disabled={creating}>Выбрать другой</button>
            </div>

            {preview.blocker ? <div className="rossko-import-blocker"><AlertTriangle size={18} /><div><b>Импорт заблокирован</b><span>{preview.blocker}</span></div></div> : null}

            <div className="rossko-import-summary">
              <span><em>Всего</em><b>{summary.total}</b></span>
              <span><em>Уже есть</em><b>{summary.exists}</b></span>
              <span><em>Новых</em><b>{summary.new}</b></span>
              <span><em>Проверить</em><b>{summary.review + summary.possibleDuplicate}</b></span>
              <span className="is-selected"><em>Будет создано</em><b>{summary.selected}</b></span>
            </div>

            <div className="rossko-import-toolbar">
              <div className="rossko-import-toolbar__actions">
                <button type="button" className="eco-btn" onClick={selectAllNew}>Выбрать все новые</button>
                <button type="button" className="eco-btn" onClick={clearSelection}>Снять выбор</button>
                <button type="button" className="eco-btn" onClick={recalculateRetail}><RefreshCw size={14} /> Пересчитать цены</button>
              </div>
              <div className="rossko-import-toolbar__filters">
                <label className="rossko-import-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Бренд, артикул, OEM…" /></label>
                <select value={brandFilter} onChange={(event) => setBrandFilter(event.target.value)}><option value="">Все бренды</option>{brands.map((brand) => <option key={brand}>{brand}</option>)}</select>
                <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="">Все категории</option>{preview.categories.map((category) => <option key={category}>{category}</option>)}</select>
              </div>
              <div className="rossko-import-status-filters">
                {(["all", "NEW", "EXISTS", "REVIEW", "POSSIBLE_DUPLICATE", "ERROR"] as PreviewFilter[]).map((value) => (
                  <button key={value} type="button" className={filter === value ? "is-active" : ""} onClick={() => setFilter(value)}>
                    {value === "all" ? "Все" : statusLabels[value]}
                  </button>
                ))}
              </div>
            </div>

            <div className="rossko-import-table-wrap">
              <table className="rossko-import-table">
                <thead><tr><th>Создать</th><th>Статус</th><th>Бренд</th><th>Артикул</th><th>Наименование</th><th>Категория</th><th>OEM</th><th className="is-number">Закупка</th><th>Розница</th><th>Поставщик</th></tr></thead>
                <tbody>
                  {visibleRows.map((row) => {
                    const belowRecommended = row.retailPriceCents != null && row.recommendedRetailCents != null && row.retailPriceCents < row.recommendedRetailCents;
                    return [
                      <tr key={row.rowId} className={`is-${row.status.toLocaleLowerCase("ru-RU")} ${row.selected ? "is-selected" : ""}`}>
                        <td><input type="checkbox" checked={row.selected && rowCanBeSelected(row)} disabled={!rowCanBeSelected(row)} onChange={(event) => patchRow(row.rowId, { selected: event.target.checked })} aria-label={`Создать ${row.name}`} /></td>
                        <td><span className={`rossko-import-status is-${row.status.toLocaleLowerCase("ru-RU")}`}>{statusLabels[row.status]}</span><small>{row.statusReason}</small></td>
                        <td><input value={row.brand} onChange={(event) => patchRow(row.rowId, { brand: event.target.value })} disabled={row.status === "EXISTS"} /></td>
                        <td><input value={row.article} onChange={(event) => patchRow(row.rowId, { article: event.target.value })} disabled={row.status === "EXISTS"} /></td>
                        <td><textarea rows={2} value={row.name} onChange={(event) => patchRow(row.rowId, { name: event.target.value })} disabled={row.status === "EXISTS"} /></td>
                        <td><select value={row.category} onChange={(event) => patchRow(row.rowId, { category: event.target.value })} disabled={row.status === "EXISTS"}><option value="">Выберите…</option>{preview.categories.map((category) => <option key={category}>{category}</option>)}</select></td>
                        <td><button type="button" className="rossko-import-oem-button" onClick={() => setExpandedOemRowId((current) => current === row.rowId ? null : row.rowId)}>{row.oemParts.length ? `${row.oemParts.length} номеров` : "Нет OEM"}{expandedOemRowId === row.rowId ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</button></td>
                        <td className="is-number"><b>{money(row.purchasePriceCents)}</b><small>{row.quantity} шт. в заказе</small></td>
                        <td className={belowRecommended ? "has-price-warning" : ""}><input className="rossko-import-money-input" inputMode="decimal" value={row.retailPriceCents == null ? "" : row.retailPriceCents / 100} onChange={(event) => { const value = Number(event.target.value.replace(",", ".")); patchRow(row.rowId, { retailPriceCents: Number.isFinite(value) ? Math.round(value * 100) : null }); }} disabled={row.status === "EXISTS"} />{belowRecommended ? <small>Ниже рекомендации на {money(row.recommendedRetailCents! - row.retailPriceCents!)}</small> : <small>мин. {money(row.recommendedRetailCents)}</small>}</td>
                        <td><span className="rossko-import-supplier">ООО «Грин Лайт»</span></td>
                      </tr>,
                      expandedOemRowId === row.rowId ? (
                        <tr key={`${row.rowId}-oem`} className="rossko-import-oem-row"><td colSpan={10}><label><span>OEM Part / кросс-номера / аналоги</span><textarea value={row.oemParts.join("; ")} onChange={(event) => patchRow(row.rowId, { oemParts: event.target.value.split(/[;,\n]+/).map((value) => value.trim()).filter(Boolean) })} placeholder="ROSSKO не вернул OEM — можно добавить вручную" disabled={row.status === "EXISTS"} /></label>{row.warnings.map((warning) => <small key={warning}><AlertTriangle size={13} />{warning}</small>)}</td></tr>
                      ) : null,
                    ];
                  })}
                </tbody>
              </table>
              {!visibleRows.length ? <div className="rossko-import-no-rows">Нет позиций для выбранных фильтров.</div> : null}
            </div>

            {error ? <div className="rossko-import-error"><AlertTriangle size={16} />{error}</div> : null}
            <footer className="rossko-import-footer rossko-import-preview__footer">
              <span>{summary.selected ? `Выбрано ${summary.selected} из ${summary.total}` : "Выберите готовые позиции"}</span>
              <button type="button" className="eco-btn" onClick={onClose} disabled={creating}>Закрыть</button>
              <button type="button" className="eco-btn eco-btn--primary" onClick={() => void executeImport()} disabled={!summary.selected || creating || Boolean(preview.blocker)}>
                {creating ? <Loader2 size={16} className="animate-spin" /> : <PackageCheck size={16} />}
                {creating ? "Создаём товары…" : `Создать ${summary.selected} товаров`}
              </button>
            </footer>
          </div>
        )}
      </section>
    </div>
  );
}
