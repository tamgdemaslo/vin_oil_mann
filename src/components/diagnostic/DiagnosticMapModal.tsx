"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type HTMLAttributes } from "react";
import { ChevronLeft, ChevronRight, Copy, Printer, X } from "lucide-react";
import {
  DIAGNOSTIC_MAP_STATUSES,
  DIAGNOSTIC_STATUS_GROUPS,
  REC_PRESETS_COMMON,
  type DiagnosticMapStatusCode,
} from "@/data/diagnostic-map";

type DiagnosticMapPhoto = {
  id: string;
  caption: string;
  url: string;
  thumbnailUrl: string;
};

type DiagnosticMapItem = {
  id: string;
  code: string;
  title: string;
  applicability: "applicable" | "not_applicable" | "hidden";
  status: DiagnosticMapStatusCode;
  statusLabel: string;
  value: string;
  comment: string;
  recommendation: string;
  nextVisit: boolean;
  showInReport: boolean;
  notes: string[];
  recs: string[];
  norm: string;
  measure: string;
  unit: string;
  selectedNotes: string[];
  selectedRecommendations: string[];
  photos: DiagnosticMapPhoto[];
};

type DiagnosticMapBlock = {
  code: string;
  title: string;
  short: string;
  items: DiagnosticMapItem[];
};

type DiagnosticMapPayload = {
  id: string;
  shipmentId: string | null;
  status: string;
  publicToken: string;
  reportUrl: string;
  printUrl: string;
  clientName: string | null;
  vehicle: {
    title: string;
    vin: string | null;
    licensePlate: string | null;
    mileage: number | null;
  };
  master: { name: string | null };
  counts: { total: number };
  blocks: DiagnosticMapBlock[];
};

type PhotoUploadState = {
  id: string;
  file: File;
  caption: string;
  previewUrl: string;
  progress: number;
  status: "uploading" | "error";
  error?: string;
};

type DiagnosticMapModalProps = {
  open: boolean;
  onClose: () => void;
  diagnosticId: string | null;
  shipmentId?: string | null;
  headerDraft?: {
    vin?: string;
    brand?: string;
    model?: string;
    year?: string;
    licensePlate?: string;
    mileage?: string;
    clientName?: string;
    clientPhone?: string;
    vehicleHints?: Record<string, unknown>;
  };
  onDiagnosticCreated?: (id: string) => void;
  onAddedToShipment?: () => void;
};

type SaveState = "idle" | "saving" | "saved" | "error";

type FieldContext = {
  label: string;
  placeholder: string;
  helper: string;
  inputMode: HTMLAttributes<HTMLInputElement>["inputMode"];
  warning?: string;
};

async function responseJson<T>(response: Response, fallback: T): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    return fallback;
  }
}

function countLabel(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} пункт`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} пункта`;
  return `${count} пунктов`;
}

function appendText(current: string, value: string): string {
  return current ? `${current} ${value}` : value;
}

function itemNeedsRecommendation(item: DiagnosticMapItem): boolean {
  return !["good", "unchecked"].includes(item.status);
}

function isIndirectStatus(status: DiagnosticMapStatusCode): boolean {
  return ["no-access", "by-mileage", "by-client"].includes(status);
}

