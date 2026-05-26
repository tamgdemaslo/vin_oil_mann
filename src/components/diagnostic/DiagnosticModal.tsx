"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  Mic,
  Send,
  TriangleAlert,
  Wrench,
  X,
  XCircle,
} from "lucide-react";
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
import { EcoBadge, EcoButton, EcoKpi, type EcoBadgeTone } from "@/components/platform/EcoUI";
import { responseJson } from "@/lib/response-json";

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

type DiagnosticPositionRow = DiagnosticPosition & { photos: DiagnosticPhoto[] };

type DiagnosticHistory = {
  demands: { name: string | null; momentAt: string }[];
  diagnostics: {
    id: string;
    startedAt: string;
    summaryGreen: number;
    summaryYellow: number;
    summaryRed: number;
  }[];
};

function nodeTitle(node: string): string {
  return ALL_NODES.find((n) => n.node === node)?.title ?? node;
}

function summaryCounts(positions: DiagnosticPositionRow[]) {
  let summaryGreen = 0;
  let summaryYellow = 0;
  let summaryRed = 0;

  for (const p of positions) {
    if (p.status === "GREEN") summaryGreen++;
    else if (p.status === "YELLOW") summaryYellow++;
    else if (p.status === "RED") summaryRed++;
  }

  return { summaryGreen, summaryYellow, summaryRed };
}

