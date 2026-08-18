"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, DatabaseZap, Loader2, RefreshCw, X } from "lucide-react";
import type { ProductOemBatchView } from "@/lib/product-oem-batches";

const activeStatuses = new Set(["QUEUED", "RUNNING"]);

function statusTitle(status: string) {
  if (status === "QUEUED") return "Ожидает запуска";
  if (status === "RUNNING") return "Заполняем OEM";
  if (status === "COMPLETED") return "OEM заполнены";
  if (status === "COMPLETED_WITH_ERRORS") return "Завершено с замечаниями";
  return status;
}

function productCountLabel(count: number) {
  const lastTwo = count % 100;
  if (lastTwo >= 11 && lastTwo <= 14) return "товаров";
  if (count % 10 === 1) return "товара";
  if (count % 10 >= 2 && count % 10 <= 4) return "товаров";
  return "товаров";
}

async function responseJson<T>(response: Response): Promise<T & { error?: string }> {
  return response.json() as Promise<T & { error?: string }>;
}

export default function ProductOemBatchPanel({
  open,
  productIds,
  selection = null,
  source = "CATALOG",
  existingBatchId = null,
  onClose,
  onBatchChange,
  onShowResult,
}: {
  open: boolean;
  productIds: string[];
  selection?: Record<string, unknown> | null;
  source?: string;
  existingBatchId?: string | null;
  onClose: () => void;
  onBatchChange?: (batch: ProductOemBatchView) => void;
  onShowResult?: (batchId: string, result: "remaining" | "error" | "no_results" | "missing_source") => void;
}) {
  const batchLoadInFlightRef = useRef(false);
  const [batch, setBatch] = useState<ProductOemBatchView | null>(null);
  const [preview, setPreview] = useState<{ total: number; items: Array<{ id: string; name: string; article: string }> } | null>(null);
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestKey = `${existingBatchId ?? "new"}:${productIds.join(",")}:${JSON.stringify(selection ?? {})}:${source}`;

  const acceptBatch = useCallback((next: ProductOemBatchView) => {
    setBatch(next);
    onBatchChange?.(next);
  }, [onBatchChange]);

  const loadBatch = useCallback(async (batchId: string, quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const response = await fetch(`/api/products/oem-batches/${encodeURIComponent(batchId)}`, { cache: "no-store" });
      const data = await responseJson<{ batch: ProductOemBatchView }>(response);
      if (!response.ok) throw new Error(data.error || "Не удалось получить прогресс");
      acceptBatch(data.batch);
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось получить прогресс");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [acceptBatch]);

  const loadPreview = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/products/oem-batches/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productIds, selection }),
      });
      const data = await responseJson<{ preview: { total: number; items: Array<{ id: string; name: string; article: string }> } }>(response);
      if (!response.ok) throw new Error(data.error || "Не удалось подготовить превью");
      setPreview(data.preview);
      setError(null);
    } catch (requestError) {
      setPreview(null);
      setError(requestError instanceof Error ? requestError.message : "Не удалось подготовить превью");
    } finally {
      setLoading(false);
    }
  }, [productIds, selection]);

  useEffect(() => {
    if (!open) return;
    setBatch(null);
    setPreview(null);
    setError(null);
    if (existingBatchId) void loadBatch(existingBatchId);
    else void loadPreview();
  }, [existingBatchId, loadBatch, loadPreview, open, requestKey]);

  useEffect(() => {
    if (!open || !batch || !activeStatuses.has(batch.status)) return;
    const refresh = async () => {
      if (document.visibilityState !== "visible" || batchLoadInFlightRef.current) return;
      batchLoadInFlightRef.current = true;
      try {
        await loadBatch(batch.id, true);
      } finally {
        batchLoadInFlightRef.current = false;
      }
    };
    const timer = window.setInterval(() => void refresh(), 2_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [batch, loadBatch, open]);

  async function start() {
    if (!preview?.total || starting) return;
    setStarting(true);
    setError(null);
    try {
      const response = await fetch("/api/products/oem-batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productIds, selection, source }),
      });
      const data = await responseJson<{ batch: ProductOemBatchView }>(response);
      if (!response.ok) throw new Error(data.error || "Не удалось запустить заполнение OEM");
      acceptBatch(data.batch);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось запустить заполнение OEM");
    } finally {
      setStarting(false);
    }
  }

  async function retry() {
    if (!batch || starting) return;
    setStarting(true);
    setError(null);
    try {
      const response = await fetch(`/api/products/oem-batches/${encodeURIComponent(batch.id)}/retry`, { method: "POST" });
      const data = await responseJson<{ batch: ProductOemBatchView }>(response);
      if (!response.ok) throw new Error(data.error || "Не удалось повторить обработку");
      acceptBatch(data.batch);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось повторить обработку");
    } finally {
      setStarting(false);
    }
  }

  const retryable = batch?.errorItems ?? 0;
  const percentage = batch?.totalItems ? Math.round(batch.processedItems / batch.totalItems * 100) : 0;
  const issues = useMemo(() => batch?.items.filter((item) => ["FAILED", "ERROR", "NO_RESULTS", "MISSING_SOURCE_DATA"].includes(item.status)) ?? [], [batch]);
  const finished = Boolean(batch && !activeStatuses.has(batch.status));

  if (!open) return null;
  return <div className="oem-batch-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="oem-batch-panel" role="dialog" aria-modal="true" aria-labelledby="oem-batch-title" onMouseDown={(event) => event.stopPropagation()}>
      <header>
        <div><span><DatabaseZap size={15} /> Фоновая обработка ROSSKO</span><h2 id="oem-batch-title">Заполнение OEM Parts</h2></div>
        <button type="button" onClick={onClose} aria-label="Закрыть"><X size={18} /></button>
      </header>

      {loading ? <div className="oem-batch-loading"><Loader2 className="animate-spin" /> Загружаем сохранённый прогресс…</div> : !batch ? <div className="oem-batch-confirm">
        <DatabaseZap size={32} />
        <h3>Заполнить OEM Parts для {(preview?.total ?? 0).toLocaleString("ru-RU")} {productCountLabel(preview?.total ?? 0)}?</h3>
        <p>ROSSKO будет опрашиваться последовательно в фоне. Уже заполненные OEM не изменятся. Окно можно закрыть — задача и прогресс сохранятся.</p>
        {preview?.items.length ? <div className="oem-batch-preview-list" aria-label="Примеры товаров">
          {preview.items.slice(0, 4).map((item) => <span key={item.id}><b>{item.name}</b><small>{item.article || "без артикула"}</small></span>)}
          {preview.total > 4 ? <em>и ещё {(preview.total - 4).toLocaleString("ru-RU")}</em> : null}
        </div> : null}
        <div className="oem-batch-confirm__note"><AlertTriangle size={15} /><span>Найденные номера записываются прямо в карточки товаров. Ошибки можно повторить отдельно; позиции без результата останутся в фильтре.</span></div>
      </div> : <div className="oem-batch-progress">
        <div className="oem-batch-progress__heading">
          <div>{activeStatuses.has(batch.status) ? <Loader2 size={18} className="animate-spin" /> : batch.status === "COMPLETED" ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}<span><b>{statusTitle(batch.status)}</b><small>{batch.currentProductName ? `Сейчас: ${batch.currentProductName}` : `Обработано ${batch.processedItems} из ${batch.totalItems}`}</small></span></div>
          <strong>{percentage}%</strong>
        </div>
        <div className="oem-batch-progress__bar" role="progressbar" aria-valuemin={0} aria-valuemax={batch.totalItems} aria-valuenow={batch.processedItems}><i style={{ width: `${percentage}%` }} /></div>
        <dl>
          <div><dt>Обработано</dt><dd>{batch.processedItems} / {batch.totalItems}</dd></div>
          <div><dt>Заполнено</dt><dd>{batch.completedItems}</dd></div>
          <div><dt>Уже было</dt><dd>{batch.skippedItems}</dd></div>
          <div><dt>Без результата</dt><dd>{batch.noResultsItems}</dd></div>
          <div><dt>Нет данных</dt><dd>{batch.missingSourceItems}</dd></div>
          <div><dt>Ошибок</dt><dd>{batch.errorItems}</dd></div>
        </dl>
        {finished && batch.source === "CATALOG_OEM_MISSING" ? <div className="oem-batch-result-summary">
          <b>Из списка без OEM Parts обработано {batch.processedItems.toLocaleString("ru-RU")} товаров.</b>
          <span>OEM заполнены у {batch.completedItems.toLocaleString("ru-RU")}.</span>
          <span>Осталось без OEM — {batch.remainingItems.toLocaleString("ru-RU")}.</span>
          {batch.remainingItems > 0 ? <div>
            <button type="button" className="eco-btn eco-btn--sm" onClick={() => onShowResult?.(batch.id, "remaining")}>Показать оставшиеся {batch.remainingItems.toLocaleString("ru-RU")}</button>
          </div> : null}
        </div> : null}
        {finished && batch.remainingItems > 0 ? <div className="oem-batch-result-filters">
          <span>OEM enrichment result:</span>
          {batch.errorItems ? <button type="button" onClick={() => onShowResult?.(batch.id, "error")}>Ошибка ({batch.errorItems})</button> : null}
          {batch.noResultsItems ? <button type="button" onClick={() => onShowResult?.(batch.id, "no_results")}>ROSSKO ничего не нашёл ({batch.noResultsItems})</button> : null}
          {batch.missingSourceItems ? <button type="button" onClick={() => onShowResult?.(batch.id, "missing_source")}>Не хватает бренда/артикула ({batch.missingSourceItems})</button> : null}
        </div> : null}
        {issues.length ? <details className="oem-batch-issues"><summary>Показать замечания ({issues.length})</summary><div>{issues.map((item) => <article key={item.id}><b>{item.productName}</b><span>{item.article || "без артикула"}</span><p>{item.errorMessage || "OEM не найдены"}</p></article>)}</div></details> : null}
        {activeStatuses.has(batch.status) ? <p className="oem-batch-background-note">Можно закрыть это окно и продолжить работу. Прогресс будет доступен в каталоге товаров.</p> : null}
      </div>}

      {error ? <div className="oem-batch-error"><AlertTriangle size={15} />{error}</div> : null}
      <footer>
        <button type="button" className="eco-btn" onClick={onClose}>{batch && activeStatuses.has(batch.status) ? "Скрыть и продолжить работу" : "Закрыть"}</button>
        {!batch && !loading ? <button type="button" className="eco-btn eco-btn--primary" onClick={() => void start()} disabled={!preview?.total || starting}>{starting ? <Loader2 size={15} className="animate-spin" /> : <DatabaseZap size={15} />}{starting ? "Запускаем…" : "Начать"}</button> : null}
        {batch && !activeStatuses.has(batch.status) && retryable ? <button type="button" className="eco-btn eco-btn--primary" onClick={() => void retry()} disabled={starting}>{starting ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}{starting ? "Запускаем…" : `Повторить ошибки (${retryable})`}</button> : null}
      </footer>
    </section>
  </div>;
}
