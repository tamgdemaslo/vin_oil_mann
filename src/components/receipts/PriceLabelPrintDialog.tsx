"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckSquare2, ChevronLeft, ChevronRight, Eye, Loader2, Printer, Square, X } from "lucide-react";
import { PriceLabelArtwork, PriceLabelArtworkStyles } from "@/components/receipts/PriceLabelArtwork";
import type { PriceLabel, PriceLabelMode, PriceLabelPreview } from "@/lib/price-labels";

type ReceiptPosition = {
  id: string;
  productId: string | null;
  entityType: string;
  name: string;
  article: string;
  code: string;
  quantity: number;
};

type Props = {
  receiptId: string;
  receiptNumber: string;
  positions: ReceiptPosition[];
  onClose: () => void;
};

function formatQuantity(quantity: number) {
  return quantity.toLocaleString("ru-RU", { maximumFractionDigits: 3 });
}

function formatPrice(cents: number) {
  const value = cents / 100;
  return `${value.toLocaleString("ru-RU", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  })} ₽`;
}

function firstLabelPage(labels: PriceLabel[]) {
  return labels.flatMap((label) => Array.from({ length: label.copies }, () => label));
}

export default function PriceLabelPrintDialog({ receiptId, receiptNumber, positions, onClose }: Props) {
  const printablePositions = useMemo(
    () => positions.filter((position) => Boolean(position.productId) && position.entityType === "product"),
    [positions]
  );
  const [selectedIds, setSelectedIds] = useState<string[]>(() => printablePositions.map((position) => position.id));
  const [mode, setMode] = useState<PriceLabelMode>("BY_PRODUCT");
  const [copiesByProduct, setCopiesByProduct] = useState<Record<string, number>>({});
  const [legalEntityId, setLegalEntityId] = useState("");
  const [preview, setPreview] = useState<PriceLabelPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);

  const requestBody = useMemo(() => {
    const byId = new Map(printablePositions.map((position) => [position.id, position]));
    const items = selectedIds
      .map((receiptItemId) => byId.get(receiptItemId))
      .filter((position): position is ReceiptPosition => Boolean(position))
      .map((position) => ({ receiptItemId: position.id }));

    for (const [productId, copies] of Object.entries(copiesByProduct)) {
      const source = printablePositions.find((position) => position.productId === productId && selectedIds.includes(position.id));
      if (source) {
        const target = items.find((item) => item.receiptItemId === source.id);
        if (target) Object.assign(target, { copies });
      }
    }
    return { items, mode, ...(legalEntityId ? { legalEntityId } : {}) };
  }, [copiesByProduct, legalEntityId, mode, printablePositions, selectedIds]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setPreviewLoading(true);
      setRequestError(null);
      try {
        const response = await fetch(`/api/warehouse/receipts/${encodeURIComponent(receiptId)}/price-labels/preview`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        });
        const data = await response.json().catch(() => null) as PriceLabelPreview & { error?: string } | null;
        if (!response.ok) throw new Error(data?.error || "Не удалось подготовить ценники");
        if (!cancelled) {
          setPreview(data);
          setPageIndex((current) => Math.min(current, Math.max(0, (data?.totalLabels ?? 1) - 1)));
        }
      } catch (error) {
        if (!cancelled) {
          setPreview(null);
          setRequestError(error instanceof Error ? error.message : "Не удалось подготовить ценники");
        }
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [receiptId, requestBody]);

  const pages = useMemo(() => firstLabelPage(preview?.labels ?? []), [preview?.labels]);
  const activePage = pages[pageIndex] ?? pages[0] ?? null;
  const missingPrices = preview?.validationErrors.filter((issue) => issue.code === "missing_price") ?? [];
  const isReady = Boolean(preview?.ok && activePage && preview.legalEntity);
  const allSelected = selectedIds.length === printablePositions.length;

  function togglePosition(id: string) {
    setSelectedIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
    setCopiesByProduct({});
  }

  function setAllSelected() {
    setSelectedIds(allSelected ? [] : printablePositions.map((position) => position.id));
    setCopiesByProduct({});
  }

  function updateCopies(label: PriceLabel, raw: string) {
    const next = Number(raw);
    if (!Number.isInteger(next) || next < 1) return;
    setCopiesByProduct((current) => ({ ...current, [label.productId]: next }));
  }

  async function downloadPdf() {
    if (!preview?.ok) return;
    if (preview.totalLabels > 500 && !window.confirm(`Будет сформировано ${preview.totalLabels.toLocaleString("ru-RU")} ценников. Продолжить?`)) return;
    setPdfBusy(true);
    setRequestError(null);
    try {
      const response = await fetch(`/api/warehouse/receipts/${encodeURIComponent(receiptId)}/price-labels/pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(data?.error || "Не удалось сформировать PDF");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `price-labels-${receiptNumber || "receipt"}.pdf`;
      link.target = "_blank";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "Не удалось сформировать PDF");
    } finally {
      setPdfBusy(false);
    }
  }

  return (
    <div className="eco-price-label-backdrop" role="dialog" aria-modal="true" aria-labelledby="price-label-dialog-title">
      <PriceLabelArtworkStyles />
      <section className="eco-price-label-dialog">
        <header className="eco-price-label-dialog__header">
          <div>
            <span>{receiptNumber}</span>
            <h2 id="price-label-dialog-title">Печать ценников</h2>
            <p>PDF: один ценник на страницу 50 × 30 мм. Печатайте в масштабе 100%.</p>
          </div>
          <button type="button" className="eco-price-label-dialog__close" onClick={onClose} disabled={pdfBusy} aria-label="Закрыть"><X size={18} /></button>
        </header>

        <div className="eco-price-label-dialog__body">
          <section className="eco-price-label-summary" aria-live="polite">
            <div><span>Филиал</span><strong>{preview?.branch?.name || "Загружаем…"}</strong></div>
            <div><span>Организация</span><strong>{preview?.legalEntity?.name || "Требуется выбор"}</strong><small>{preview?.legalEntity?.inn ? `ИНН ${preview.legalEntity.inn}` : ""}</small></div>
            <div><span>Выбрано</span><strong>{preview?.selectedProducts ?? 0} наим. · {formatQuantity(preview?.selectedUnits ?? 0)} ед.</strong></div>
          </section>

          {preview?.legalEntityOptions && (
            <label className="eco-price-label-field">
              <span>Организация для ценников</span>
              <select value={legalEntityId} onChange={(event) => setLegalEntityId(event.target.value)}>
                <option value="">Выберите организацию</option>
                {preview.legalEntityOptions.map((option) => <option key={option.id} value={option.id}>{option.name}{option.inn ? ` · ИНН ${option.inn}` : ""}</option>)}
              </select>
            </label>
          )}

          <section className="eco-price-label-mode">
            <div className="eco-price-label-section-head"><strong>Количество ценников</strong><span>{preview?.totalLabels ?? 0} стр.</span></div>
            <label className={mode === "BY_PRODUCT" ? "is-active" : ""}>
              <input type="radio" name="price-label-mode" checked={mode === "BY_PRODUCT"} onChange={() => { setMode("BY_PRODUCT"); setCopiesByProduct({}); }} />
              <span><b>По наименованиям</b><small>По одному ценнику на каждый выбранный товар.</small></span>
            </label>
            <label className={mode === "BY_QUANTITY" ? "is-active" : ""}>
              <input type="radio" name="price-label-mode" checked={mode === "BY_QUANTITY"} onChange={() => { setMode("BY_QUANTITY"); setCopiesByProduct({}); }} />
              <span><b>По количеству товара</b><small>Количество ценников соответствует принятым единицам.</small></span>
            </label>
          </section>

          <section className="eco-price-label-selection">
            <div className="eco-price-label-section-head">
              <strong>Позиции приёмки</strong>
              <button type="button" onClick={setAllSelected}>{allSelected ? "Снять выделение" : "Выбрать всё"}</button>
            </div>
            <div className="eco-price-label-selection-list">
              {printablePositions.length === 0 ? <div className="eco-price-label-selection-empty">В этой приёмке нет товарных позиций для печати.</div> : printablePositions.map((position) => {
                const selected = selectedIds.includes(position.id);
                return (
                  <label key={position.id} className={selected ? "is-selected" : ""}>
                    <input type="checkbox" checked={selected} onChange={() => togglePosition(position.id)} />
                    {selected ? <CheckSquare2 size={16} /> : <Square size={16} />}
                    <span><b>{position.name}</b><small>{position.article || position.code || "Артикул не указан"} · {formatQuantity(position.quantity)} ед.</small></span>
                  </label>
                );
              })}
            </div>
          </section>

          {preview?.labels.length ? (
            <section className="eco-price-label-table-wrap">
              <table className="eco-price-label-table">
                <thead><tr><th>Товар</th><th>Артикул</th><th>Цена</th><th>Принято</th><th>Ценников</th></tr></thead>
                <tbody>{preview.labels.map((label) => (
                  <tr key={label.productId}>
                    <td>{label.name}</td><td>{label.article || "—"}</td><td>{formatPrice(label.priceCents)}</td><td>{formatQuantity(label.receivedQuantity)}</td>
                    <td><input aria-label={`Количество ценников: ${label.name}`} type="number" min="1" step="1" value={copiesByProduct[label.productId] ?? label.copies} onChange={(event) => updateCopies(label, event.target.value)} /></td>
                  </tr>
                ))}</tbody>
              </table>
            </section>
          ) : null}

          {(requestError || preview?.validationErrors.length) ? (
            <section className="eco-price-label-errors" role="alert">
              <AlertTriangle size={18} />
              <div>
                <strong>{requestError || (missingPrices.length ? `Невозможно сформировать ценники: у ${missingPrices.length} товаров не указана розничная цена.` : "Невозможно сформировать ценники.")}</strong>
                {missingPrices.length > 0 && (
                  <div className="eco-price-label-missing-list">
                    {missingPrices.map((issue) => (
                      <div key={issue.productId || issue.receiptItemId}>
                        <span><b>{issue.productName}</b><small>{issue.article || "Артикул не указан"} · {issue.message}</small></span>
                        {issue.productId ? <a href={`/inventory/products?product=${encodeURIComponent(issue.productId)}`} target="_blank" rel="noreferrer">Указать цену</a> : null}
                      </div>
                    ))}
                  </div>
                )}
                {preview?.validationErrors.filter((issue) => issue.code !== "missing_price").map((issue, index) => <p key={`${issue.code}-${index}`}>{issue.message}</p>)}
              </div>
            </section>
          ) : null}

          {preview?.warnings.length ? <p className="eco-price-label-warning">{preview.warnings[0]}</p> : null}

          <section className="eco-price-label-preview">
            <div className="eco-price-label-section-head"><strong>Предпросмотр</strong><span>{pages.length ? `${pageIndex + 1} из ${pages.length}` : "—"}</span></div>
            {previewLoading ? <div className="eco-price-label-preview-state"><Loader2 size={18} /> Обновляем данные ценника…</div>
              : activePage && preview?.legalEntity ? (
                <div className="eco-price-label-preview-artwork"><PriceLabelArtwork label={{ ...activePage, legalEntity: preview.legalEntity }} /></div>
              ) : <div className="eco-price-label-preview-state">Выберите хотя бы один товар, чтобы увидеть ценник.</div>}
            {pages.length > 1 && <div className="eco-price-label-preview-nav"><button type="button" onClick={() => setPageIndex((index) => Math.max(0, index - 1))} disabled={pageIndex === 0}><ChevronLeft size={16} />Назад</button><button type="button" onClick={() => setPageIndex((index) => Math.min(pages.length - 1, index + 1))} disabled={pageIndex >= pages.length - 1}>Вперёд<ChevronRight size={16} /></button></div>}
          </section>
        </div>

        <footer className="eco-price-label-dialog__footer">
          <button type="button" onClick={onClose} disabled={pdfBusy}>Отмена</button>
          <div>
            <button type="button" onClick={() => setPageIndex(0)} disabled={!isReady || previewLoading}><Eye size={16} />Предпросмотр</button>
            <button type="button" className="is-primary" onClick={() => void downloadPdf()} disabled={!isReady || previewLoading || pdfBusy}>{pdfBusy ? <Loader2 size={16} /> : <Printer size={16} />}{pdfBusy ? "Формируем PDF…" : "Сформировать PDF"}</button>
          </div>
        </footer>
      </section>
    </div>
  );
}