function numericValue(value: string): number | null {
  const match = value.replace(",", ".").match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function includesAny(value: string, words: string[]): boolean {
  const lower = value.toLowerCase();
  return words.some((word) => lower.includes(word));
}

function fieldContext(item: DiagnosticMapItem): FieldContext {
  const indirect = isIndirectStatus(item.status);
  const label = item.measure || "Состояние / уровень";
  const unit = item.unit ? ` ${item.unit}` : "";
  const value = item.value.trim();
  const number = numericValue(value);
  const directHelper = item.norm
    ? `Норма: ${item.norm}. Для прямого осмотра укажите фактический замер или короткое состояние.`
    : "Для прямого осмотра зафиксируйте фактическое состояние узла.";
  const helper = indirect
    ? "Косвенный статус: числовой замер не обязателен. Можно указать основание: пробег, доступ или слова клиента."
    : directHelper;
  const base: FieldContext = {
    label,
    placeholder: item.unit ? `Например: ${item.norm || `12.5${unit}`}` : item.notes[0] || "Опишите состояние узла",
    helper,
    inputMode: item.unit ? "decimal" : "text",
  };

  if (indirect || !value) return base;

  if (item.code === "coolant" && number !== null) {
    if (item.status === "good" && number > -35) return { ...base, warning: "Для «Хорошо» температура обычно −35 °C или ниже." };
    if (["warn", "crit"].includes(item.status) && number <= -35) return { ...base, warning: "Значение похоже на норму. Проверьте, почему выбран статус внимания." };
  }
  if (item.code === "brake-fluid" && number !== null) {
    if (item.status === "good" && number >= 2) return { ...base, warning: "Для «Хорошо» влажность тормозной жидкости обычно ниже 2%." };
    if (["warn", "crit"].includes(item.status) && number < 2) return { ...base, warning: "Значение ниже 2%. Проверьте выбранный статус." };
  }
  if (item.code === "battery" && number !== null) {
    if (item.status === "good" && number < 12.4) return { ...base, warning: "Для «Хорошо» напряжение покоя обычно 12.4–12.7 В." };
    if (["warn", "crit"].includes(item.status) && number >= 12.4) return { ...base, warning: "Напряжение в нормальном диапазоне. Проверьте выбранный статус." };
  }
  if (item.code === "pads" && number !== null) {
    if (item.status === "good" && number <= 30) return { ...base, warning: "Для «Хорошо» остаток колодок обычно больше 30%." };
    if (["warn", "crit"].includes(item.status) && number > 30) return { ...base, warning: "Остаток больше 30%. Проверьте выбранный статус." };
  }
  if (item.code === "tires" && number !== null) {
    if (item.status === "good" && number <= 4) return { ...base, warning: "Для «Хорошо» глубина протектора обычно больше 4 мм." };
    if (["warn", "crit"].includes(item.status) && number > 4) return { ...base, warning: "Глубина больше 4 мм. Проверьте выбранный статус." };
  }
  if (["oil-level", "atf-level"].includes(item.code)) {
    const badWords = ["ниже", "перелив", "долив"];
    if (item.status === "good" && includesAny(value, badWords)) return { ...base, warning: "Текст похож на отклонение, а статус выбран «Хорошо»." };
  }

  return base;
}

function allApplicable(blocks: DiagnosticMapBlock[]): DiagnosticMapItem[] {
  return blocks.flatMap((block) => block.items).filter((item) => item.applicability === "applicable");
}

function computeCounts(blocks: DiagnosticMapBlock[]) {
  const items = allApplicable(blocks);
  const count = (status: DiagnosticMapStatusCode) => items.filter((item) => item.status === status).length;
  const indirect = items.filter((item) => ["no-access", "by-mileage", "by-client"].includes(item.status)).length;
  return {
    total: items.length,
    good: count("good"),
    warn: count("warn"),
    crit: count("crit"),
    indirect,
    unchecked: count("unchecked"),
    withPhoto: items.filter((item) => item.photos.length > 0).length,
    recommendations: items.filter((item) => item.recommendation.trim() || itemNeedsRecommendation(item)).length,
  };
}

function CompletionRing({ pct }: { pct: number }) {
  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - pct / 100);
  return (
    <div className="diag-archive-ring" aria-label={`Заполнено ${pct}%`}>
      <svg width="48" height="48" viewBox="0 0 48 48">
        <circle cx="24" cy="24" r={radius} fill="none" stroke="#3D3D3D" strokeWidth="4" />
        <circle
          cx="24"
          cy="24"
          r={radius}
          fill="none"
          stroke="#C2410C"
          strokeWidth="4"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 24 24)"
        />
      </svg>
      <span>{pct}%</span>
    </div>
  );
}

