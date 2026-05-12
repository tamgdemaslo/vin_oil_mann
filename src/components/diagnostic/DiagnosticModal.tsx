"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ALL_NODES,
  BLOCK_ORDER,
  BLOCK_TITLES,
  NODE_TAGS,
  RECOMMENDATION_PRESETS,
  hubSummaryProgress,
  trafficLightFromMeasurement,
  type DiagnosticBlockCode,
} from "@/data/diagnostic-catalog";
import type {
  DiagnosticBlock,
  DiagnosticOffer,
  DiagnosticPhoto,
  DiagnosticPosition,
  DiagnosticPositionStatus,
  DiagnosticStatus,
} from "@prisma/client";

type Nav =
  | { screen: "hub" }
  | { screen: "block"; block: DiagnosticBlockCode }
  | { screen: "position"; block: DiagnosticBlockCode; node: string }
  | { screen: "summary" };

type DiagnosticRow = {
  id: string;
  vin: string | null;
  brand: string | null;
  model: string | null;
  year: number | null;
  licensePlate: string | null;
  mileage: number | null;
  status: DiagnosticStatus;
  startedAt: string;
  summaryGreen: number;
  summaryYellow: number;
  summaryRed: number;
  shipmentMoySkladId: string | null;
  positions: (DiagnosticPosition & { photos: DiagnosticPhoto[] })[];
  offers: DiagnosticOffer[];
};

function nodeTitle(node: string): string {
  return ALL_NODES.find((n) => n.node === node)?.title ?? node;
}

export type DiagnosticModalProps = {
  open: boolean;
  onClose: () => void;
  diagnosticId: string | null;
  shipmentMoySkladId: string | null;
  /** Шапка из отгрузки */
  headerDraft: {
    vin: string;
    brand: string;
    model: string;
    year: string;
    licensePlate: string;
    mileage: string;
    agentMoySkladId: string | null;
  };
  onDiagnosticCreated?: (id: string) => void;
  onAddedToShipment?: () => void;
};

