"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarDays,
  ExternalLink,
  History,
  Loader2,
  PackageSearch,
  Search,
  Warehouse,
  X,
} from "lucide-react";

type HistoryDirection = "in" | "out" | "none";
type HistoryFilter = "all" | "incoming" | "outgoing" | "inventory";
type HistoryPeriod = "30" | "90" | "365" | "all";

type HistoryActor = {
  id: string | null;
  name: string;
};

type HistoryItem = {
  id: string;
  documentType: "shipment" | "receipt" | "writeoff" | "adjustment" | "inventory" | "transfer" | "other";
  documentTypeLabel: string;
  documentId: string;
  documentNumber: string;
  documentDate: string;
  status: string;
  quantity: number;
  quantityDirection: HistoryDirection;
  unit: string;
  storeId: string | null;
  storeName: string | null;
  counterpartyName: string | null;
  vehicleDisplayName: string | null;
  clientDisplayName: string | null;
  createdBy: HistoryActor | null;
  postedBy: HistoryActor | null;
  href: string | null;
  description: string | null;
  inventory: {
    accountedQuantity: number;
    actualQuantity: number | null;
    adjustmentQuantity: number | null;
  } | null;
  routeLabel: string | null;
};

type HistoryResponse = {
  product: {
    id: string;
    branchId: string;
    branchName: string | null;
    unit: string;
  };
  items: HistoryItem[];
  nextCursor: string | null;
  summary: {
    currentQuantity: number;
    currentAvailable: number;
    currentReserve: number;
    incomingQuantity30Days: number;
    outgoingQuantity30Days: number;
    documentCount30Days: number;
  };
  stores: Array<{ id: string; name: string; isMain: boolean }>;
};

const filterOptions: Array<{ value: HistoryFilter; label: string }> = [
  { value: "all", label: "Все" },
  { value: "incoming", label: "Приход" },
  { value: "outgoing", label: "Расход" },
  { value: "inventory", label: "Инвентаризация" },
];

const periodOptions: Array<{ value: HistoryPeriod; label: string }> = [
  { value: "30", label: "30 дней" },
  { value: "90", label: "90 дней" },
  { value: "365", label: "Год" },
  { value: "all", label: "Всё время" },
];

const quantityFormatter = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 });
const timeFormatter = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" });
const dateFormatter = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" });
const dateWithYearFormatter = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" });

function dateFromPeriod(period: HistoryPeriod) {
  if (period === "all") return null;
  const date = new Date();
  date.setDate(date.getDate() - Number(period));
  return date.toISOString();
}

function statusLabel(status: string) {
  if (status === "posted") return "Проведено";
  if (status === "in_transit") return "В пути";
  if (status === "cancelled") return "Отменено";
  if (status === "reversed") return "Сторнировано";
  return "Черновик";
}

function quantityLabel(item: HistoryItem) {
  const sign = item.quantityDirection === "in" ? "+" : item.quantityDirection === "out" ? "−" : "";
  return `${sign}${quantityFormatter.format(Math.abs(item.quantity))} ${item.unit}`;
}