export function DiagnosticMapModal({
  open,
  onClose,
  diagnosticId,
  shipmentId,
  headerDraft,
  onDiagnosticCreated,
  onAddedToShipment,
}: DiagnosticMapModalProps) {
  const [activeId, setActiveId] = useState<string | null>(diagnosticId);
  const [data, setData] = useState<DiagnosticMapPayload | null>(null);
  const [activeBlock, setActiveBlock] = useState<string | null>(null);
  const [activeItem, setActiveItem] = useState<string | null>(null);
  const [showSummary, setShowSummary] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [photoCaptions, setPhotoCaptions] = useState<Record<string, string>>({});
  const [photoUploads, setPhotoUploads] = useState<Record<string, PhotoUploadState[]>>({});
  const [lightbox, setLightbox] = useState<{ title: string; photo: DiagnosticMapPhoto } | null>(null);
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => setActiveId(diagnosticId), [diagnosticId]);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/diagnostics/${id}`);
      const json = await responseJson<DiagnosticMapPayload & { error?: string }>(response, {} as DiagnosticMapPayload);
      if (!response.ok) throw new Error(json.error ?? "Не удалось загрузить диагностику");
      setData(json);
      const firstBlock = json.blocks[0];
      setActiveBlock((current) => current ?? firstBlock?.code ?? null);
      setActiveItem((current) => current ?? firstBlock?.items[0]?.code ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить диагностику");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    if (activeId) {
      void load(activeId);
      return;
    }
    if (!shipmentId) return;
    let cancelled = false;
    async function create() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch("/api/diagnostics", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            shipmentId,
            vin: headerDraft?.vin,
            brand: headerDraft?.brand,
            model: headerDraft?.model,
            year: headerDraft?.year,
            licensePlate: headerDraft?.licensePlate,
            mileage: headerDraft?.mileage,
            clientName: headerDraft?.clientName,
            clientPhone: headerDraft?.clientPhone,
            vehicleHints: headerDraft?.vehicleHints,
          }),
        });
        const json = await responseJson<{ diagnostic?: DiagnosticMapPayload; diagnosticId?: string; error?: string }>(response, {});
        if (!response.ok || !json.diagnostic?.id) throw new Error(json.error ?? "Не удалось создать диагностику");
        if (cancelled) return;
        setActiveId(json.diagnostic.id);
        setData(json.diagnostic);
        setActiveBlock(json.diagnostic.blocks[0]?.code ?? null);
        setActiveItem(json.diagnostic.blocks[0]?.items[0]?.code ?? null);
        onDiagnosticCreated?.(json.diagnostic.id);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Не удалось создать диагностику");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void create();
    return () => {
      cancelled = true;
    };
  }, [activeId, headerDraft, load, onDiagnosticCreated, open, shipmentId]);

  const counts = useMemo(() => computeCounts(data?.blocks ?? []), [data?.blocks]);
  const completion = counts.total ? Math.round(((counts.total - counts.unchecked) / counts.total) * 100) : 0;
  const flatItems = useMemo(
    () => data?.blocks.flatMap((block) => block.items.map((item) => ({ ...item, blockCode: block.code }))) ?? [],
    [data?.blocks]
  );
  const block = data?.blocks.find((candidate) => candidate.code === activeBlock) ?? data?.blocks[0] ?? null;
  const item = flatItems.find((candidate) => candidate.code === activeItem) ?? block?.items[0] ?? null;
  const itemStatus = item ? DIAGNOSTIC_MAP_STATUSES[item.status] : DIAGNOSTIC_MAP_STATUSES.unchecked;
  const activeIndex = item ? flatItems.findIndex((candidate) => candidate.code === item.code) : -1;
  const currentField = item ? fieldContext(item) : null;
  const activeUploads = item ? photoUploads[item.code] ?? [] : [];

  const mutateItem = useCallback((itemCode: string, patch: Partial<DiagnosticMapItem>) => {
    setData((current) => {
      if (!current) return current;
      return {
        ...current,
        blocks: current.blocks.map((block) => ({
          ...block,
          items: block.items.map((candidate) => (candidate.code === itemCode ? { ...candidate, ...patch } : candidate)),
        })),
      };
    });
  }, []);

  const appendPhotoToItem = useCallback((itemCode: string, photo: DiagnosticMapPhoto) => {
    setData((current) => {
      if (!current) return current;
      return {
        ...current,
        blocks: current.blocks.map((block) => ({
          ...block,
          items: block.items.map((candidate) => (
            candidate.code === itemCode ? { ...candidate, photos: [...candidate.photos, photo] } : candidate
          )),
        })),
      };
    });
  }, []);

  const saveItem = useCallback(
    async (itemCode: string, patch: Partial<DiagnosticMapItem>) => {
      if (!activeId) return;
      mutateItem(itemCode, patch);
      setSaveState("saving");
      try {
        const response = await fetch(`/api/diagnostics/${activeId}/item`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemCode, ...patch }),
        });
        const json = await responseJson<{ item?: DiagnosticMapItem; error?: string }>(response, {});
        if (!response.ok || !json.item) throw new Error(json.error ?? "Не удалось сохранить пункт");
        mutateItem(itemCode, json.item);
        setSaveState("saved");
      } catch (e) {
        setSaveState("error");
        setError(e instanceof Error ? e.message : "Не удалось сохранить пункт");
      }
    },
    [activeId, mutateItem]
  );

  function gotoPrevious() {
    if (!item) return;
    const index = flatItems.findIndex((candidate) => candidate.code === item.code);
    const previous = flatItems[index - 1];
    if (previous) {
      setActiveBlock(previous.blockCode);
      setActiveItem(previous.code);
      setShowSummary(false);
    }
  }

  function gotoNext() {
    if (!item) return;
    const index = flatItems.findIndex((candidate) => candidate.code === item.code);
    const next = flatItems[index + 1];
    if (next) {
      setActiveBlock(next.blockCode);
      setActiveItem(next.code);
      setShowSummary(false);
    } else {
      setShowSummary(true);
    }
  }

  function uploadPhotoXhr(target: DiagnosticMapItem, upload: PhotoUploadState): Promise<DiagnosticMapPhoto> {
    return new Promise((resolve, reject) => {
      if (!activeId) {
        reject(new Error("Диагностика ещё не создана"));
        return;
      }
      const form = new FormData();
      form.set("itemCode", target.code);
      form.set("caption", upload.caption.trim());
      form.set("file", upload.file);
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `/api/diagnostics/${activeId}/photos`);
      xhr.upload.onprogress = (event) => {
        const progress = event.lengthComputable ? Math.max(8, Math.round((event.loaded / event.total) * 92)) : 45;
        setPhotoUploads((current) => ({
          ...current,
          [target.code]: (current[target.code] ?? []).map((candidate) => (
            candidate.id === upload.id ? { ...candidate, progress } : candidate
          )),
        }));
      };
      xhr.onerror = () => reject(new Error("Не удалось отправить фото. Проверьте соединение и попробуйте ещё раз."));
      xhr.onload = () => {
        let json: { photo?: DiagnosticMapPhoto; error?: string } = {};
        try {
          json = JSON.parse(xhr.responseText || "{}") as { photo?: DiagnosticMapPhoto; error?: string };
        } catch {
          json = {};
        }
        if (xhr.status < 200 || xhr.status >= 300 || !json.photo) {
          reject(new Error(json.error ?? "Фото не загрузилось. Попробуйте повторить."));
          return;
        }
        resolve(json.photo);
      };
      xhr.send(form);
    });
  }

  async function runPhotoUpload(target: DiagnosticMapItem, upload: PhotoUploadState) {
    setPhotoUploads((current) => ({
      ...current,
      [target.code]: (current[target.code] ?? []).map((candidate) => (
        candidate.id === upload.id ? { ...candidate, status: "uploading", progress: 6, error: undefined } : candidate
      )),
    }));
    try {
      const photo = await uploadPhotoXhr(target, upload);
      appendPhotoToItem(target.code, { ...photo, thumbnailUrl: photo.thumbnailUrl || photo.url });
      setPhotoUploads((current) => ({
        ...current,
        [target.code]: (current[target.code] ?? []).filter((candidate) => candidate.id !== upload.id),
      }));
      setPhotoCaptions((current) => ({ ...current, [target.code]: "" }));
      URL.revokeObjectURL(upload.previewUrl);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Фото не загрузилось. Попробуйте повторить.";
      setPhotoUploads((current) => ({
        ...current,
        [target.code]: (current[target.code] ?? []).map((candidate) => (
          candidate.id === upload.id ? { ...candidate, status: "error", progress: 100, error: message } : candidate
        )),
      }));
      setError(message);
    }
  }

  async function uploadPhoto(target: DiagnosticMapItem, file: File | null) {
    if (!activeId || !file) return;
    const caption = (photoCaptions[target.code] ?? "").trim();
    const upload: PhotoUploadState = {
      id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${file.name}`,
      file,
      caption,
      previewUrl: URL.createObjectURL(file),
      progress: 0,
      status: "uploading",
    };
    setPhotoUploads((current) => ({ ...current, [target.code]: [...(current[target.code] ?? []), upload] }));
    await runPhotoUpload(target, upload);
  }

  function updateUploadCaption(itemCode: string, uploadId: string, caption: string) {
    setPhotoUploads((current) => ({
      ...current,
      [itemCode]: (current[itemCode] ?? []).map((candidate) => (candidate.id === uploadId ? { ...candidate, caption } : candidate)),
    }));
  }

  function removeUpload(itemCode: string, upload: PhotoUploadState) {
    setPhotoUploads((current) => ({
      ...current,
      [itemCode]: (current[itemCode] ?? []).filter((candidate) => candidate.id !== upload.id),
    }));
    URL.revokeObjectURL(upload.previewUrl);
  }

  async function updatePhotoCaption(target: DiagnosticMapItem, photo: DiagnosticMapPhoto, caption: string) {
    if (!activeId) return;
    mutateItem(target.code, { photos: target.photos.map((candidate) => (candidate.id === photo.id ? { ...candidate, caption } : candidate)) });
    await fetch(`/api/diagnostics/${activeId}/photos/${photo.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caption }),
    });
  }

  async function deletePhoto(target: DiagnosticMapItem, photoId: string) {
    if (!activeId) return;
    mutateItem(target.code, { photos: target.photos.filter((photo) => photo.id !== photoId) });
    await fetch(`/api/diagnostics/${activeId}/photos/${photoId}`, { method: "DELETE" });
  }

  async function complete() {
    if (!activeId) return;
    const response = await fetch(`/api/diagnostics/${activeId}/complete`, { method: "POST" });
    const json = await responseJson<DiagnosticMapPayload & { error?: string }>(response, {} as DiagnosticMapPayload);
    if (!response.ok) {
      setError(json.error ?? "Не удалось завершить диагностику");
      return;
    }
    setData(json);
    setShowSummary(true);
  }

  async function copyReportLink() {
    if (!data?.reportUrl) return;
    await navigator.clipboard?.writeText(data.reportUrl);
    setSaveState("saved");
  }

  async function addRecommendationToShipment(target: DiagnosticMapItem) {
    if (!activeId) return;
    await fetch(`/api/diagnostics/${activeId}/recommendations/add-to-shipment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemCode: target.code }),
    });
    onAddedToShipment?.();
  }

  if (!open) return null;

  return (
    <div className="diag-archive-screen">
      <header className="diag-archive-topbar">
        <button type="button" className="diag-archive-close" onClick={onClose}>
          <ChevronLeft size={16} /> Закрыть
        </button>
        <div className="diag-archive-separator" />
        <div className="diag-archive-title">
          <span>Диагностика · {counts.total || 17} пунктов · {data?.shipmentId ?? shipmentId ?? "отгрузка"}</span>
          <strong>
            {data?.vehicle.title ?? "Автомобиль"} · <b>{data?.vehicle.licensePlate || "номер не указан"}</b>
          </strong>
          <small>{data?.clientName || headerDraft?.clientName || "Клиент не указан"}</small>
        </div>
        <div className="diag-archive-actions">
          <CompletionRing pct={completion} />
          <div className="diag-archive-progress">
            <span>Прогресс</span>
            <strong>{counts.total - counts.unchecked} / {counts.total || 17}</strong>
          </div>
          {data?.reportUrl && (
            <a href={`${data.reportUrl}/print`} target="_blank" rel="noreferrer" className="diag-archive-btn is-dark">
              <Printer size={16} /> Печать карты
            </a>
          )}
          <button type="button" className="diag-archive-btn is-primary" onClick={() => setShowSummary(true)}>
            Завершить и отправить →
          </button>
        </div>
      </header>

      {error && (
        <div className="diag-archive-error">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)}><X size={16} /></button>
        </div>
      )}

      {loading || !data || !block || !item ? (
        <div className="diag-archive-loading">Загрузка карты диагностики...</div>
      ) : (
        <div className="diag-archive-body">
          <aside className="diag-archive-sidebar">
            <div className="diag-archive-sidebar-head">Структура диагностики</div>
            {data.blocks.map((candidate) => {
              const openBlock = candidate.code === block.code;
              const blockCounts = computeCounts([candidate]);
              return (
                <section key={candidate.code} className="diag-archive-block">
                  <button
                    type="button"
                    className={`diag-archive-block-btn ${openBlock ? "is-open" : ""}`}
                    onClick={() => {
                      setActiveBlock(candidate.code);
                      setActiveItem(candidate.items[0]?.code ?? null);
                      setShowSummary(false);
                    }}
                  >
                    <span>
                      <strong>{candidate.title}</strong>
                      <small>{countLabel(candidate.items.length)}</small>
                    </span>
                    <i className="is-crit">{blockCounts.crit || ""}</i>
                    <i className="is-warn">{blockCounts.warn || ""}</i>
                    <i className="is-ind">{blockCounts.indirect || ""}</i>
                    <i className="is-good">{blockCounts.good || ""}</i>
                  </button>
                  {openBlock && (
                    <div className="diag-archive-items">
                      {candidate.items.map((candidateItem) => {
                        const status = DIAGNOSTIC_MAP_STATUSES[candidateItem.status] ?? DIAGNOSTIC_MAP_STATUSES.unchecked;
                        const active = candidateItem.code === item.code && !showSummary;
                        return (
                          <button
                            type="button"
                            key={candidateItem.code}
                            className={`diag-archive-item-btn ${active ? "is-active" : ""}`}
                            onClick={() => {
                              setActiveItem(candidateItem.code);
                              setShowSummary(false);
                            }}
                          >
                            <b style={{ background: status.color }}>{status.icon}</b>
                            <span>{candidateItem.title}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </section>
              );
            })}
            <div className="diag-archive-side-summary">
              <span>Сводка</span>
              <div>
                <p><i className="dot success" />Хорошо <b>{counts.good}</b></p>
                <p><i className="dot warning" />Внимание <b>{counts.warn}</b></p>
                <p><i className="dot danger" />Критично <b>{counts.crit}</b></p>
                <p><i className="dot info" />Косвенно <b>{counts.indirect}</b></p>
              </div>
            </div>
          </aside>

          <main className="diag-archive-main">
            {showSummary ? (
              <section className="diag-archive-summary">
                <div>
                  <span>Финальная сводка</span>
                  <h1>Диагностика готова к отправке</h1>
                  <p>{counts.total} пунктов проверены · {counts.recommendations} рекомендаций сформированы</p>
                </div>
                <button type="button" className="diag-archive-btn" onClick={() => setShowSummary(false)}>
                  <ChevronLeft size={16} /> Вернуться к проверкам
                </button>
                <div className="diag-archive-summary-grid">
                  <p style={{ borderTopColor: "#15803D" }}><span>Хорошо</span><b>{counts.good}</b></p>
                  <p style={{ borderTopColor: "#B45309" }}><span>Внимание</span><b>{counts.warn}</b></p>
                  <p style={{ borderTopColor: "#B91C1C" }}><span>Критично</span><b>{counts.crit}</b></p>
                  <p style={{ borderTopColor: "#1D4ED8" }}><span>Косвенно</span><b>{counts.indirect}</b></p>
                  <p style={{ borderTopColor: "#A3A3A3" }}><span>Не проверено</span><b>{counts.unchecked}</b></p>
                </div>
                <div className="diag-archive-summary-recs">
                  {flatItems.filter((candidate) => candidate.recommendation).map((candidate) => {
                    const status = DIAGNOSTIC_MAP_STATUSES[candidate.status] ?? DIAGNOSTIC_MAP_STATUSES.warn;
                    return (
                      <article key={candidate.code} style={{ borderLeftColor: status.color }}>
                        <strong>{candidate.title}</strong>
                        <span>{status.label}</span>
                        <p>{candidate.recommendation}</p>
                      </article>
                    );
                  })}
                </div>
                <div className="diag-archive-summary-actions">
                  {data.reportUrl && <a href={`${data.reportUrl}/print`} target="_blank" rel="noreferrer" className="diag-archive-btn"><Printer size={16} /> Печать карты</a>}
                  {data.reportUrl && <a href={data.reportUrl} target="_blank" rel="noreferrer" className="diag-archive-btn">Превью отчёта</a>}
                  <button type="button" className="diag-archive-btn" onClick={() => void copyReportLink()}><Copy size={16} /> Скопировать ссылку</button>
                  <button type="button" className="diag-archive-btn is-primary" onClick={() => void complete()}>Завершить и отправить →</button>
                </div>
              </section>
            ) : (
              <>
                <div className="diag-archive-item-head">
                  <div>
                    <span>{block.title}</span>
                    <h2>{item.title}</h2>
                    {item.norm && <p>Норма: <b>{item.norm}</b></p>}
                  </div>
                </div>

                <section className="diag-archive-status">
                  {DIAGNOSTIC_STATUS_GROUPS.map((group) => (
                    <div key={group.title}>
                      <span>{group.title}</span>
                      <div className={group.title === "Без прямого осмотра" ? "is-indirect" : ""}>
                        {group.statuses.map((statusCode) => {
                          const status = DIAGNOSTIC_MAP_STATUSES[statusCode];
                          const active = item.status === statusCode;
                          return (
                            <button
                              type="button"
                              key={statusCode}
                              className={active ? "is-active" : ""}
                              style={{ "--diag-status-color": status.color } as CSSProperties}
                              onClick={() => void saveItem(item.code, { status: statusCode })}
                            >
                              <b>{status.icon}</b>
                              <span>
                                <strong>{status.label}</strong>
                                {status.hint && <small>{status.hint}</small>}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </section>

                <section className={`diag-archive-field ${currentField?.warning ? "has-warning" : ""}`}>
                  <span>{currentField?.label || "Состояние / уровень"}{item.unit && <small> · {item.unit}</small>}</span>
                  <input
                    value={item.value}
                    inputMode={currentField?.inputMode}
                    aria-invalid={Boolean(currentField?.warning)}
                    onChange={(event) => void saveItem(item.code, { value: event.target.value })}
                    placeholder={currentField?.placeholder || "Опиши результат"}
                  />
                  <p>{currentField?.warning || currentField?.helper}</p>
                </section>

                <section className="diag-archive-photos">
                  <span>Фото · {item.photos.length + activeUploads.length}<small> · подпись можно добавить после загрузки</small></span>
                  <div>
                    {activeUploads.map((upload) => (
                      <figure key={upload.id} className={`diag-archive-photo-upload is-${upload.status}`}>
                        {/* eslint-disable-next-line @next/next/no-img-element -- local preview */}
                        <img src={upload.previewUrl} alt="Загрузка фото диагностики" />
                        <figcaption>
                          <b>{upload.status === "error" ? "ERROR" : `${upload.progress}%`}</b>
                          <input
                            value={upload.caption}
                            onChange={(event) => updateUploadCaption(item.code, upload.id, event.target.value)}
                            placeholder="Подпись необязательна"
                          />
                        </figcaption>
                        <div className="diag-archive-photo-progress" aria-label={`Загрузка ${upload.progress}%`}>
                          <i style={{ width: `${upload.progress}%` }} />
                        </div>
                        {upload.status === "error" && (
                          <div className="diag-archive-photo-error">
                            <small>{upload.error}</small>
                            <button type="button" onClick={() => void runPhotoUpload(item, upload)}>Повторить</button>
                            <button type="button" onClick={() => removeUpload(item.code, upload)}>Убрать</button>
                          </div>
                        )}
                      </figure>
                    ))}
                    {item.photos.map((photo, index) => (
                      <figure key={photo.id}>
                        {/* eslint-disable-next-line @next/next/no-img-element -- local diagnostic photo */}
                        <img src={photo.thumbnailUrl} alt={photo.caption} onClick={() => setLightbox({ title: item.title, photo })} />
                        <figcaption>
                          <b>IMG_{String(index + 1).padStart(3, "0")}</b>
                          <input value={photo.caption} onChange={(event) => void updatePhotoCaption(item, photo, event.target.value)} />
                        </figcaption>
                        <button type="button" onClick={() => void deletePhoto(item, photo.id)}>×</button>
                      </figure>
                    ))}
                    <label className="diag-archive-photo-add">
                      <input
                        ref={(node) => {
                          fileInputs.current[item.code] = node;
                        }}
                        type="file"
                        accept="image/*"
                        onChange={(event) => {
                          const file = event.target.files?.[0] ?? null;
                          event.target.value = "";
                          void uploadPhoto(item, file);
                        }}
                      />
                      <input
                        value={photoCaptions[item.code] ?? ""}
                        onChange={(event) => setPhotoCaptions((current) => ({ ...current, [item.code]: event.target.value }))}
                        placeholder="Подпись необязательна"
                      />
                      <button type="button" onClick={() => fileInputs.current[item.code]?.click()}>+ Загрузить фото</button>
                    </label>
                  </div>
                </section>

                <section className="diag-archive-comment">
                  <span>Комментарий мастера</span>
                  {item.notes.length > 0 && (
                    <div>
                      {item.notes.map((note) => (
                        <button key={note} type="button" className="preset-chip" onClick={() => void saveItem(item.code, { comment: appendText(item.comment, note) })}>
                          {note}
                        </button>
                      ))}
                    </div>
                  )}
                  <textarea
                    value={item.comment}
                    onChange={(event) => void saveItem(item.code, { comment: event.target.value })}
                    placeholder="Что увидели · что насторожило · какие шумы / запахи"
                  />
                </section>

                {itemNeedsRecommendation(item) && (
                  <section className={`diag-archive-recommendation is-${itemStatus.tone}`}>
                    <span>{itemStatus.icon} Рекомендация клиенту</span>
                    <div>
                      {[...item.recs, ...REC_PRESETS_COMMON].map((rec) => (
                        <button key={rec} type="button" className="preset-chip light" onClick={() => void saveItem(item.code, { recommendation: rec })}>
                          {rec}
                        </button>
                      ))}
                    </div>
                    <textarea
                      value={item.recommendation}
                      onChange={(event) => void saveItem(item.code, { recommendation: event.target.value })}
                      placeholder="Что предлагаем сделать. С ценой и сроком."
                    />
                    <footer>
                      <small>Эта рекомендация попадёт в публичный отчёт клиенту.</small>
                      <button type="button" onClick={() => void addRecommendationToShipment(item)}>Добавить в отгрузку</button>
                    </footer>
                  </section>
                )}
                <div className="diag-archive-workbar">
                  <div>
                    <span>{block.short} · {Math.max(activeIndex + 1, 1)} / {flatItems.length || 17}</span>
                    <strong>{item.title}</strong>
                  </div>
                  <nav>
                    <button type="button" className="diag-archive-btn" onClick={gotoPrevious} disabled={activeIndex <= 0}>
                      <ChevronLeft size={16} /> Назад
                    </button>
                    <button type="button" className="diag-archive-btn is-primary" onClick={gotoNext}>
                      {activeIndex >= flatItems.length - 1 ? "К сводке" : "Дальше"} <ChevronRight size={16} />
                    </button>
                  </nav>
                </div>
              </>
            )}
          </main>
        </div>
      )}

      <div className={`diag-archive-save is-${saveState}`}>
        {saveState === "saving" ? "Сохраняем..." : saveState === "error" ? "Ошибка сохранения" : saveState === "saved" ? "Сохранено" : ""}
      </div>

      {lightbox && (
        <div className="diag-archive-lightbox" role="dialog" aria-modal="true" onClick={() => setLightbox(null)}>
          <div onClick={(event) => event.stopPropagation()}>
            <button type="button" onClick={() => setLightbox(null)}><X size={18} /></button>
            {/* eslint-disable-next-line @next/next/no-img-element -- local diagnostic photo */}
            <img src={lightbox.photo.url} alt={lightbox.photo.caption} />
            <strong>{lightbox.title}</strong>
            <p>{lightbox.photo.caption}</p>
          </div>
        </div>
      )}
    </div>
  );
}