function withUpdatedPosition(row: DiagnosticRow, position: DiagnosticPositionRow): DiagnosticRow {
  const exists = row.positions.some((p) => p.node === position.node);
  const positions = exists
    ? row.positions.map((p) => (p.node === position.node ? position : p))
    : [...row.positions, position];

  return {
    ...row,
    ...summaryCounts(positions),
    positions,
  };
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
  onAddedToShipment,
}: DiagnosticModalProps) {
  const [nav, setNav] = useState<Nav>({ screen: "hub" });
  const [data, setData] = useState<DiagnosticRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [sessionSeconds, setSessionSeconds] = useState(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveSeq = useRef(0);
  const latestPositionSave = useRef<Record<string, number>>({});
  const positionSaveQueues = useRef<Record<string, Promise<void>>>({});

  const activeId = data?.id ?? diagnosticId;

  const load = useCallback(async () => {
    if (!activeId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/diagnostic/${activeId}`);
      const json = await responseJson<DiagnosticRow & { error?: string }>(res);
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
      const json = await responseJson<DiagnosticRow & { error?: string }>(res);
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
      const seq = ++saveSeq.current;
      latestPositionSave.current[payload.node] = seq;

      setData((prev) => {
        if (!prev) return prev;
        const current = prev.positions.find((p) => p.node === payload.node);
        if (!current) return prev;

        const optimistic: DiagnosticPositionRow = {
          ...current,
          status: payload.status,
          tags: payload.tags ?? current.tags,
          measurementValue:
            payload.measurementValue === undefined
              ? current.measurementValue
              : (payload.measurementValue as DiagnosticPosition["measurementValue"]),
          measurementUnit:
            payload.measurementUnit === undefined ? current.measurementUnit : payload.measurementUnit,
          recommendation:
            payload.recommendation === undefined ? current.recommendation : payload.recommendation,
        };

        return withUpdatedPosition(prev, optimistic);
      });

      const runSave = async () => {
        const res = await fetch(`/api/diagnostic/${activeId}/position`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const json = await responseJson<(DiagnosticPositionRow & { error?: string })>(res);
        if (!res.ok) throw new Error(json.error ?? "Ошибка сохранения узла");
        if (latestPositionSave.current[payload.node] === seq) {
          setData((prev) => (prev ? withUpdatedPosition(prev, json as DiagnosticPositionRow) : prev));
        }
      };

      const previousSave = positionSaveQueues.current[payload.node] ?? Promise.resolve();
      const queuedSave = previousSave
        .catch(() => undefined)
        .then(runSave)
        .catch((e) => {
          if (latestPositionSave.current[payload.node] === seq) {
            setToast(e instanceof Error ? e.message : "Ошибка сохранения узла");
            void load();
          }
        });

      positionSaveQueues.current[payload.node] = queuedSave;
      void queuedSave.finally(() => {
        if (positionSaveQueues.current[payload.node] === queuedSave) {
          delete positionSaveQueues.current[payload.node];
        }
      });

      await queuedSave;
    },
    [activeId, load]
  );

  const uploadPhoto = async (node: string, file: File) => {
    if (!activeId) return;
    const fd = new FormData();
    fd.set("node", node);
    fd.set("file", file);
    const res = await fetch(`/api/diagnostic/${activeId}/photo`, { method: "POST", body: fd });
    const json = await responseJson<{ error?: string }>(res);
    if (!res.ok) throw new Error(json.error ?? "Фото не загружено");
    await load();
  };

  const goSummary = async () => {
    if (!activeId) return;
    try {
      const ro = await fetch(`/api/diagnostic/${activeId}/rebuild-offers`, { method: "POST" });
      const roJson = await responseJson<{ error?: string }>(ro);
      if (!ro.ok) {
        setToast(roJson.error ?? "Не удалось пересчитать офферы");
        return;
      }
      await load();
      setNav({ screen: "summary" });
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Ошибка");
    }
  };

  const completeDiagnostic = async () => {
    if (!activeId) return;
    try {
      const res = await fetch(`/api/diagnostic/${activeId}/complete`, { method: "POST" });
      const json = await responseJson<{ error?: string }>(res);
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
    const json = await responseJson<{ error?: string; reportUrl?: string }>(res);
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
    const json = await responseJson<{ error?: string }>(res);
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
    <div className="eco-diagnostic-overlay fixed inset-0 z-[100] flex flex-col bg-white dark:bg-zinc-950 md:items-center md:justify-center md:bg-black/50 md:p-4">
      <div className="eco-diagnostic-shell flex min-h-0 flex-1 flex-col overflow-hidden md:max-h-[95vh] md:max-w-[960px] md:rounded-xl md:border md:border-zinc-200 md:bg-white md:shadow-xl dark:md:border-zinc-700 dark:md:bg-zinc-900">
        <header className="eco-diagnostic-topbar flex shrink-0 items-center justify-between gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-700">
          <div>
            <div className="eco-page-kicker">Диагностика 14 пунктов</div>
            <div className="eco-diagnostic-title">Диагностика</div>
            <div className="eco-diagnostic-session">
              Сессия: {Math.floor(sessionSeconds / 60)}:{String(sessionSeconds % 60).padStart(2, "0")}
            </div>
          </div>
          <EcoButton type="button" onClick={onClose} size="sm">
            <X className="eco-icon" aria-hidden />
            Закрыть
          </EcoButton>
        </header>

        {toast && (
          <div className="eco-diagnostic-toast">
            {toast}
            <button type="button" onClick={() => setToast(null)}>
              ок
            </button>
          </div>
        )}

        <div className="eco-diagnostic-body min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {loading && !data ? (
            <p className="text-sm text-zinc-500">Загрузка…</p>
          ) : nav.screen === "hub" ? (
            <HubScreen
              hubEditable={hubEditable}
              onChange={(field, value) => {
                const partial =
                  field === "year"
                    ? { year: parseInt(value, 10) || null }
                    : field === "mileage"
                      ? { mileage: parseInt(value, 10) || null }
                      : { [field]: value || null };

                setData((prev) => (prev ? ({ ...prev, ...partial } as DiagnosticRow) : prev));
                debouncedPatch(partial);
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
  const [history, setHistory] = useState<DiagnosticHistory | null>(null);

  useEffect(() => {
    if (!props.diagnosticId) return;
    fetch(`/api/diagnostic/${props.diagnosticId}/by-history`)
      .then(async (r) => {
        if (!r.ok) return;
        const j = await responseJson<DiagnosticHistory>(r);
        setHistory(j);
      })
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
    <div className="eco-diagnostic-hub">
      <section className="eco-card eco-card--padded eco-diagnostic-vehicle">
        <div>
          <div className="eco-page-kicker">Автомобиль</div>
          <h3>Карточка диагностики</h3>
        </div>
        <div className="eco-diagnostic-vehicle-grid">
          <label className="eco-field">
            <span>Госномер</span>
            <input
              className="eco-input"
              value={props.hubEditable.licensePlate}
              onChange={(e) => props.onChange("licensePlate", e.target.value)}
            />
          </label>
          <label className="eco-field">
            <span>Марка</span>
            <input
              className="eco-input"
              value={props.hubEditable.brand}
              onChange={(e) => props.onChange("brand", e.target.value)}
            />
          </label>
          <label className="eco-field">
            <span>Модель</span>
            <input
              className="eco-input"
              value={props.hubEditable.model}
              onChange={(e) => props.onChange("model", e.target.value)}
            />
          </label>
          <label className="eco-field">
            <span>Год</span>
            <input
              className="eco-input"
              value={props.hubEditable.year}
              onChange={(e) => props.onChange("year", e.target.value)}
            />
          </label>
          <label className="eco-field">
            <span>Пробег</span>
            <input
              className="eco-input"
              value={props.hubEditable.mileage}
              onChange={(e) => props.onChange("mileage", e.target.value)}
            />
          </label>
        </div>
      </section>

      {history &&
        ((history.demands?.length ?? 0) > 0 || (history.diagnostics?.length ?? 0) > 0) && (
        <section className="eco-diagnostic-history">
          <div className="eco-page-kicker">История</div>
          <ul>
            {(history.demands ?? []).slice(0, 3).map((d, i) => (
              <li key={i}>
                <span>Отгрузка {d.name}</span>
                <b>{new Date(d.momentAt).toLocaleDateString("ru-RU")}</b>
              </li>
            ))}
            {(history.diagnostics ?? []).map((d) => (
              <li key={d.id}>
                <span>Диагностика {new Date(d.startedAt).toLocaleDateString("ru-RU")}</span>
                <b>
                  {d.summaryGreen}/{d.summaryYellow}/{d.summaryRed}
                </b>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="eco-diagnostic-block-grid">
        {BLOCK_ORDER.map((block) => {
          const { done, total } = progressForBlock(block);
          const pct = total ? Math.round((done / total) * 100) : 0;
          return (
            <button
              key={block}
              type="button"
              onClick={() => props.onSelectBlock(block)}
              className="eco-diagnostic-block-card"
            >
              <div>
                <Wrench className="eco-icon" aria-hidden />
                <strong>{BLOCK_TITLES[block]}</strong>
              </div>
              <span>
                {done} / {total}
              </span>
              <i aria-hidden>
                <em style={{ width: `${pct}%` }} />
              </i>
            </button>
          );
        })}
      </div>

      <EcoButton
        type="button"
        disabled={!props.canSummary}
        onClick={props.onSummary}
        variant="primary"
        className="eco-diagnostic-summary-btn"
      >
        <FileText className="eco-icon" aria-hidden />
        К сводке
      </EcoButton>
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
    <div className="eco-diagnostic-panel">
      <div className="eco-diagnostic-panel-head">
        <EcoButton type="button" onClick={props.onBack} variant="ghost" size="sm">
          <ArrowLeft className="eco-icon" aria-hidden />
          Назад
        </EcoButton>
        <div>
          <div className="eco-page-kicker">Блок проверки</div>
          <h2>{BLOCK_TITLES[props.block]}</h2>
        </div>
      </div>
      <ul className="eco-diagnostic-node-list">
        {nodes.map((n) => {
          const p = props.positions.find((x) => x.node === n.node);
          const st = p?.status ?? "NOT_CHECKED";
          return (
            <li key={n.node}>
              <button
                type="button"
                onClick={() => props.onPickNode(n.node)}
                className="eco-diagnostic-node"
              >
                <span>{n.title}</span>
                <EcoBadge tone={statusTone(st)} dot>
                  {statusLabel(st)}
                </EcoBadge>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function statusTone(s: DiagnosticPositionStatus): EcoBadgeTone {
  switch (s) {
    case "GREEN":
      return "success";
    case "YELLOW":
      return "warning";
    case "RED":
      return "danger";
    case "SKIPPED":
      return "info";
    default:
      return "neutral";
  }
}

function statusLabel(s: DiagnosticPositionStatus): string {
  switch (s) {
    case "GREEN":
      return "Норма";
    case "YELLOW":
      return "Внимание";
    case "RED":
      return "Замена";
    case "SKIPPED":
      return "Пропущено";
    default:
      return "Не проверено";
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
    <div className="eco-diagnostic-panel eco-diagnostic-position">
      <div className="eco-diagnostic-panel-head">
        <EcoButton type="button" onClick={props.onBack} variant="ghost" size="sm">
          <ArrowLeft className="eco-icon" aria-hidden />
          Назад
        </EcoButton>
        <div>
          <div className="eco-page-kicker">{BLOCK_TITLES[props.block]}</div>
          <h2>{nodeTitle(props.node)}</h2>
        </div>
      </div>

      {measurement && (
        <div className="eco-diagnostic-measurement">
          <label className="eco-field">
            <span>
              {measurement === "brake_fluid" ? "Влажность, %" : "Температура замерзания, °C"}
            </span>
            <input
              type="text"
              inputMode="decimal"
              className="eco-input eco-diagnostic-measurement-input"
              value={meas}
              onChange={(e) => setMeas(e.target.value)}
            />
          </label>
          <MeasScale measurement={measurement} value={meas} />
        </div>
      )}

      <div className="eco-diagnostic-status-grid">
        {(["GREEN", "YELLOW", "RED"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => {
              setStatus(s);
              void persist({ status: s });
            }}
            className={`eco-diagnostic-status-btn eco-diagnostic-status-btn--${s.toLowerCase()} ${
              status === s ? "is-active" : ""
            }`}
          >
            {s === "GREEN" ? (
              <CheckCircle2 className="eco-icon" aria-hidden />
            ) : s === "YELLOW" ? (
              <TriangleAlert className="eco-icon" aria-hidden />
            ) : (
              <XCircle className="eco-icon" aria-hidden />
            )}
            {statusLabel(s)}
          </button>
        ))}
      </div>

      <EcoButton
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
        className="eco-diagnostic-skip-btn"
      >
        <X className="eco-icon" aria-hidden />
        Пропустить узел
      </EcoButton>

      {(status === "YELLOW" || status === "RED") && (
        <>
          <div className="eco-diagnostic-tags">
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
                className={`eco-diagnostic-tag ${tags.includes(t.code) ? "is-active" : ""}`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <label className="eco-diagnostic-file">
            <Camera className="eco-icon" aria-hidden />
            <span>Фото обязательно перед завершением диагностики</span>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void props.onPhoto(f);
              }}
            />
          </label>

          <label className="eco-field eco-diagnostic-recommendation">
            <span>Рекомендация</span>
            <select
              className="eco-input"
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

      <EcoButton
        type="button"
        onClick={props.onVoice}
        variant="ghost"
        className="eco-diagnostic-voice-btn"
      >
        <Mic className="eco-icon" aria-hidden />
        Голосовая заметка
      </EcoButton>
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
    <div className="eco-diagnostic-scale">
      <div
        className="eco-diagnostic-scale-marker"
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
    <div className="eco-diagnostic-summary">
      <div className="eco-diagnostic-panel-head">
        <EcoButton type="button" onClick={props.onBack} variant="ghost" size="sm">
          <ArrowLeft className="eco-icon" aria-hidden />
          К блокам
        </EcoButton>
        <div>
          <div className="eco-page-kicker">Сводка</div>
          <h2>Рекомендации и офферы</h2>
        </div>
      </div>

      <div className="eco-grid eco-grid--kpi eco-diagnostic-summary-kpis">
        <EcoKpi label="Норма" value={props.data?.summaryGreen ?? 0} sub="Без действий" tone="success" />
        <EcoKpi label="Внимание" value={props.data?.summaryYellow ?? 0} sub="На следующий визит" tone="warning" />
        <EcoKpi label="Замена" value={props.data?.summaryRed ?? 0} sub="Предложить сейчас" tone="danger" />
      </div>

      <section className="eco-card eco-card--padded eco-diagnostic-offers">
        <div className="eco-diagnostic-section-head">
          <div className="eco-page-kicker">Офферы</div>
          <h3>Красная зона</h3>
        </div>
        <ul>
          {(props.data?.offers ?? [])
            .filter((o) => !o.nextVisitOnly)
            .map((o) => (
              <li key={o.id}>
                <label className="eco-diagnostic-offer-check">
                  <input
                    type="checkbox"
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
                  <span>{o.title}</span>
                </label>
                <div className="eco-diagnostic-offer-variants">
                  {variants(o).map((v, idx) => (
                    <label key={idx}>
                      <input
                        type="radio"
                        name={`var-${o.id}`}
                        checked={(props.selectedOffers[o.id] ?? 0) === idx}
                        onChange={() =>
                          props.setSelectedOffers((prev) => ({ ...prev, [o.id]: idx }))
                        }
                      />
                      <span>{v.label}</span>
                      <b>{v.priceRub.toLocaleString("ru-RU")} ₽</b>
                    </label>
                  ))}
                </div>
              </li>
            ))}
        </ul>
      </section>

      {yellowPositions.length > 0 && (
        <section className="eco-card eco-card--padded eco-diagnostic-next-visit">
          <div className="eco-diagnostic-section-head">
            <div className="eco-page-kicker">Следующий визит</div>
            <h3>Желтая зона</h3>
          </div>
          <ul>
            {yellowPositions.map((p) => (
              <li key={p.id}>
                <span>{nodeTitle(p.node)}</span>
                {p.recommendation && <b>{p.recommendation}</b>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="eco-diagnostic-actions">
        <EcoButton
          type="button"
          onClick={props.onAddShipment}
          variant="primary"
        >
          <ClipboardCheck className="eco-icon" aria-hidden />
          Добавить выбранные позиции в отгрузку
        </EcoButton>
        <EcoButton
          type="button"
          onClick={props.onSendReport}
        >
          <Send className="eco-icon" aria-hidden />
          Отправить отчёт клиенту (копировать ссылку)
        </EcoButton>
        <EcoButton
          type="button"
          onClick={props.onComplete}
          variant="danger"
        >
          <CheckCircle2 className="eco-icon" aria-hidden />
          Завершить диагностику
        </EcoButton>
      </div>
    </div>
  );
}
