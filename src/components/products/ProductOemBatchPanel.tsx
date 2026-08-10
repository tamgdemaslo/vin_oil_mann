"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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

async function responseJson<T>(response: Response): Promise<T & { error?: string }> {
  return response.json() as Promise<T & { error?: string }>;
}

export default function ProductOemBatchPanel({
  open,
  productIds,
  source = "CATALOG",
  existingBatchId = null,
  onClose,
  onBatchChange,
}: {
  open: boolean;
  productIds: string[];
  source?: string;
  existingBatchId?: string | null;
  onClose: () => void;
  onBatchChange?: (batch: ProductOemBatchView) => void;
}) {
  const [batch, setBatch] = useState<ProductOemBatchView | null>(null);
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestKey = `${existingBatchId ?? "new"}:${productIds.join(",")}:${source}`;

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

  useEffect(() => {
    if (!open) return;
    setBatch(null);
    setError(null);
    if (existingBatchId) void loadBatch(existingBatchId);
  }, [existingBatchId, loadBatch, open, requestKey]);

  useEffect(() => {
    if (!open || !batch || !activeStatuses.has(batch.status)) return;
    const timer = window.setInterval(() => void loadBatch(batch.id, true), 2_000);
    return () => window.clearInterval(timer);
  }, [batch, loadBatch, open]);

  async function start() {
    if (!productIds.length || starting) return;
    setStarting(true);
    setError(null);
    try {
      const response = await fetch("/api/products/oem-batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productIds, source }),
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

  const retryable = (batch?.noResultsItems ?? 0) + (batch?.errorItems ?? 0);
  const percentage = batch?.totalItems ? Math.round(batch.processedItems / batch.totalItems * 100) : 0;
  const issues = useMemo(() => batch?.items.filter((item) => item.status === "ERROR" || item.status === "NO_RESULTS") ?? [], [batch]);

  if (!open) return null;
  return <div className="oem-batch-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="oem-batch-panel" role="dialog" aria-modal="true" aria-labelledby="oem-batch-title" onMouseDown={(event) => event.stopPropagation()}>
      <header>
        <div><span><DatabaseZap size={15} /> Фоновая обработка ROSSKO</span><h2 id="oem-batch-title">Заполнение OEM Parts</h2></div>
        <button type="button" onClick={onClose} aria-label="Закрыть"><X size={18} /></button>
      </header>

      {loading ? <div className="oem-batch-loading"><Loader2 className="animate-spin" /> Загружаем сохранённый прогресс…</div> : !batch ? <div className="oem-batch-confirm">
        <DatabaseZap size={32} />
        <h3>Заполнить OEM для {productIds.length} {productIds.length === 1 ? "товара" : "товаров"}?</h3>
        <p>ROSSKO будет опрашиваться последовательно в фоне. Уже заполненные OEM не изменятся. Окно можно закрыть — задача и прогресс сохранятся.</p>
        <div className="oem-batch-confirm__note"><AlertTriangle size={15} /><span>Найденные номера записываются прямо в карточки товаров. Позиции без результата можно повторить отдельно.</span></div>
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
          <div><dt>Ошибок</dt><dd>{batch.errorItems}</dd></div>
        </dl>
        {issues.length ? <details className="oem-batch-issues"><summary>Показать замечания ({issues.length})</summary><div>{issues.map((item) => <article key={item.id}><b>{item.productName}</b><span>{item.article || "без артикула"}</span><p>{item.errorMessage || "OEM не найдены"}</p></article>)}</div></details> : null}
        {activeStatuses.has(batch.status) ? <p className="oem-batch-background-note">Можно закрыть это окно и продолжить работу. Прогресс будет доступен в каталоге товаров.</p> : null}
      </div>}

      {error ? <div className="oem-batch-error"><AlertTriangle size={15} />{error}</div> : null}
      <footer>
        <button type="button" className="eco-btn" onClick={onClose}>{batch && activeStatuses.has(batch.status) ? "Скрыть и продолжить работу" : "Закрыть"}</button>
        {!batch && !loading ? <button type="button" className="eco-btn eco-btn--primary" onClick={() => void start()} disabled={!productIds.length || starting}>{starting ? <Loader2 size={15} className="animate-spin" /> : <DatabaseZap size={15} />}{starting ? "Запускаем…" : "Начать заполнение"}</button> : null}
        {batch && !activeStatuses.has(batch.status) && retryable ? <button type="button" className="eco-btn eco-btn--primary" onClick={() => void retry()} disabled={starting}>{starting ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}{starting ? "Запускаем…" : `Повторить ошибки (${retryable})`}</button> : null}
      </footer>
    </section>
  </div>;
}