export function DiagnosticModal({
  open,
  onClose,
  diagnosticId,
  shipmentMoySkladId,
  headerDraft,
  onDiagnosticCreated,
  onAddedToShipment,
}: DiagnosticModalProps) {
  const [nav, setNav] = useState<Nav>({ screen: "hub" });
  const [data, setData] = useState<DiagnosticRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [sessionSeconds, setSessionSeconds] = useState(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeId = data?.id ?? diagnosticId;

  const load = useCallback(async () => {
    if (!activeId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/diagnostic/${activeId}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Ошибка загрузки");
      setData(json as DiagnosticRow);
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setLoading(false);
    }
  }, [activeId]);

  useEffect(() => {
    if (!open || !activeId) return;
    load();
  }, [open, activeId, load]);

  useEffect(() => {
    if (!open || !data?.startedAt) return;
    const start = new Date(data.startedAt).getTime();
    const t = setInterval(() => {
      setSessionSeconds(Math.max(0, Math.floor((Date.now() - start) / 1000)));
    }, 1000);
    return () => clearInterval(t);
  }, [open, data?.startedAt]);

  const patchHeader = useCallback(
    async (partial: Record<string, unknown>) => {
      if (!activeId) return;
      const res = await fetch(`/api/diagnostic/${activeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(partial),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Ошибка сохранения");
      setData(json as DiagnosticRow);
    },
    [activeId]
  );

  const debouncedPatch = useCallback(
    (partial: Record<string, unknown>) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        patchHeader(partial).catch((e) => setToast(String(e.message)));
      }, 500);
    },
    [patchHeader]
  );

  const savePosition = useCallback(
    async (payload: {
      block: DiagnosticBlock;
      node: string;
      status: DiagnosticPositionStatus;
      tags?: string[];
      measurementValue?: number | null;
      measurementUnit?: string | null;
      recommendation?: string | null;
    }) => {
      if (!activeId) return;
      const res = await fetch(`/api/diagnostic/${activeId}/position`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Ошибка сохранения узла");
      void json;
      await load();
    },
    [activeId, load]
  );

  const uploadPhoto = async (node: string, file: File) => {
    if (!activeId) return;
    const fd = new FormData();
    fd.set("node", node);
    fd.set("file", file);
    const res = await fetch(`/api/diagnostic/${activeId}/photo`, { method: "POST", body: fd });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "Фото не загружено");
    await load();
  };

  const goSummary = async () => {
    if (!activeId) return;
    await fetch(`/api/diagnostic/${activeId}/rebuild-offers`, { method: "POST" });
    await load();
    setNav({ screen: "summary" });
  };

  const completeDiagnostic = async () => {
    if (!activeId) return;
    try {
      const res = await fetch(`/api/diagnostic/${activeId}/complete`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Ошибка");
      setToast("Диагностика завершена");
      await load();
      onClose();
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Ошибка");
    }
  };

  const sendReport = async () => {
    if (!activeId) return;
    const res = await fetch(`/api/diagnostic/${activeId}/send-report`, { method: "POST" });
    const json = await res.json();
    if (!res.ok) {
      setToast(json.error ?? "Ошибка");
      return;
    }
    try {
      await navigator.clipboard.writeText(json.reportUrl ?? "");
      setToast("Ссылка для клиента скопирована в буфер обмена");
    } catch {
      setToast(`Ссылка: ${json.reportUrl}`);
    }
  };

  const [selectedOffers, setSelectedOffers] = useState<Record<string, number>>({});

  const totalNodes = data?.positions.length ?? ALL_NODES.length;
  const filled = useMemo(() => {
    if (!data?.positions) return 0;
    return data.positions.filter((p) => p.status !== "NOT_CHECKED").length;
  }, [data?.positions]);

  const canSummary = hubSummaryProgress(filled, totalNodes || 1);

  useEffect(() => {
    if (!open) setNav({ screen: "hub" });
  }, [open]);

  const addOffersToShipment = async () => {
    if (!activeId || !shipmentMoySkladId) {
      setToast("Нет привязанной отгрузки");
      return;
    }
    const selections = Object.entries(selectedOffers).map(([offerId, variantIndex]) => ({
      offerId,
      variantIndex,
    }));
    if (selections.length === 0) {
      setToast("Отметьте офферы");
      return;
    }
    const res = await fetch(`/api/diagnostic/${activeId}/add-offers-to-shipment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selections }),
    });
    const json = await res.json();
    if (!res.ok) {
      setToast(json.error ?? "Ошибка");
      return;
    }
    setToast("Позиции добавлены в отгрузку");
    onAddedToShipment?.();
    onClose();
  };

  if (!open) return null;

  const hubEditable = {
    licensePlate: data?.licensePlate ?? headerDraft.licensePlate,
    brand: data?.brand ?? headerDraft.brand,
    model: data?.model ?? headerDraft.model,
    year: data?.year != null ? String(data.year) : headerDraft.year,
    mileage: data?.mileage != null ? String(data.mileage) : headerDraft.mileage,
  };

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-white dark:bg-zinc-950 md:items-center md:justify-center md:bg-black/50 md:p-4">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:max-h-[95vh] md:max-w-[960px] md:rounded-xl md:border md:border-zinc-200 md:bg-white md:shadow-xl dark:md:border-zinc-700 dark:md:bg-zinc-900">
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-700">
          <div>
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Диагностика</div>
            <div className="text-xs text-zinc-500">
              Сессия: {Math.floor(sessionSeconds / 60)}:{String(sessionSeconds % 60).padStart(2, "0")}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Закрыть
          </button>
        </header>

        {toast && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
            {toast}
            <button type="button" className="ml-2 underline" onClick={() => setToast(null)}>
              ок
            </button>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {loading && !data ? (
            <p className="text-sm text-zinc-500">Загрузка…</p>
          ) : nav.screen === "hub" ? (
            <HubScreen
              hubEditable={hubEditable}
              onChange={(field, value) => {
                if (field === "year") debouncedPatch({ year: parseInt(value, 10) || null });
                else if (field === "mileage") debouncedPatch({ mileage: parseInt(value, 10) || null });
                else debouncedPatch({ [field]: value || null });
              }}
              positions={data?.positions ?? []}
              diagnosticId={activeId}
              onSelectBlock={(block) => setNav({ screen: "block", block })}
              onSummary={goSummary}
              canSummary={canSummary}
            />
          ) : nav.screen === "block" ? (
            <BlockScreen
              block={nav.block}
              positions={data?.positions ?? []}
              onPickNode={(node) => setNav({ screen: "position", block: nav.block, node })}
              onBack={() => setNav({ screen: "hub" })}
            />
          ) : nav.screen === "position" ? (
            <PositionScreen
              block={nav.block}
              node={nav.node}
              position={data?.positions.find((p) => p.node === nav.node)}
              tags={NODE_TAGS[nav.node] ?? []}
              recPresets={RECOMMENDATION_PRESETS[nav.node] ?? RECOMMENDATION_PRESETS.default}
              onBack={() => setNav({ screen: "block", block: nav.block })}
              onSave={savePosition}
              onPhoto={(file) => uploadPhoto(nav.node, file)}
              onVoice={() => setToast("В разработке")}
            />
          ) : (
            <SummaryScreen
              data={data}
              selectedOffers={selectedOffers}
              setSelectedOffers={setSelectedOffers}
              onBack={() => setNav({ screen: "hub" })}
              onAddShipment={addOffersToShipment}
              onSendReport={sendReport}
              onComplete={completeDiagnostic}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function HubScreen(props: {
  hubEditable: {
    licensePlate: string;
    brand: string;
    model: string;
    year: string;
    mileage: string;
  };
  onChange: (field: string, value: string) => void;
  positions: (DiagnosticPosition & { photos: DiagnosticPhoto[] })[];
  diagnosticId: string | null;
  onSelectBlock: (b: DiagnosticBlockCode) => void;
  onSummary: () => void;
  canSummary: boolean;
}) {
  const [history, setHistory] = useState<{ demands: unknown[]; diagnostics: unknown[] } | null>(null);

  useEffect(() => {
    if (!props.diagnosticId) return;
    fetch(`/api/diagnostic/${props.diagnosticId}/by-history`)
      .then((r) => r.json())
      .then(setHistory)
      .catch(() => {});
  }, [props.diagnosticId]);

  const progressForBlock = (block: DiagnosticBlockCode) => {
    const nodes = ALL_NODES.filter((n) => n.block === block).map((n) => n.node);
    let done = 0;
    for (const node of nodes) {
      const p = props.positions.find((x) => x.node === node);
      if (p && p.status !== "NOT_CHECKED") done++;
    }
    return { done, total: nodes.length };
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs">
          <span className="text-zinc-500">Госномер</span>
          <input
            className="mt-1 w-full rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-900"
            value={props.hubEditable.licensePlate}
            onChange={(e) => props.onChange("licensePlate", e.target.value)}
          />
        </label>
        <label className="block text-xs">
          <span className="text-zinc-500">Марка</span>
          <input
            className="mt-1 w-full rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-900"
            value={props.hubEditable.brand}
            onChange={(e) => props.onChange("brand", e.target.value)}
          />
        </label>
        <label className="block text-xs">
          <span className="text-zinc-500">Модель</span>
          <input
            className="mt-1 w-full rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-900"
            value={props.hubEditable.model}
            onChange={(e) => props.onChange("model", e.target.value)}
          />
        </label>
        <label className="block text-xs">
          <span className="text-zinc-500">Год</span>
          <input
            className="mt-1 w-full rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-900"
            value={props.hubEditable.year}
            onChange={(e) => props.onChange("year", e.target.value)}
          />
        </label>
        <label className="block text-xs">
          <span className="text-zinc-500">Пробег</span>
          <input
            className="mt-1 w-full rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-900"
            value={props.hubEditable.mileage}
            onChange={(e) => props.onChange("mileage", e.target.value)}
          />
        </label>
      </div>

      {history && (history.diagnostics.length > 0 || history.demands.length > 0) && (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs dark:border-zinc-700 dark:bg-zinc-900/40">
          <div className="font-medium text-zinc-700 dark:text-zinc-200">История</div>
          <ul className="mt-2 space-y-1 text-zinc-600 dark:text-zinc-400">
            {history.demands.slice(0, 3).map((d: any, i: number) => (
              <li key={i}>
                Отгрузка {d.name} · {new Date(d.momentAt).toLocaleDateString("ru-RU")}
              </li>
            ))}
            {history.diagnostics.map((d: any) => (
              <li key={d.id}>
                Диагностика {new Date(d.startedAt).toLocaleDateString("ru-RU")} · 🟢{d.summaryGreen} 🟡
                {d.summaryYellow} 🔴{d.summaryRed}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {BLOCK_ORDER.map((block) => {
          const { done, total } = progressForBlock(block);
          return (
            <button
              key={block}
              type="button"
              onClick={() => props.onSelectBlock(block)}
              className="rounded-xl border border-zinc-200 bg-white p-4 text-left shadow-sm hover:border-amber-400 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-amber-600"
            >
              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{BLOCK_TITLES[block]}</div>
              <div className="mt-1 text-xs text-zinc-500">
                {done} из {total} заполнено
              </div>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        disabled={!props.canSummary}
        onClick={props.onSummary}
        className="w-full rounded-lg bg-amber-500 py-3 text-sm font-medium text-white disabled:opacity-40 hover:bg-amber-600"
      >
        К сводке
      </button>
    </div>
  );
}

function BlockScreen(props: {
  block: DiagnosticBlockCode;
  positions: (DiagnosticPosition & { photos: DiagnosticPhoto[] })[];
  onPickNode: (node: string) => void;
  onBack: () => void;
}) {
  const nodes = ALL_NODES.filter((n) => n.block === props.block);
  return (
    <div>
      <button type="button" onClick={props.onBack} className="mb-4 text-sm text-amber-600 hover:underline">
        ← Назад
      </button>
      <h2 className="mb-3 text-lg font-semibold">{BLOCK_TITLES[props.block]}</h2>
      <ul className="space-y-2">
        {nodes.map((n) => {
          const p = props.positions.find((x) => x.node === n.node);
          const st = p?.status ?? "NOT_CHECKED";
          return (
            <li key={n.node}>
              <button
                type="button"
                onClick={() => props.onPickNode(n.node)}
                className="flex w-full items-center justify-between rounded-lg border border-zinc-200 px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                <span>{n.title}</span>
                <span className="text-xs text-zinc-500">{statusLabel(st)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function statusLabel(s: DiagnosticPositionStatus): string {
  switch (s) {
    case "GREEN":
      return "🟢";
    case "YELLOW":
      return "🟡";
    case "RED":
      return "🔴";
    case "SKIPPED":
      return "⊘";
    default:
      return "…";
  }
}

function PositionScreen(props: {
  block: DiagnosticBlockCode;
  node: string;
  position?: DiagnosticPosition & { photos: DiagnosticPhoto[] };
  tags: { code: string; label: string }[];
  recPresets: string[];
  onBack: () => void;
  onSave: (payload: {
    block: DiagnosticBlock;
    node: string;
    status: DiagnosticPositionStatus;
    tags?: string[];
    measurementValue?: number | null;
    measurementUnit?: string | null;
    recommendation?: string | null;
  }) => Promise<void>;
  onPhoto: (file: File) => Promise<void>;
  onVoice: () => void;
}) {
  const meta = ALL_NODES.find((x) => x.node === props.node);
  const measurement = meta?.measurement;
  const [status, setStatus] = useState<DiagnosticPositionStatus>(props.position?.status ?? "NOT_CHECKED");
  const [tags, setTags] = useState<string[]>(props.position?.tags ?? []);
  const [rec, setRec] = useState(props.position?.recommendation ?? "");
  const [meas, setMeas] = useState<string>(
    props.position?.measurementValue != null ? String(props.position.measurementValue) : ""
  );

  useEffect(() => {
    setStatus(props.position?.status ?? "NOT_CHECKED");
    setTags(props.position?.tags ?? []);
    setRec(props.position?.recommendation ?? "");
    setMeas(props.position?.measurementValue != null ? String(props.position.measurementValue) : "");
  }, [props.position]);

  const autoTraffic = () => {
    if (!measurement || meas === "") return;
    const v = Number.parseFloat(meas.replace(",", "."));
    if (!Number.isFinite(v)) return;
    const t = trafficLightFromMeasurement(measurement, v);
    setStatus(t === "GREEN" ? "GREEN" : t === "YELLOW" ? "YELLOW" : "RED");
  };

  useEffect(() => {
    if (measurement && meas) autoTraffic();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when meas changes for measurement nodes
  }, [meas, measurement]);

  const persist = async (next: Partial<{ status: DiagnosticPositionStatus; tags: string[] }>) => {
    await props.onSave({
      block: props.block as DiagnosticBlock,
      node: props.node,
      status: next.status ?? status,
      tags: next.tags ?? tags,
      measurementValue:
        meas !== "" && Number.isFinite(Number.parseFloat(meas.replace(",", ".")))
          ? Number.parseFloat(meas.replace(",", "."))
          : null,
      measurementUnit: measurement === "brake_fluid" ? "%" : measurement === "coolant" ? "°C" : null,
      recommendation: rec || null,
    });
  };

  return (
    <div>
      <button type="button" onClick={props.onBack} className="mb-4 text-sm text-amber-600 hover:underline">
        ← Назад
      </button>
      <h2 className="mb-2 text-lg font-semibold">{nodeTitle(props.node)}</h2>

      {measurement && (
        <div className="mb-4">
          <label className="block text-xs text-zinc-500">
            {measurement === "brake_fluid" ? "Влажность, %" : "Температура замерзания, °C"}
          </label>
          <input
            type="text"
            inputMode="decimal"
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-3 text-2xl font-semibold dark:border-zinc-600 dark:bg-zinc-900"
            value={meas}
            onChange={(e) => setMeas(e.target.value)}
          />
          <MeasScale measurement={measurement} value={meas} />
        </div>
      )}

      <div className="mb-4 grid grid-cols-3 gap-2">
        {(["GREEN", "YELLOW", "RED"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => {
              setStatus(s);
              void persist({ status: s });
            }}
            className={`rounded-xl py-4 text-sm font-medium ${
              status === s ? "ring-2 ring-amber-500" : ""
            } bg-zinc-100 dark:bg-zinc-800`}
          >
            {s === "GREEN" ? "🟢 Норма" : s === "YELLOW" ? "🟡 Внимание" : "🔴 Замена"}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() =>
          void props.onSave({
            block: props.block as DiagnosticBlock,
            node: props.node,
            status: "SKIPPED",
            tags,
            measurementValue:
              meas !== "" ? Number.parseFloat(meas.replace(",", ".")) : null,
            measurementUnit:
              measurement === "brake_fluid" ? "%" : measurement === "coolant" ? "°C" : null,
            recommendation: rec || null,
          })
        }
        className="mb-4 w-full rounded-lg border border-zinc-300 py-2 text-sm dark:border-zinc-600"
      >
        Пропустить узел
      </button>

      {(status === "YELLOW" || status === "RED") && (
        <>
          <div className="mb-2 flex flex-wrap gap-2">
            {props.tags.map((t) => (
              <button
                key={t.code}
                type="button"
                onClick={() => {
                  const next = tags.includes(t.code)
                    ? tags.filter((x) => x !== t.code)
                    : [...tags, t.code];
                  setTags(next);
                  void persist({ tags: next });
                }}
                className={`rounded-full border px-3 py-1 text-xs ${
                  tags.includes(t.code)
                    ? "border-amber-500 bg-amber-50 dark:bg-amber-950/40"
                    : "border-zinc-300 dark:border-zinc-600"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <label className="mt-3 block text-xs text-zinc-500">
            Фото (обязательно перед завершением диагностики)
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="mt-1 block w-full text-sm"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void props.onPhoto(f);
              }}
            />
          </label>

          <label className="mt-3 block text-xs text-zinc-500">
            Рекомендация
            <select
              className="mt-1 w-full rounded border border-zinc-300 bg-white px-2 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-900"
              value={rec}
              onChange={(e) => {
                setRec(e.target.value);
                void props.onSave({
                  block: props.block as DiagnosticBlock,
                  node: props.node,
                  status,
                  tags,
                  recommendation: e.target.value || null,
                  measurementValue:
                    meas !== "" ? Number.parseFloat(meas.replace(",", ".")) : null,
                  measurementUnit:
                    measurement === "brake_fluid" ? "%" : measurement === "coolant" ? "°C" : null,
                });
              }}
            >
              <option value="">—</option>
              {props.recPresets.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
        </>
      )}

      <button
        type="button"
        onClick={props.onVoice}
        className="mt-6 w-full rounded-lg border border-dashed border-zinc-400 py-2 text-sm text-zinc-600 dark:border-zinc-500 dark:text-zinc-400"
      >
        Голосовая заметка
      </button>
    </div>
  );
}

function MeasScale(props: { measurement: "brake_fluid" | "coolant"; value: string }) {
  const v = Number.parseFloat(props.value.replace(",", "."));
  const pct =
    props.measurement === "brake_fluid"
      ? Number.isFinite(v)
        ? Math.min(100, Math.max(0, (v / 5) * 100))
        : 0
      : Number.isFinite(v)
        ? Math.min(100, Math.max(0, ((20 + v) / 55) * 100))
        : 0;
  return (
    <div className="mt-2 h-3 w-full overflow-hidden rounded-full bg-gradient-to-r from-emerald-500 via-amber-400 to-red-600">
      <div
        className="h-full w-1 bg-black/40"
        style={{ marginLeft: `calc(${pct}% - 2px)` }}
        title={props.value}
      />
    </div>
  );
}

function SummaryScreen(props: {
  data: DiagnosticRow | null;
  selectedOffers: Record<string, number>;
  setSelectedOffers: import("react").Dispatch<import("react").SetStateAction<Record<string, number>>>;
  onBack: () => void;
  onAddShipment: () => void;
  onSendReport: () => void;
  onComplete: () => void;
}) {
  const yellowPositions =
    props.data?.positions.filter((p) => p.status === "YELLOW") ?? [];
  const variants = (o: DiagnosticOffer) => (o.variants as { label: string; priceRub: number }[]) ?? [];

  return (
    <div className="space-y-6">
      <button type="button" onClick={props.onBack} className="text-sm text-amber-600 hover:underline">
        ← К блокам
      </button>

      <div className="flex flex-wrap gap-4 text-center">
        <div className="rounded-xl bg-emerald-50 px-6 py-3 dark:bg-emerald-950/30">
          <div className="text-3xl font-bold">{props.data?.summaryGreen ?? 0}</div>
          <div className="text-xs text-zinc-600 dark:text-zinc-400">🟢</div>
        </div>
        <div className="rounded-xl bg-amber-50 px-6 py-3 dark:bg-amber-950/30">
          <div className="text-3xl font-bold">{props.data?.summaryYellow ?? 0}</div>
          <div className="text-xs text-zinc-600 dark:text-zinc-400">🟡</div>
        </div>
        <div className="rounded-xl bg-red-50 px-6 py-3 dark:bg-red-950/30">
          <div className="text-3xl font-bold">{props.data?.summaryRed ?? 0}</div>
          <div className="text-xs text-zinc-600 dark:text-zinc-400">🔴</div>
        </div>
      </div>

      <div>
        <h3 className="mb-2 font-semibold">Офферы (🔴)</h3>
        <ul className="space-y-3">
          {(props.data?.offers ?? [])
            .filter((o) => !o.nextVisitOnly)
            .map((o) => (
              <li key={o.id} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-1"
                    onChange={(e) => {
                      if (e.target.checked) {
                        props.setSelectedOffers((prev) => ({ ...prev, [o.id]: prev[o.id] ?? 0 }));
                      } else {
                        props.setSelectedOffers((prev) => {
                          const n = { ...prev };
                          delete n[o.id];
                          return n;
                        });
                      }
                    }}
                  />
                  <span className="flex-1 text-sm font-medium">{o.title}</span>
                </label>
                <div className="mt-2 space-y-1 pl-6">
                  {variants(o).map((v, idx) => (
                    <label key={idx} className="flex items-center gap-2 text-xs">
                      <input
                        type="radio"
                        name={`var-${o.id}`}
                        checked={(props.selectedOffers[o.id] ?? 0) === idx}
                        onChange={() =>
                          props.setSelectedOffers((prev) => ({ ...prev, [o.id]: idx }))
                        }
                      />
                      {v.label} — {v.priceRub.toLocaleString("ru-RU")} ₽
                    </label>
                  ))}
                </div>
              </li>
            ))}
        </ul>
      </div>

      {yellowPositions.length > 0 && (
        <div>
          <h3 className="mb-2 font-semibold">На следующий визит (🟡)</h3>
          <ul className="list-inside list-disc text-sm text-zinc-600 dark:text-zinc-400">
            {yellowPositions.map((p) => (
              <li key={p.id}>
                {nodeTitle(p.node)}
                {p.recommendation ? ` — ${p.recommendation}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={props.onAddShipment}
          className="rounded-lg bg-emerald-600 py-3 text-sm font-medium text-white hover:bg-emerald-700"
        >
          Добавить выбранные позиции в отгрузку
        </button>
        <button
          type="button"
          onClick={props.onSendReport}
          className="rounded-lg border border-zinc-300 py-3 text-sm dark:border-zinc-600"
        >
          Отправить отчёт клиенту (копировать ссылку)
        </button>
        <button
          type="button"
          onClick={props.onComplete}
          className="rounded-lg bg-amber-500 py-3 text-sm font-medium text-white hover:bg-amber-600"
        >
          Завершить диагностику
        </button>
      </div>
    </div>
  );
}
