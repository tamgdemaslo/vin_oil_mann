"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, ArrowRight, CheckCircle2, ChevronRight, Copy, ExternalLink, Loader2, X } from "lucide-react";

type Branch = { id: string; name: string; displayName: string; address: string | null };
type CopyOptions = {
  copyRetailPrice: boolean;
  copyPurchasePrice: boolean;
  copyMinimumBalance: boolean;
  mapSupplierByInn: boolean;
  duplicateStrategy: "skip" | "update_empty" | "update_selected" | "force_create";
};
type PreviewRow = {
  sourceProductId: string;
  productName: string;
  article: string | null;
  action: "CREATE" | "SKIP" | "UPDATE_EMPTY" | "UPDATE_SELECTED" | "FORCE_CREATE" | "REVIEW";
  matchingMethod: string | null;
  targetProductId: string | null;
  reason: string | null;
  warnings: string[];
};
type Preview = { sourceBranch: Branch; targetBranch: Branch; totalSelected: number; rows: PreviewRow[]; counts: Record<string, number> };
type Result = { id: string; status: string; targetBranchId: string; totalSelected: number; created: number; updated: number; skipped: number; failed: number; priceNeedsSetup: number; suppliersUnmapped: number };
type CapabilityResponse = { canCopy?: boolean; sourceBranch?: Branch | null; targetBranches?: Branch[]; error?: string };

const defaultOptions: CopyOptions = {
  copyRetailPrice: true,
  copyPurchasePrice: false,
  copyMinimumBalance: false,
  mapSupplierByInn: false,
  duplicateStrategy: "skip",
};
const strategyOptions: Array<{ value: CopyOptions["duplicateStrategy"]; label: string; help: string }> = [
  { value: "skip", label: "Пропустить", help: "Не создавать карточку, если найден дубль." },
  { value: "update_empty", label: "Заполнить пустые", help: "Заполнить только пустые поля существующей карточки." },
  { value: "update_selected", label: "Обновить выбранное", help: "Обновить переносимые поля по выбранным настройкам." },
  { value: "force_create", label: "Создать всё равно", help: "Создать отдельную карточку даже при совпадении." },
];

function makeIdempotencyKey() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "product-copy-" + Date.now() + "-" + Math.random().toString(16).slice(2);
}

function actionLabel(action: PreviewRow["action"]) {
  return {
    CREATE: "Будет создана",
    FORCE_CREATE: "Создать всё равно",
    SKIP: "Пропустить",
    UPDATE_EMPTY: "Заполнить пустые",
    UPDATE_SELECTED: "Обновить",
    REVIEW: "Нужна проверка",
  }[action];
}

function actionTone(action: PreviewRow["action"]) {
  if (action === "CREATE" || action === "FORCE_CREATE") return "is-create";
  if (action === "SKIP") return "is-skip";
  if (action === "REVIEW") return "is-review";
  return "is-update";
}

function cardCountText(value: number) {
  const count = Math.abs(value) % 100;
  const lastDigit = count % 10;
  const noun = count > 10 && count < 20
    ? "карточек"
    : lastDigit === 1
      ? "карточка"
      : lastDigit >= 2 && lastDigit <= 4
        ? "карточки"
        : "карточек";
  return `${value.toLocaleString("ru-RU")} ${noun}`;
}