function dayKey(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dayLabel(value: string) {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (dayKey(value) === dayKey(today.toISOString())) return "Сегодня";
  if (dayKey(value) === dayKey(yesterday.toISOString())) return "Вчера";
  return date.getFullYear() === today.getFullYear() ? dateFormatter.format(date) : dateWithYearFormatter.format(date);
}

function groupItems(items: HistoryItem[]) {
  const groups: Array<{ key: string; label: string; items: HistoryItem[] }> = [];
  for (const item of items) {
    const key = dayKey(item.documentDate);
    const current = groups[groups.length - 1];
    if (current?.key === key) current.items.push(item);
    else groups.push({ key, label: dayLabel(item.documentDate), items: [item] });
  }
  return groups;
}

async function readHistoryResponse(response: Response): Promise<HistoryResponse> {
  const data = await response.json().catch(() => null) as (HistoryResponse & { error?: string }) | null;
  if (!response.ok || !data) throw new Error(data?.error ?? "Не удалось загрузить историю товара");
  return data;
}

function HistorySkeleton() {
  return (
    <div className="product-history-skeleton" aria-label="Загружаем историю товара">
      {Array.from({ length: 5 }, (_, index) => (
        <span key={index}><i /><b /><em /></span>
      ))}
    </div>
  );
}

function HistoryRow({ item }: { item: HistoryItem }) {
  const title = `${item.documentTypeLabel} ${item.documentNumber}`;
  const context = item.routeLabel ?? item.vehicleDisplayName ?? item.counterpartyName ?? item.clientDisplayName;
  return (
    <article className={`product-history-row is-${item.documentType}`}>
      <div className="product-history-row__top">
        <span className={`product-history-direction is-${item.quantityDirection}`} aria-hidden>
          {item.quantityDirection === "in" ? <ArrowDownLeft /> : item.quantityDirection === "out" ? <ArrowUpRight /> : <History />}
        </span>
        <div className="product-history-row__title">
          {item.href ? <a href={item.href}>{title}</a> : <strong>{title}</strong>}
          <time dateTime={item.documentDate}>{timeFormatter.format(new Date(item.documentDate))}</time>
        </div>
        <b className={`product-history-quantity is-${item.quantityDirection}`}>{quantityLabel(item)}</b>
      </div>

      {context ? <p className="product-history-context">{context}</p> : null}
      <div className="product-history-row__meta">
        {item.storeName ? <span><Warehouse aria-hidden />{item.storeName}</span> : null}
        <span className={`product-history-status is-${item.status}`}>{statusLabel(item.status)}</span>
      </div>

      <details className="product-history-details">
        <summary>Подробнее</summary>
        <dl>
          <div><dt>Дата</dt><dd>{dateWithYearFormatter.format(new Date(item.documentDate))}, {timeFormatter.format(new Date(item.documentDate))}</dd></div>
          {item.inventory ? (
            <>
              <div><dt>Учёт</dt><dd>{quantityFormatter.format(item.inventory.accountedQuantity)} {item.unit}</dd></div>
              <div><dt>Факт</dt><dd>{item.inventory.actualQuantity == null ? "—" : `${quantityFormatter.format(item.inventory.actualQuantity)} ${item.unit}`}</dd></div>
              <div><dt>Корректировка</dt><dd>{item.inventory.adjustmentQuantity == null ? "—" : `${item.inventory.adjustmentQuantity > 0 ? "+" : ""}${quantityFormatter.format(item.inventory.adjustmentQuantity)} ${item.unit}`}</dd></div>
            </>
          ) : null}
          {item.counterpartyName ? <div><dt>Контрагент</dt><dd>{item.counterpartyName}</dd></div> : null}
          {item.createdBy ? <div><dt>Создал</dt><dd>{item.createdBy.name}</dd></div> : null}
          {item.postedBy ? <div><dt>Провёл</dt><dd>{item.postedBy.name}</dd></div> : null}
          {item.description ? <div><dt>Комментарий</dt><dd>{item.description}</dd></div> : null}
        </dl>
        {item.href ? <a className="product-history-open" href={item.href}>Открыть документ <ExternalLink aria-hidden /></a> : <p className="product-history-no-link">Для этого типа документа отдельная страница пока не предусмотрена.</p>}
      </details>
    </article>
  );
}

export default function ProductHistoryPanel({ productId }: { productId: string }) {
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const [period, setPeriod] = useState<HistoryPeriod>("90");
  const [storeId, setStoreId] = useState("");
  const [queryDraft, setQueryDraft] = useState("");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [meta, setMeta] = useState<HistoryResponse | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryRevision, setRetryRevision] = useState(0);
  const requestRevision = useRef(0);

  useEffect(() => {
    const revision = ++requestRevision.current;
    const controller = new AbortController();
    const params = new URLSearchParams({ type: filter, limit: "30" });
    const dateFrom = dateFromPeriod(period);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (storeId) params.set("storeId", storeId);
    if (query) params.set("q", query);

    setLoading(true);
    setLoadingMore(false);
    setItems([]);
    setNextCursor(null);
    setMeta((current) => current?.product.id === productId ? current : null);
    setError(null);
    void fetch(`/api/local-products/${encodeURIComponent(productId)}/history?${params.toString()}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(readHistoryResponse)
      .then((data) => {
        if (requestRevision.current !== revision) return;
        setItems(data.items);
        setMeta(data);
        setNextCursor(data.nextCursor);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted || requestRevision.current !== revision) return;
        setItems([]);
        setError(reason instanceof Error ? reason.message : "Не удалось загрузить историю товара");
      })
      .finally(() => {
        if (requestRevision.current === revision) setLoading(false);
      });

    return () => controller.abort();
  }, [filter, period, productId, query, retryRevision, storeId]);

  const groups = useMemo(() => groupItems(items), [items]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setQuery(queryDraft.trim());
  }

  function clearSearch() {
    setQueryDraft("");
    setQuery("");
  }

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    const revision = requestRevision.current;
    const params = new URLSearchParams({ type: filter, limit: "30", cursor: nextCursor });
    const dateFrom = dateFromPeriod(period);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (storeId) params.set("storeId", storeId);
    if (query) params.set("q", query);
    setLoadingMore(true);
    setError(null);
    try {
      const data = await readHistoryResponse(await fetch(
        `/api/local-products/${encodeURIComponent(productId)}/history?${params.toString()}`,
        { cache: "no-store" }
      ));
      if (requestRevision.current !== revision) return;
      setItems((current) => [...current, ...data.items.filter((item) => !current.some((existing) => existing.id === item.id))]);
      setNextCursor(data.nextCursor);
    } catch (reason) {
      if (requestRevision.current !== revision) return;
      setError(reason instanceof Error ? reason.message : "Не удалось загрузить продолжение истории");
    } finally {
      if (requestRevision.current === revision) setLoadingMore(false);
    }
  }

  return (
    <section className="product-editor-side-card product-history-panel" aria-labelledby="product-history-title">
      <header className="product-history-head">
        <div>
          <h3 id="product-history-title">История товара</h3>
          <p>Документы, в которых участвовал товар</p>
        </div>
        <History aria-hidden />
      </header>

      {meta && !loading ? (
        <div className="product-history-summary">
          <span><em>Остаток</em><b>{quantityFormatter.format(meta.summary.currentQuantity)} {meta.product.unit}</b></span>
          <span><em>Доступно</em><b>{quantityFormatter.format(meta.summary.currentAvailable)} {meta.product.unit}</b></span>
          <span><em>Резерв</em><b>{quantityFormatter.format(meta.summary.currentReserve)} {meta.product.unit}</b></span>
          <strong className="product-history-summary__period">За 30 дней</strong>
          <span className="is-in"><em>Пришло</em><b>+{quantityFormatter.format(meta.summary.incomingQuantity30Days)} {meta.product.unit}</b></span>
          <span className="is-out"><em>Ушло</em><b>−{quantityFormatter.format(meta.summary.outgoingQuantity30Days)} {meta.product.unit}</b></span>
          <span><em>Документов</em><b>{meta.summary.documentCount30Days}</b></span>
          {meta.product.branchName ? <small className="product-history-summary__branch">Филиал: {meta.product.branchName}</small> : null}
        </div>
      ) : null}

      <div className="product-history-filters" role="group" aria-label="Фильтры истории товара">
        <div className="product-history-filter-tabs">
          {filterOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className={filter === option.value ? "is-active" : ""}
              aria-pressed={filter === option.value}
              onClick={() => setFilter(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="product-history-selects">
          <label>
            <span>Период</span>
            <select value={period} onChange={(event) => setPeriod(event.target.value as HistoryPeriod)}>
              {periodOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label>
            <span>Склад</span>
            <select value={storeId} onChange={(event) => setStoreId(event.target.value)}>
              <option value="">Все склады</option>
              {(meta?.stores ?? []).map((store) => <option key={store.id} value={store.id}>{store.name}{store.isMain ? " · основной" : ""}</option>)}
            </select>
          </label>
        </div>
        <form className="product-history-search" onSubmit={submitSearch}>
          <Search aria-hidden />
          <input value={queryDraft} onChange={(event) => setQueryDraft(event.target.value)} placeholder="Номер документа" aria-label="Номер документа" />
          {queryDraft || query ? <button type="button" onClick={clearSearch} aria-label="Очистить поиск"><X aria-hidden /></button> : null}
        </form>
      </div>

      {loading ? <HistorySkeleton /> : null}
      {!loading && error ? (
        <div className="product-history-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setRetryRevision((current) => current + 1)}>Повторить</button>
        </div>
      ) : null}
      {!loading && !error && items.length === 0 ? (
        <div className="product-history-empty">
          <PackageSearch aria-hidden />
          <b>{query || filter !== "all" || period !== "90" || storeId ? "По выбранным условиям документов нет" : "Этот товар пока не участвовал ни в одном документе."}</b>
          <p>История появится после добавления товара в отгрузку, приёмку, списание или инвентаризацию.</p>
        </div>
      ) : null}

      {!loading && items.length ? (
        <div className="product-history-timeline">
          {groups.map((group) => (
            <section key={group.key} className="product-history-day">
              <h4><CalendarDays aria-hidden />{group.label}</h4>
              <div>{group.items.map((item) => <HistoryRow key={item.id} item={item} />)}</div>
            </section>
          ))}
        </div>
      ) : null}

      {nextCursor ? (
        <button type="button" className="product-history-more" onClick={() => void loadMore()} disabled={loadingMore}>
          {loadingMore ? <Loader2 aria-hidden className="animate-spin" /> : null}
          {loadingMore ? "Загружаем..." : "Показать ещё"}
        </button>
      ) : null}
    </section>
  );
}