export default function ProductCopyToBranchDialog({
  productIds,
  selection,
  selectionCount,
  onClose,
  onCompleted,
}: {
  productIds: string[];
  selection?: Record<string, unknown>;
  selectionCount?: number;
  onClose: () => void;
  onCompleted: () => void;
}) {
  const [capabilities, setCapabilities] = useState<CapabilityResponse | null>(null);
  const [targetBranchId, setTargetBranchId] = useState("");
  const [options, setOptions] = useState<CopyOptions>(defaultOptions);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [previewFilter, setPreviewFilter] = useState<"all" | "create" | "duplicate" | "review">("all");
  const [loading, setLoading] = useState(true);
  const [previewing, setPreviewing] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idempotencyKey = useRef(makeIdempotencyKey());

  useEffect(() => {
    let cancelled = false;
    async function loadCapabilities() {
      try {
        const response = await fetch("/api/products/copy-to-branch", { cache: "no-store" });
        const payload = await response.json() as CapabilityResponse;
        if (!response.ok) throw new Error(payload.error ?? "Не удалось проверить права на копирование");
        if (cancelled) return;
        setCapabilities(payload);
        const firstTarget = payload.targetBranches?.[0]?.id ?? "";
        setTargetBranchId(firstTarget);
        if (!payload.canCopy || !firstTarget) setError("Нет доступного активного филиала для копирования карточек.");
      } catch (requestError) {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : "Не удалось проверить права на копирование");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadCapabilities();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !executing) onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [executing, onClose]);

  const visibleRows = useMemo(() => {
    if (!preview) return [];
    if (previewFilter === "create") return preview.rows.filter((row) => row.action === "CREATE" || row.action === "FORCE_CREATE");
    if (previewFilter === "duplicate") return preview.rows.filter((row) => row.action === "SKIP" || row.action === "UPDATE_EMPTY" || row.action === "UPDATE_SELECTED");
    if (previewFilter === "review") return preview.rows.filter((row) => row.action === "REVIEW" || row.warnings.length > 0);
    return preview.rows;
  }, [preview, previewFilter]);

  function updateOption<K extends keyof CopyOptions>(key: K, value: CopyOptions[K]) {
    setOptions((current) => ({ ...current, [key]: value }));
    setPreview(null);
    setResult(null);
    idempotencyKey.current = makeIdempotencyKey();
  }

  async function buildPreview() {
    if (!targetBranchId) return;
    setPreviewing(true);
    setError(null);
    try {
      const response = await fetch("/api/products/copy-to-branch/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetBranchId, productIds, selection, options }),
      });
      const payload = await response.json() as Preview & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Не удалось подготовить предпросмотр");
      setPreview(payload);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось подготовить предпросмотр");
    } finally {
      setPreviewing(false);
    }
  }

  async function execute() {
    if (!targetBranchId) return;
    setExecuting(true);
    setError(null);
    try {
      const previewProductIds = preview?.rows.map((row) => row.sourceProductId) ?? [];
      const response = await fetch("/api/products/copy-to-branch/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetBranchId,
          productIds: previewProductIds.length ? previewProductIds : productIds,
          selection: previewProductIds.length ? undefined : selection,
          options,
          idempotencyKey: idempotencyKey.current,
        }),
      });
      const payload = await response.json() as Result & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Не удалось скопировать карточки");
      setResult(payload);
      onCompleted();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось скопировать карточки");
    } finally {
      setExecuting(false);
    }
  }

  async function openTargetCatalog() {
    if (!result) return;
    setExecuting(true);
    try {
      const response = await fetch("/api/session/active-branch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId: result.targetBranchId }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Не удалось переключить филиал");
      window.location.assign("/inventory/products?origin=BRANCH_COPY&copyBatchId=" + encodeURIComponent(result.id));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось открыть каталог филиала");
      setExecuting(false);
    }
  }

  return typeof document === "undefined" ? null : createPortal(
    <div className="eco-copy-dialog-backdrop" role="presentation" onMouseDown={() => !executing && onClose()}>
      <section className="eco-copy-dialog" role="dialog" aria-modal="true" aria-labelledby="copy-products-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="eco-copy-dialog__header">
          <div>
            <span className="eco-copy-dialog__eyebrow"><Copy aria-hidden className="eco-icon" /> Между филиалами</span>
            <h2 id="copy-products-dialog-title">Скопировать карточки товаров</h2>
            <p>{cardCountText(selectionCount ?? productIds.length)} · остатки и движения не переносятся</p>
          </div>
          <button type="button" className="eco-copy-dialog__close" onClick={onClose} disabled={executing} aria-label="Закрыть"><X aria-hidden className="eco-icon" /></button>
        </header>

        {loading ? (
          <div className="eco-copy-dialog__loading"><Loader2 className="eco-icon animate-spin" /> Проверяем доступные филиалы…</div>
        ) : result ? (
          <div className="eco-copy-dialog__result">
            <CheckCircle2 aria-hidden className="eco-copy-dialog__success-icon" />
            <h3>Копирование завершено</h3>
            <p>Новые карточки независимы от исходных. Остатки, ячейки, склады и движения не создавались.</p>
            <div className="eco-copy-dialog__stats">
              <span><b>{result.created}</b> создано</span>
              {result.updated ? <span><b>{result.updated}</b> изменено</span> : null}
              <span><b>{result.skipped}</b> пропущено</span>
              {result.failed ? <span className="is-warning"><b>{result.failed}</b> с ошибкой</span> : null}
              {result.priceNeedsSetup ? <span className="is-warning"><b>{result.priceNeedsSetup}</b> без цены</span> : null}
              {result.suppliersUnmapped ? <span className="is-warning"><b>{result.suppliersUnmapped}</b> без поставщика</span> : null}
            </div>
            <footer className="eco-copy-dialog__footer">
              <button type="button" className="eco-btn eco-btn--ghost" onClick={onClose} disabled={executing}>Закрыть</button>
              <button type="button" className="eco-btn eco-btn--primary" onClick={() => void openTargetCatalog()} disabled={executing}>
                {executing ? <Loader2 className="eco-icon animate-spin" /> : <ExternalLink className="eco-icon" />} Открыть карточки в филиале
              </button>
            </footer>
          </div>
        ) : (
          <>
            <div className="eco-copy-dialog__body">
              <div className="eco-copy-dialog__section">
                <div className="eco-copy-dialog__section-head"><span>Куда копировать</span>{capabilities?.sourceBranch ? <small>Из: {capabilities.sourceBranch.displayName}</small> : null}</div>
                <div className="eco-copy-branch-list">
                  {(capabilities?.targetBranches ?? []).map((branch) => (
                    <label key={branch.id} className={"eco-copy-branch " + (targetBranchId === branch.id ? "is-selected" : "")}>
                      <input type="radio" name="copy-target-branch" value={branch.id} checked={targetBranchId === branch.id} onChange={() => { setTargetBranchId(branch.id); setPreview(null); idempotencyKey.current = makeIdempotencyKey(); }} />
                      <span><b>{branch.displayName || branch.name}</b><small>{branch.address || "Адрес не указан"}</small></span><ChevronRight aria-hidden className="eco-icon" />
                    </label>
                  ))}
                </div>
              </div>

              <div className="eco-copy-dialog__section">
                <div className="eco-copy-dialog__section-head"><span>Что переносить</span><small>Технические и маркетинговые поля копируются всегда</small></div>
                <div className="eco-copy-options">
                  <label><input type="checkbox" checked={options.copyRetailPrice} onChange={(event) => updateOption("copyRetailPrice", event.target.checked)} /> Розничную цену</label>
                  <label><input type="checkbox" checked={options.copyPurchasePrice} onChange={(event) => updateOption("copyPurchasePrice", event.target.checked)} /> Цену закупки</label>
                  <label><input type="checkbox" checked={options.copyMinimumBalance} onChange={(event) => updateOption("copyMinimumBalance", event.target.checked)} /> Минимальный остаток</label>
                  <label><input type="checkbox" checked={options.mapSupplierByInn} onChange={(event) => updateOption("mapSupplierByInn", event.target.checked)} /> Поставщика по совпадению ИНН</label>
                </div>
              </div>

              <div className="eco-copy-dialog__section">
                <div className="eco-copy-dialog__section-head"><span>Если найдены дубли</span><small>Источник → бренд/артикул → штрихкод → код</small></div>
                <div className="eco-copy-strategies">
                  {strategyOptions.map((strategy) => (
                    <label key={strategy.value} className={options.duplicateStrategy === strategy.value ? "is-selected" : ""}>
                      <input type="radio" name="copy-duplicate-strategy" checked={options.duplicateStrategy === strategy.value} onChange={() => updateOption("duplicateStrategy", strategy.value)} />
                      <span><b>{strategy.label}</b><small>{strategy.help}</small></span>
                    </label>
                  ))}
                </div>
              </div>

              {error ? <div className="eco-copy-dialog__error"><AlertCircle aria-hidden className="eco-icon" /> {error}</div> : null}

              {preview ? (
                <div className="eco-copy-preview">
                  <div className="eco-copy-dialog__section-head">
                    <span>Предпросмотр · {preview.totalSelected}</span>
                    <div className="eco-copy-preview__filters">
                      {([["all", "Все"], ["create", "Создать"], ["duplicate", "Дубли"], ["review", "Проверить"]] as const).map(([key, label]) => (
                        <button key={key} type="button" className={previewFilter === key ? "is-active" : ""} onClick={() => setPreviewFilter(key)}>{label}</button>
                      ))}
                    </div>
                  </div>
                  <div className="eco-copy-preview__summary">
                    <span>Создать: {(preview.counts.CREATE ?? 0) + (preview.counts.FORCE_CREATE ?? 0)}</span>
                    <span>Дубли: {(preview.counts.SKIP ?? 0) + (preview.counts.UPDATE_EMPTY ?? 0) + (preview.counts.UPDATE_SELECTED ?? 0)}</span>
                    <span>Проверить: {preview.counts.REVIEW ?? 0}</span>
                  </div>
                  <div className="eco-copy-preview__list">
                    {visibleRows.map((row) => (
                      <div key={row.sourceProductId} className="eco-copy-preview__row">
                        <div><b>{row.productName}</b><small>{row.article || "без артикула"}{row.reason ? " · " + row.reason : ""}</small></div>
                        <span className={"eco-copy-preview__status " + actionTone(row.action)}>{actionLabel(row.action)}</span>
                        {row.warnings.length ? <small className="eco-copy-preview__warning">{row.warnings[0]}</small> : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
            <footer className="eco-copy-dialog__footer">
              <button type="button" className="eco-btn eco-btn--ghost" onClick={onClose} disabled={previewing || executing}>Отмена</button>
              {!preview ? (
                <button type="button" className="eco-btn eco-btn--primary" onClick={() => void buildPreview()} disabled={!targetBranchId || previewing}>
                  {previewing ? <Loader2 className="eco-icon animate-spin" /> : <ArrowRight className="eco-icon" />} Предпросмотр
                </button>
              ) : (
                <button type="button" className="eco-btn eco-btn--primary" onClick={() => void execute()} disabled={executing}>
                  {executing ? <Loader2 className="eco-icon animate-spin" /> : <Copy className="eco-icon" />} Скопировать {preview.totalSelected}
                </button>
              )}
            </footer>
          </>
        )}
      </section>
    </div>,
    document.body
  );
}
