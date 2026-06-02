"use client";

/**
 * LEGACY DIAGNOSTIC UX.
 *
 * This component is intentionally kept only for historical compatibility while
 * old Diagnostic/DiagnosticPosition records and old public tokens still exist.
 * New shipment flows must use DiagnosticMapModal and /api/diagnostics/**.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Camera,
  ChevronDown,
  ChevronUp,
  CheckCheck,
  CheckCircle2,
  ClipboardCheck,
  Eye,
  FileText,
  ImageOff,
  ListChecks,
  Maximize2,
  Mic,
  Minimize2,
  SkipForward,
  TriangleAlert,
  Wrench,
  X,
  XCircle,
  Trash2,
} from "lucide-react";
import {
  ALL_NODES,
  BLOCK_ORDER,
  BLOCK_TITLES,
  NODE_TAGS,
  RED_NODE_OFFERS,
  RECOMMENDATION_PRESETS,
  tagLabelsForNode,
  type CatalogNode,
  type TagDef,
  type VehicleHints,
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
  | { screen: "quick" }
  | { screen: "block"; block: DiagnosticBlockCode }
  | { screen: "position"; block: DiagnosticBlockCode; node: string; from?: "quick" | "block" }
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

type SaveStatus = "saved" | "saving" | "error";
type DiagnosticStats = ReturnType<typeof diagnosticStats>;
type PhotoUploadProgress = (percent: number) => void;
type QuickFilterMode = "all" | "issues" | "missingPhotos";
type OfferDecision = "later" | "ignored" | "added";
type LiveOfferVariant = { label: string; priceRub: number };
type DiagnosticLiveOffer = {
  key: string;
  node: string;
  offerKey: string;
  nodeTitle: string;
  title: string;
  variants: LiveOfferVariant[];
  decision?: OfferDecision;
};
type QuickUiCommandInput =
  | { type: "next_unchecked" | "collapse_all" | "expand_problematic" }
  | { type: "open_node" | "open_photo_node"; node: string };
type QuickUiCommand = QuickUiCommandInput & { nonce: number };
type QuickDetailCommandInput =
  | { type: "collapse_all" | "expand_problematic" }
  | { type: "open_node" | "collapse_node"; node: string };
type QuickDetailCommand = QuickDetailCommandInput & { nonce: number };
type GearboxChoice = "atf" | "manual" | "unknown";
type DriveChoice = "front" | "rear" | "awd" | "unknown";
type DiagnosticPositionSavePayload = {
  block: DiagnosticBlock;
  node: string;
  status: DiagnosticPositionStatus;
  tags?: string[];
  measurementValue?: number | null;
  measurementUnit?: string | null;
  recommendation?: string | null;
  notes?: string | null;
};
type DiagnosticPositionSaveError = {
  message: string;
  payload: DiagnosticPositionSavePayload;
};
type CrmReminderResponse = {
  error?: string;
  createdCount?: number;
  existingCount?: number;
  positionIds?: string[];
  deadline?: string;
};
type DiagnosticCompleteBlocker = {
  positionId: string;
  node: string;
  nodeLabel: string;
  reason: "missing_photo" | "missing_required_field";
  message: string;
};
type CompleteDiagnosticResponse = {
  error?: string;
  blockers?: DiagnosticCompleteBlocker[];
};
type DiagnosticQuickActions = {
  filterMode: QuickFilterMode;
  onFilterModeChange: (mode: QuickFilterMode) => void;
  onMarkAllNormal: () => void;
  onMarkRemainingNormal: () => void;
  onSkipNotApplicable: () => void;
  onNextUnchecked: () => void;
  onCollapseAll: () => void;
  onExpandProblematic: () => void;
  onAddMissingPhoto: (node: string) => void;
  onAddMissingRecommendation: (node: string) => void;
};
type DiagnosticActionPanelProps = {
  stats: DiagnosticStats;
  canSummary: boolean;
  liveOffers: DiagnosticLiveOffer[];
  reportUrl: string | null;
  reportActionsDisabled: boolean;
  quickActions: DiagnosticQuickActions;
  onAddLiveOffer: (offer: DiagnosticLiveOffer, variantIndex: number) => void;
  onSetOfferDecision: (key: string, decision: OfferDecision) => void;
  onSummary: () => void;
  onComplete: () => void;
  onCopyReportLink: () => void;
  onOpenReport: () => void;
  onPrintReport: () => void;
  compact?: boolean;
};

const VEHICLE_DEPENDENT_NODE_CODES = new Set(["atf", "mtf", "front_diff", "rear_diff", "transfer_case", "power_steering"]);
const TAG_CHIP_VISIBLE_LIMIT = 4;
const HOTKEY_STATUS_MAP: Partial<Record<string, DiagnosticPositionStatus>> = {
  "1": "GREEN",
  "2": "YELLOW",
  "3": "RED",
  "4": "SKIPPED",
};
const CATALOG_NODE_BY_CODE = new Map(ALL_NODES.map((node, index) => [node.node, { node, index }]));

function quickRowDomId(node: string): string {
  return `diagnostic-row-${node}`;
}

function quickPhotoInputId(node: string): string {
  return `diagnostic-photo-${node}`;
}

function isEditableHotkeyTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return target.isContentEditable || tagName === "input" || tagName === "textarea" || tagName === "select";
}

function shouldUseDiagnosticHotkeys(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches;
}

function nodeTitle(node: string): string {
  return ALL_NODES.find((n) => n.node === node)?.title ?? node;
}

function diagnosticPointCountLabel(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} пункт`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} пункта`;
  return `${count} пунктов`;
}

function historyRecordCountLabel(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} запись в истории`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} записи в истории`;
  return `${count} записей в истории`;
}

function catalogNodeForPosition(position: DiagnosticPositionRow): CatalogNode {
  const catalogNode = CATALOG_NODE_BY_CODE.get(position.node)?.node;
  return catalogNode ?? {
    node: position.node,
    block: position.block as DiagnosticBlockCode,
    title: position.node,
  };
}

function catalogPositionIndex(node: string): number {
  return CATALOG_NODE_BY_CODE.get(node)?.index ?? Number.MAX_SAFE_INTEGER;
}

function sortDiagnosticRows<T extends { node: CatalogNode; position: DiagnosticPositionRow }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const blockDelta = BLOCK_ORDER.indexOf(a.node.block) - BLOCK_ORDER.indexOf(b.node.block);
    if (blockDelta !== 0) return blockDelta;
    const indexDelta = catalogPositionIndex(a.node.node) - catalogPositionIndex(b.node.node);
    if (indexDelta !== 0) return indexDelta;
    return a.node.title.localeCompare(b.node.title, "ru");
  });
}

function fuelHintsFromPositions(positions: DiagnosticPositionRow[]): Pick<VehicleHints, "electric" | "hybrid"> {
  const hasEngineOil = positions.some((position) => position.node === "engine_oil");
  const hasSparkSurvey = positions.some((position) => position.node === "survey_sparks");
  return !hasEngineOil && !hasSparkSurvey ? { electric: true, hybrid: false } : {};
}

function vehicleHintsFromQuickChoices(
  gearbox: GearboxChoice,
  drive: DriveChoice,
  fuelHints?: Pick<VehicleHints, "electric" | "hybrid">
): VehicleHints {
  return {
    ...fuelHints,
    hasAtf: gearbox === "atf",
    hasManualGearbox: gearbox === "manual",
    awd: drive === "awd",
  };
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

function isProblemPosition(position: Pick<DiagnosticPositionRow, "status">): boolean {
  return position.status === "YELLOW" || position.status === "RED";
}

function isMissingPhotoPosition(position: DiagnosticPositionRow): boolean {
  return isProblemPosition(position) && position.photos.length < 1;
}

function isMissingRecommendationPosition(position: DiagnosticPositionRow): boolean {
  return isProblemPosition(position) && !position.recommendation?.trim();
}

function measurementValueForSave(position: DiagnosticPositionRow): number | null {
  if (position.measurementValue == null) return null;
  const value = Number.parseFloat(String(position.measurementValue));
  return Number.isFinite(value) ? value : null;
}

function photoUrl(diagnosticId: string | null, photoId: string): string {
  return diagnosticId ? `/api/diagnostic/${diagnosticId}/photo/${photoId}` : "";
}

function problematicPointLabel(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "проблемный пункт";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "проблемных пункта";
  return "проблемных пунктов";
}

function liveOfferKey(node: string, offerKey: string): string {
  return `${node}:${offerKey}`;
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

function diagnosticStats(positions: DiagnosticPositionRow[]) {
  const counts = summaryCounts(positions);
  const unchecked = positions.filter((p) => p.status === "NOT_CHECKED").length;
  const skipped = positions.filter((p) => p.status === "SKIPPED").length;
  const filled = positions.filter((p) => p.status !== "NOT_CHECKED").length;
  const missingPhoto = positions.filter(isMissingPhotoPosition);
  const missingRecommendation = positions.filter(isMissingRecommendationPosition);
  const notApplicableCandidates = positions.filter(
    (p) => p.status === "NOT_CHECKED" && VEHICLE_DEPENDENT_NODE_CODES.has(p.node)
  ).length;

  return {
    ...counts,
    unchecked,
    skipped,
    filled,
    total: positions.length,
    missingPhoto,
    missingRecommendation,
    notApplicableCandidates,
  };
}

function saveStatusLabel(status: SaveStatus): string {
  switch (status) {
    case "saving":
      return "Сохраняем…";
    case "error":
      return "Ошибка сохранения";
    default:
      return "Сохранено";
  }
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
  const [nav, setNav] = useState<Nav>({ screen: "quick" });
  const [data, setData] = useState<DiagnosticRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [sessionSeconds, setSessionSeconds] = useState(0);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveSeq = useRef(0);
  const saveInFlight = useRef(0);
  const latestPositionSave = useRef<Record<string, number>>({});
  const positionSaveQueues = useRef<Record<string, Promise<void>>>({});
  const quickCommandSeq = useRef(0);
  const [quickFilterMode, setQuickFilterMode] = useState<QuickFilterMode>("all");
  const [quickUiCommand, setQuickUiCommand] = useState<QuickUiCommand | null>(null);
  const [offerDecisions, setOfferDecisions] = useState<Record<string, OfferDecision>>({});
  const [reportUrl, setReportUrl] = useState<string | null>(null);
  const [positionSaveErrors, setPositionSaveErrors] = useState<Record<string, DiagnosticPositionSaveError>>({});
  const [crmReminderPositionIds, setCrmReminderPositionIds] = useState<string[]>([]);
  const [crmReminderLoading, setCrmReminderLoading] = useState(false);

  const activeId = data?.id ?? diagnosticId;

  const beginSave = useCallback(() => {
    saveInFlight.current += 1;
    setSaveStatus("saving");
  }, []);

  const finishSave = useCallback((ok: boolean) => {
    saveInFlight.current = Math.max(0, saveInFlight.current - 1);
    if (!ok) {
      setSaveStatus("error");
      return;
    }
    if (saveInFlight.current === 0) {
      setSaveStatus("saved");
    }
  }, []);

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
      beginSave();
      try {
        const res = await fetch(`/api/diagnostic/${activeId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(partial),
        });
        const json = await responseJson<DiagnosticRow & { error?: string }>(res);
        if (!res.ok) throw new Error(json.error ?? "Ошибка сохранения");
        setData(json as DiagnosticRow);
        finishSave(true);
      } catch (error) {
        finishSave(false);
        throw error;
      }
    },
    [activeId, beginSave, finishSave]
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

  const applyVehicleHints = useCallback(
    async (vehicleHints: VehicleHints) => {
      try {
        await patchHeader({ vehicleHints });
        setToast("Список диагностики обновлён");
      } catch (error) {
        setToast(error instanceof Error ? error.message : "Не удалось обновить список диагностики");
      }
    },
    [patchHeader]
  );

  const savePosition = useCallback(
    async (payload: DiagnosticPositionSavePayload) => {
      if (!activeId) return;
      const seq = ++saveSeq.current;
      latestPositionSave.current[payload.node] = seq;
      beginSave();
      setPositionSaveErrors((prev) => {
        if (!prev[payload.node]) return prev;
        const next = { ...prev };
        delete next[payload.node];
        return next;
      });

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
          notes: payload.notes === undefined ? current.notes : payload.notes,
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
          setPositionSaveErrors((prev) => {
            if (!prev[payload.node]) return prev;
            const next = { ...prev };
            delete next[payload.node];
            return next;
          });
        }
        finishSave(true);
      };

      const previousSave = positionSaveQueues.current[payload.node] ?? Promise.resolve();
      const queuedSave = previousSave
        .catch(() => undefined)
        .then(runSave)
        .catch((e) => {
          if (latestPositionSave.current[payload.node] === seq) {
            const message = e instanceof Error ? e.message : "Ошибка сохранения узла";
            setToast(message);
            setPositionSaveErrors((prev) => ({
              ...prev,
              [payload.node]: { message, payload },
            }));
            finishSave(false);
          } else {
            finishSave(true);
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
    [activeId, beginSave, finishSave]
  );

  const uploadPhotos = async (node: string, files: File[], onProgress?: PhotoUploadProgress) => {
    if (!activeId) return;
    if (files.length === 0) return;
    beginSave();
    try {
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        const fd = new FormData();
        fd.set("node", node);
        fd.set("file", file);
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("POST", `/api/diagnostic/${activeId}/photo`);
          xhr.upload.onprogress = (event) => {
            if (!event.lengthComputable) return;
            const fileProgress = event.loaded / event.total;
            onProgress?.(Math.max(1, Math.round(((index + fileProgress) / files.length) * 100)));
          };
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              onProgress?.(Math.round(((index + 1) / files.length) * 100));
              resolve();
              return;
            }
            try {
              const json = JSON.parse(xhr.responseText) as { error?: string };
              reject(new Error(json.error ?? "Фото не загружено"));
            } catch {
              reject(new Error("Фото не загружено"));
            }
          };
          xhr.onerror = () => reject(new Error("Не удалось загрузить фото. Проверьте соединение и попробуйте ещё раз."));
          xhr.send(fd);
        });
      }
      await load();
      finishSave(true);
    } catch (error) {
      finishSave(false);
      throw error;
    }
  };

  const deletePhoto = async (photoId: string) => {
    if (!activeId) return;
    beginSave();
    try {
      const res = await fetch(`/api/diagnostic/${activeId}/photo/${photoId}`, { method: "DELETE" });
      const json = await responseJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(json.error ?? "Фото не удалено");
      await load();
      finishSave(true);
    } catch (error) {
      finishSave(false);
      throw error;
    }
  };

  const rebuildOffers = useCallback(async () => {
    if (!activeId) return [];
    const res = await fetch(`/api/diagnostic/${activeId}/rebuild-offers`, { method: "POST" });
    const json = await responseJson<{ error?: string; offers?: DiagnosticOffer[] }>(res);
    if (!res.ok) throw new Error(json.error ?? "Не удалось пересчитать офферы");
    const offers = json.offers ?? [];
    setData((prev) => (prev ? { ...prev, offers } : prev));
    return offers;
  }, [activeId]);

  const goSummary = async () => {
    if (!activeId) return;
    try {
      await rebuildOffers();
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
      const json = await responseJson<CompleteDiagnosticResponse>(res);
      if (!res.ok) {
        const blockers = json.blockers ?? [];
        if (blockers.length > 0) {
          const firstBlocker = blockers[0];
          setToast(
            blockers.length === 1
              ? firstBlocker.message
              : `${json.error ?? "Есть блокеры"}: ${blockers.slice(0, 3).map((blocker) => blocker.message).join(" · ")}`
          );
          setNav({ screen: "quick" });
          setQuickFilterMode(firstBlocker.reason === "missing_photo" ? "missingPhotos" : "issues");
          quickCommandSeq.current += 1;
          setQuickUiCommand({
            type: firstBlocker.reason === "missing_photo" ? "open_photo_node" : "open_node",
            node: firstBlocker.node,
            nonce: quickCommandSeq.current,
          });
          return;
        }
        throw new Error(json.error ?? "Ошибка");
      }
      const linkRes = await fetch(`/api/diagnostic/${activeId}/report-link`, { method: "POST" });
      const linkJson = await responseJson<{ error?: string; reportUrl?: string }>(linkRes);
      if (linkRes.ok) {
        setReportUrl(linkJson.reportUrl ?? null);
      }
      setToast(linkRes.ok ? "Диагностика завершена. Ссылка отчёта готова" : "Диагностика завершена");
      await load();
      await rebuildOffers();
      setNav({ screen: "summary" });
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Ошибка");
    }
  };

  const getReportLink = async (): Promise<string | null> => {
    if (!activeId) return null;
    const res = await fetch(`/api/diagnostic/${activeId}/report-link`, { method: "POST" });
    const json = await responseJson<{ error?: string; reportUrl?: string }>(res);
    if (!res.ok) {
      setToast(json.error ?? "Ошибка");
      return null;
    }
    setReportUrl(json.reportUrl ?? null);
    return json.reportUrl ?? null;
  };

  const copyReportLink = async () => {
    const url = await getReportLink();
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setToast("Ссылка для клиента скопирована в буфер обмена");
    } catch {
      setToast(`Ссылка: ${url}`);
    }
  };

  const openClientReport = async () => {
    if (data?.status !== "COMPLETED") {
      setToast("Завершите диагностику перед открытием отчёта");
      return;
    }
    const url = await getReportLink();
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const printClientReport = async () => {
    if (data?.status !== "COMPLETED") {
      setToast("Завершите диагностику перед печатью");
      return;
    }
    const url = await getReportLink();
    if (!url) return;
    const separator = url.includes("?") ? "&" : "?";
    window.open(`${url}${separator}print=1`, "_blank", "noopener,noreferrer");
  };

  const createCrmReminders = useCallback(
    async (positionIds?: string[]) => {
      if (!activeId) return;
      setCrmReminderLoading(true);
      try {
        const res = await fetch(`/api/diagnostic/${activeId}/crm-reminders`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            dueDays: 30,
            ...(positionIds && positionIds.length > 0 ? { positionIds } : {}),
          }),
        });
        const json = await responseJson<CrmReminderResponse>(res);
        if (!res.ok) throw new Error(json.error ?? "Не удалось создать CRM-дела");
        const affected = json.positionIds ?? [];
        if (affected.length > 0) {
          setCrmReminderPositionIds((prev) => [...new Set([...prev, ...affected])]);
        }
        const created = json.createdCount ?? 0;
        const existing = json.existingCount ?? 0;
        if (created > 0) {
          setToast(`CRM-дела созданы: ${created}`);
        } else if (existing > 0) {
          setToast("CRM-дела уже были созданы ранее");
        } else {
          setToast("Нет жёлтых пунктов для CRM");
        }
      } catch (error) {
        setToast(error instanceof Error ? error.message : "Не удалось создать CRM-дела");
      } finally {
        setCrmReminderLoading(false);
      }
    },
    [activeId]
  );

  const [selectedOffers, setSelectedOffers] = useState<Record<string, number>>({});

  const totalNodes = data?.positions.length ?? 0;
  const filled = useMemo(() => {
    if (!data?.positions) return 0;
    return data.positions.filter((p) => p.status !== "NOT_CHECKED").length;
  }, [data?.positions]);

  const canSummary = hubSummaryProgress(filled, totalNodes || 1);
  const stats = useMemo(() => diagnosticStats(data?.positions ?? []), [data?.positions]);

  const liveOffers = useMemo<DiagnosticLiveOffer[]>(() => {
    return (data?.positions ?? [])
      .filter((position) => position.status === "RED")
      .flatMap((position) => {
        const template = RED_NODE_OFFERS[position.node];
        if (!template) return [];
        const key = liveOfferKey(position.node, template.offerKey);
        const offer: DiagnosticLiveOffer = {
          key,
          node: position.node,
          offerKey: template.offerKey,
          nodeTitle: nodeTitle(position.node),
          title: template.title,
          variants: template.variants.map((variant) => ({
            label: variant.label,
            priceRub: variant.defaultPriceRub,
          })),
          decision: offerDecisions[key],
        };
        return [offer];
      });
  }, [data?.positions, offerDecisions]);

  const triggerQuickUiCommand = useCallback((command: QuickUiCommandInput) => {
    quickCommandSeq.current += 1;
    setQuickUiCommand({ ...command, nonce: quickCommandSeq.current });
  }, []);

  const markAllNormal = useCallback(async () => {
    if (!data) return;
    if (data.positions.length === 0) {
      setToast("Нет пунктов диагностики");
      return;
    }
    await Promise.all(
      data.positions.map((position) =>
        savePosition({
          block: position.block,
          node: position.node,
          status: "GREEN",
          tags: [],
          measurementValue: measurementValueForSave(position),
          measurementUnit: position.measurementUnit,
          recommendation: null,
          notes: null,
        })
      )
    );
    setToast("Все пункты отмечены нормой");
  }, [data, savePosition]);

  const markRemainingNormal = useCallback(async () => {
    if (!data) return;
    const remaining = data.positions.filter((position) => position.status === "NOT_CHECKED");
    if (remaining.length === 0) {
      setToast("Все пункты уже отмечены");
      return;
    }
    await Promise.all(
      remaining.map((position) =>
        savePosition({
          block: position.block,
          node: position.node,
          status: "GREEN",
          tags: position.tags,
          measurementValue: measurementValueForSave(position),
          measurementUnit: position.measurementUnit,
          recommendation: position.recommendation,
          notes: position.notes,
        })
      )
    );
    setToast("Оставшиеся пункты отмечены нормой");
  }, [data, savePosition]);

  const skipNotApplicable = useCallback(async () => {
    if (!data) return;
    const candidates = data.positions.filter(
      (position) => position.status === "NOT_CHECKED" && VEHICLE_DEPENDENT_NODE_CODES.has(position.node)
    );
    if (candidates.length === 0) {
      setToast("Нет неприменимых непроверенных пунктов");
      return;
    }
    await Promise.all(
      candidates.map((position) =>
        savePosition({
          block: position.block,
          node: position.node,
          status: "SKIPPED",
          tags: position.tags,
          measurementValue: measurementValueForSave(position),
          measurementUnit: position.measurementUnit,
          recommendation: position.recommendation,
          notes: position.notes?.trim() ? position.notes : "Неприменимо",
        })
      )
    );
    setToast("Неприменимые пункты пропущены");
  }, [data, savePosition]);

  useEffect(() => {
    if (!open) {
      setNav({ screen: "quick" });
      setQuickFilterMode("all");
      setQuickUiCommand(null);
      setOfferDecisions({});
      setReportUrl(null);
      setPositionSaveErrors({});
      setCrmReminderPositionIds([]);
      setCrmReminderLoading(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || isEditableHotkeyTarget(event.target)) return;
      if (nav.screen === "position") {
        event.preventDefault();
        setNav(nav.from === "block" ? { screen: "block", block: nav.block } : { screen: "quick" });
      } else if (nav.screen === "block" || nav.screen === "summary") {
        event.preventDefault();
        setNav({ screen: "quick" });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [nav, open]);

  const addOfferSelectionsToShipment = async (
    selections: { offerId: string; variantIndex: number }[],
    options?: { successMessage?: string }
  ): Promise<boolean> => {
    if (!activeId || !shipmentMoySkladId) {
      setToast("Нет привязанной отгрузки");
      return false;
    }
    if (selections.length === 0) {
      setToast("Отметьте офферы");
      return false;
    }
    const res = await fetch(`/api/diagnostic/${activeId}/add-offers-to-shipment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selections }),
    });
    const json = await responseJson<{ error?: string }>(res);
    if (!res.ok) {
      setToast(json.error ?? "Ошибка");
      return false;
    }
    setToast(options?.successMessage ?? "Позиции добавлены в отгрузку");
    await load();
    onAddedToShipment?.();
    return true;
  };

  const addOffersToShipment = async () => {
    const shipmentOfferIds = new Set((data?.offers ?? []).filter((offer) => !offer.nextVisitOnly).map((offer) => offer.id));
    const selections = Object.entries(selectedOffers)
      .filter(([offerId]) => shipmentOfferIds.has(offerId))
      .map(([offerId, variantIndex]) => ({
        offerId,
        variantIndex,
      }));
    if (Object.keys(selectedOffers).length > 0 && selections.length === 0) {
      setToast("Для отгрузки выберите офферы красной зоны");
      return;
    }
    const ok = await addOfferSelectionsToShipment(selections);
    if (ok) onClose();
  };

  const addLiveOfferToShipment = async (offer: DiagnosticLiveOffer, variantIndex: number) => {
    if (!data) return;
    try {
      const offers = await rebuildOffers();
      const position = data.positions.find((item) => item.node === offer.node);
      const createdOffer = offers.find(
        (item) =>
          !item.nextVisitOnly &&
          item.offerKey === offer.offerKey &&
          (!position || item.relatedPositionId === position.id)
      );
      if (!createdOffer) {
        setToast("Оффер для этой позиции не найден");
        return;
      }
      const ok = await addOfferSelectionsToShipment([{ offerId: createdOffer.id, variantIndex }], {
        successMessage: "Оффер добавлен в отгрузку",
      });
      if (ok) setOfferDecisions((prev) => ({ ...prev, [offer.key]: "added" }));
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Не удалось добавить оффер");
    }
  };

  if (!open) return null;

  const hubEditable = {
    licensePlate: data?.licensePlate ?? headerDraft.licensePlate,
    brand: data?.brand ?? headerDraft.brand,
    model: data?.model ?? headerDraft.model,
    year: data?.year != null ? String(data.year) : headerDraft.year,
    mileage: data?.mileage != null ? String(data.mileage) : headerDraft.mileage,
  };
  const vehicleTitle = [hubEditable.brand, hubEditable.model, hubEditable.year].filter(Boolean).join(" ") || "Автомобиль не указан";
  const mileageNumber = Number.parseInt(hubEditable.mileage.replace(/\D/g, ""), 10);
  const vehicleMeta = [
    hubEditable.licensePlate || "номер не указан",
    Number.isFinite(mileageNumber) ? `${mileageNumber.toLocaleString("ru-RU")} км` : "пробег не указан",
  ].join(" · ");
  const topbarSaveStatus: SaveStatus =
    saveStatus === "saving" ? "saving" : Object.keys(positionSaveErrors).length > 0 ? "error" : saveStatus;
  const detailedRows = sortDiagnosticRows(
    (data?.positions ?? []).map((position) => ({
      node: catalogNodeForPosition(position),
      position,
    }))
  );
  const preferredDetailRow =
    nav.screen === "position"
      ? detailedRows.find((row) => row.node.node === nav.node) ?? detailedRows[0]
      : nav.screen === "block"
        ? detailedRows.find((row) => row.node.block === nav.block) ?? detailedRows[0]
        : detailedRows[0];
  const diagnosticMode = nav.screen === "block" || nav.screen === "position" ? "detail" : "quick";
  const diagnosticTitle =
    nav.screen === "summary"
      ? "Сводка диагностики"
      : diagnosticMode === "detail"
        ? "Подробная диагностика"
        : "Быстрая диагностика";
  const openDetailedMode = () => {
    if (nav.screen === "position") return;
    if (!preferredDetailRow) {
      setToast("Нет активных пунктов для подробной проверки");
      return;
    }
    setNav({
      screen: "position",
      block: preferredDetailRow.node.block,
      node: preferredDetailRow.node.node,
      from: "quick",
    });
  };

  return (
    <div className="eco-diagnostic-overlay fixed inset-0 z-[100] flex flex-col bg-white dark:bg-zinc-950 md:items-center md:justify-center md:bg-black/50 md:p-4">
      <div className="eco-diagnostic-shell flex min-h-0 flex-1 flex-col overflow-hidden md:max-h-[95vh] md:rounded-xl md:border md:border-zinc-200 md:bg-white md:shadow-xl dark:md:border-zinc-700 dark:md:bg-zinc-900">
        <header className="eco-diagnostic-topbar flex shrink-0 items-center justify-between gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-700">
          <div className="eco-diagnostic-topbar-main">
            <div>
              <div className="eco-page-kicker">
                Диагностика · {diagnosticPointCountLabel(totalNodes)}
              </div>
              <div className="eco-diagnostic-title">{diagnosticTitle}</div>
            </div>
            <div className="eco-diagnostic-topbar-vehicle">
              <strong>{vehicleTitle}</strong>
              <span>{vehicleMeta}</span>
            </div>
          </div>
          <div className="eco-diagnostic-topbar-actions">
            <div className="eco-diagnostic-mode-toggle" role="group" aria-label="Режим диагностики">
              <button
                type="button"
                className={diagnosticMode === "quick" ? "is-active" : ""}
                aria-pressed={diagnosticMode === "quick"}
                onClick={() => setNav({ screen: "quick" })}
              >
                Быстро
              </button>
              <button
                type="button"
                className={diagnosticMode === "detail" ? "is-active" : ""}
                aria-pressed={diagnosticMode === "detail"}
                onClick={openDetailedMode}
              >
                Подробно
              </button>
            </div>
            <div className="eco-diagnostic-session">
              <span>Сессия</span>
              <b>{Math.floor(sessionSeconds / 60)}:{String(sessionSeconds % 60).padStart(2, "0")}</b>
            </div>
            <div className={`eco-diagnostic-save eco-diagnostic-save--${topbarSaveStatus}`}>
              {saveStatusLabel(topbarSaveStatus)}
            </div>
            <EcoButton type="button" onClick={onClose} size="sm">
              <X className="eco-icon" aria-hidden />
              Закрыть
            </EcoButton>
          </div>
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
          ) : nav.screen === "quick" ? (
            <div className="eco-diagnostic-workspace">
              <main className="eco-diagnostic-workspace-main">
                <QuickDiagnosticScreen
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
                  filterMode={quickFilterMode}
                  onFilterModeChange={setQuickFilterMode}
                  onVehicleHintsChange={applyVehicleHints}
                  uiCommand={quickUiCommand}
                  onOpenDetail={(block, node) => setNav({ screen: "position", block, node, from: "quick" })}
                  onOpenBlock={(block) => setNav({ screen: "block", block })}
                  onSave={savePosition}
                  saveErrors={positionSaveErrors}
                  onRetrySave={(payload) => void savePosition(payload)}
                  onPhoto={uploadPhotos}
                  onDeletePhoto={deletePhoto}
                  onVoice={() => setToast("В разработке")}
                  onToast={setToast}
                  canSummary={canSummary}
                  onSummary={() => void goSummary()}
                  liveOffers={liveOffers}
                  onAddLiveOffer={(offer, variantIndex) => void addLiveOfferToShipment(offer, variantIndex)}
                  onSetOfferDecision={(offerKey, decision) =>
                    setOfferDecisions((prev) => ({ ...prev, [offerKey]: decision }))
                  }
                  crmReminderPositionIds={crmReminderPositionIds}
                  crmReminderLoading={crmReminderLoading}
                  onCreateReminders={(positionIds) => void createCrmReminders(positionIds)}
                />
              </main>
              <DiagnosticSidebar
                stats={stats}
                canSummary={canSummary}
                liveOffers={liveOffers}
                reportUrl={reportUrl}
                reportActionsDisabled={data?.status !== "COMPLETED"}
                quickActions={{
                  filterMode: quickFilterMode,
                  onFilterModeChange: setQuickFilterMode,
                  onMarkAllNormal: () => void markAllNormal(),
                  onMarkRemainingNormal: () => void markRemainingNormal(),
                  onSkipNotApplicable: () => void skipNotApplicable(),
                  onNextUnchecked: () => triggerQuickUiCommand({ type: "next_unchecked" }),
                  onCollapseAll: () => triggerQuickUiCommand({ type: "collapse_all" }),
                  onExpandProblematic: () => triggerQuickUiCommand({ type: "expand_problematic" }),
                  onAddMissingPhoto: (node) => triggerQuickUiCommand({ type: "open_photo_node", node }),
                  onAddMissingRecommendation: (node) => triggerQuickUiCommand({ type: "open_node", node }),
                }}
                onAddLiveOffer={(offer, variantIndex) => void addLiveOfferToShipment(offer, variantIndex)}
                onSetOfferDecision={(offerKey, decision) =>
                  setOfferDecisions((prev) => ({ ...prev, [offerKey]: decision }))
                }
                onSummary={() => void goSummary()}
                onComplete={() => void completeDiagnostic()}
                onCopyReportLink={() => void copyReportLink()}
                onOpenReport={() => void openClientReport()}
                onPrintReport={() => void printClientReport()}
              />
              <DiagnosticMobileActionBar
                stats={stats}
                canSummary={canSummary}
                liveOffers={liveOffers}
                reportUrl={reportUrl}
                reportActionsDisabled={data?.status !== "COMPLETED"}
                quickActions={{
                  filterMode: quickFilterMode,
                  onFilterModeChange: setQuickFilterMode,
                  onMarkAllNormal: () => void markAllNormal(),
                  onMarkRemainingNormal: () => void markRemainingNormal(),
                  onSkipNotApplicable: () => void skipNotApplicable(),
                  onNextUnchecked: () => triggerQuickUiCommand({ type: "next_unchecked" }),
                  onCollapseAll: () => triggerQuickUiCommand({ type: "collapse_all" }),
                  onExpandProblematic: () => triggerQuickUiCommand({ type: "expand_problematic" }),
                  onAddMissingPhoto: (node) => triggerQuickUiCommand({ type: "open_photo_node", node }),
                  onAddMissingRecommendation: (node) => triggerQuickUiCommand({ type: "open_node", node }),
                }}
                onAddLiveOffer={(offer, variantIndex) => void addLiveOfferToShipment(offer, variantIndex)}
                onSetOfferDecision={(offerKey, decision) =>
                  setOfferDecisions((prev) => ({ ...prev, [offerKey]: decision }))
                }
                onSummary={() => void goSummary()}
                onComplete={() => void completeDiagnostic()}
                onCopyReportLink={() => void copyReportLink()}
                onOpenReport={() => void openClientReport()}
                onPrintReport={() => void printClientReport()}
              />
            </div>
          ) : nav.screen === "block" ? (
            <BlockScreen
              block={nav.block}
              positions={data?.positions ?? []}
              onPickNode={(node) => setNav({ screen: "position", block: nav.block, node, from: "block" })}
              onBack={() => setNav({ screen: "quick" })}
            />
          ) : nav.screen === "position" ? (
            <PositionScreen
              block={nav.block}
              node={nav.node}
              position={data?.positions.find((p) => p.node === nav.node)}
              tags={NODE_TAGS[nav.node] ?? []}
              recPresets={RECOMMENDATION_PRESETS[nav.node] ?? RECOMMENDATION_PRESETS.default}
              onBack={() => setNav(nav.from === "block" ? { screen: "block", block: nav.block } : { screen: "quick" })}
              onSave={savePosition}
              onPhoto={(file) => uploadPhotos(nav.node, [file])}
              onVoice={() => setToast("В разработке")}
            />
          ) : (
            <SummaryScreen
              data={data}
              selectedOffers={selectedOffers}
              setSelectedOffers={setSelectedOffers}
              reportUrl={reportUrl}
              reportActionsDisabled={data?.status !== "COMPLETED"}
              crmReminderPositionIds={crmReminderPositionIds}
              crmReminderLoading={crmReminderLoading}
              onBack={() => setNav({ screen: "quick" })}
              onAddShipment={addOffersToShipment}
              onCreateReminders={(positionIds) => void createCrmReminders(positionIds)}
              onCopyReportLink={copyReportLink}
              onOpenReport={openClientReport}
              onPrintReport={printClientReport}
              onSendReportLater={() => setToast("Ссылку отчёта можно скопировать позже из сводки")}
              onComplete={completeDiagnostic}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function QuickDiagnosticScreen(props: {
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
  filterMode: QuickFilterMode;
  onFilterModeChange: (mode: QuickFilterMode) => void;
  onVehicleHintsChange: (vehicleHints: VehicleHints) => Promise<void>;
  uiCommand: QuickUiCommand | null;
  onOpenDetail: (block: DiagnosticBlockCode, node: string) => void;
  onOpenBlock: (b: DiagnosticBlockCode) => void;
  onSave: (payload: DiagnosticPositionSavePayload) => Promise<void>;
  saveErrors: Record<string, DiagnosticPositionSaveError>;
  onRetrySave: (payload: DiagnosticPositionSavePayload) => void;
  onPhoto: (node: string, files: File[], onProgress?: PhotoUploadProgress) => Promise<void>;
  onDeletePhoto: (photoId: string) => Promise<void>;
  onVoice: () => void;
  onToast: (message: string) => void;
  canSummary: boolean;
  onSummary: () => void;
  liveOffers: DiagnosticLiveOffer[];
  onAddLiveOffer: (offer: DiagnosticLiveOffer, variantIndex: number) => void;
  onSetOfferDecision: (key: string, decision: OfferDecision) => void;
  crmReminderPositionIds: string[];
  crmReminderLoading: boolean;
  onCreateReminders: (positionIds?: string[]) => void;
}) {
  const [history, setHistory] = useState<DiagnosticHistory | null>(null);
  const [collapsedBlocks, setCollapsedBlocks] = useState<DiagnosticBlockCode[]>([]);
  const [detailCommand, setDetailCommand] = useState<QuickDetailCommand | null>(null);
  const [activeNode, setActiveNode] = useState<string | null>(null);
  const [targetNode, setTargetNode] = useState<string | null>(null);
  const handledCommand = useRef<number | null>(null);
  const detailCommandSeq = useRef(0);
  const lastUncheckedNode = useRef<string | null>(null);
  const uiCommand = props.uiCommand;
  const onToast = props.onToast;
  const canSummary = props.canSummary;
  const onSummary = props.onSummary;
  const onSave = props.onSave;
  const onVehicleHintsChange = props.onVehicleHintsChange;
  const inferredGearboxChoice = useMemo<GearboxChoice>(() => {
    const hasAtf = props.positions.some((position) => position.node === "atf");
    const hasManual = props.positions.some((position) => position.node === "mtf");
    if (hasAtf && !hasManual) return "atf";
    if (hasManual && !hasAtf) return "manual";
    return "unknown";
  }, [props.positions]);
  const inferredDriveChoice = useMemo<DriveChoice>(() => {
    return props.positions.some(
      (position) => position.node === "front_diff" || position.node === "rear_diff" || position.node === "transfer_case"
    )
      ? "awd"
      : "unknown";
  }, [props.positions]);
  const fuelHints = useMemo(() => fuelHintsFromPositions(props.positions), [props.positions]);
  const [gearboxChoice, setGearboxChoice] = useState<GearboxChoice>(inferredGearboxChoice);
  const [driveChoice, setDriveChoice] = useState<DriveChoice>(inferredDriveChoice);

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

  useEffect(() => {
    setGearboxChoice(inferredGearboxChoice);
  }, [inferredGearboxChoice]);

  useEffect(() => {
    if (inferredDriveChoice === "awd") setDriveChoice("awd");
  }, [inferredDriveChoice]);

  const orderedRows = useMemo(() => {
    return sortDiagnosticRows(
      props.positions.map((position) => ({
        node: catalogNodeForPosition(position),
        position,
      }))
    );
  }, [props.positions]);

  const filteredRows = useMemo(() => {
    if (props.filterMode === "issues") {
      return orderedRows.filter((row) => isProblemPosition(row.position));
    }
    if (props.filterMode === "missingPhotos") {
      return orderedRows.filter((row) => isMissingPhotoPosition(row.position));
    }
    return orderedRows;
  }, [orderedRows, props.filterMode]);

  const visibleRows = useMemo(
    () => filteredRows.filter((row) => !collapsedBlocks.includes(row.node.block)),
    [collapsedBlocks, filteredRows]
  );

  const total = orderedRows.length;
  const filled = props.positions.filter((p) => p.status !== "NOT_CHECKED").length;
  const progress = total ? Math.round((filled / total) * 100) : 0;
  const counts = summaryCounts(props.positions);
  const skipped = props.positions.filter((p) => p.status === "SKIPPED").length;
  const historyCount = (history?.demands?.length ?? 0) + (history?.diagnostics?.length ?? 0);
  const toggleBlock = (block: DiagnosticBlockCode) => {
    setCollapsedBlocks((prev) => (prev.includes(block) ? prev.filter((item) => item !== block) : [...prev, block]));
  };

  const pushDetailCommand = useCallback((command: QuickDetailCommandInput) => {
    detailCommandSeq.current += 1;
    setDetailCommand({ ...command, nonce: detailCommandSeq.current } as QuickDetailCommand);
  }, []);

  const applyVehicleChoices = useCallback(
    (nextGearbox: GearboxChoice, nextDrive: DriveChoice) => {
      setGearboxChoice(nextGearbox);
      setDriveChoice(nextDrive);
      void onVehicleHintsChange(vehicleHintsFromQuickChoices(nextGearbox, nextDrive, fuelHints));
    },
    [fuelHints, onVehicleHintsChange]
  );

  const focusDiagnosticRow = useCallback((row: { node: CatalogNode; position: DiagnosticPositionRow }) => {
    lastUncheckedNode.current = row.node.node;
    window.setTimeout(() => {
      setCollapsedBlocks((prev) => prev.filter((block) => block !== row.node.block));
      setActiveNode(row.node.node);
      setTargetNode(row.node.node);
    }, 0);
    window.setTimeout(() => {
      const element = document.getElementById(quickRowDomId(row.node.node));
      element?.scrollIntoView({ block: "center", behavior: "smooth" });
      element?.focus({ preventScroll: true });
    }, 80);
    window.setTimeout(() => {
      setTargetNode((current) => (current === row.node.node ? null : current));
    }, 1800);
  }, []);

  const goNextUnchecked = useCallback(() => {
    const uncheckedRows = orderedRows.filter((row) => row.position.status === "NOT_CHECKED");
    if (uncheckedRows.length === 0) {
      onToast("Непроверенных пунктов нет");
      return;
    }

    const currentIndex = lastUncheckedNode.current
      ? uncheckedRows.findIndex((row) => row.node.node === lastUncheckedNode.current)
      : -1;
    const nextRow = uncheckedRows[(currentIndex + 1) % uncheckedRows.length] ?? uncheckedRows[0];
    focusDiagnosticRow(nextRow);
  }, [focusDiagnosticRow, onToast, orderedRows]);

  const resolveHotkeyRow = useCallback(() => {
    const activeElement = document.activeElement as HTMLElement | null;
    const focusedNode = activeElement?.closest("[data-diagnostic-node]")?.getAttribute("data-diagnostic-node");
    const preferredNode = focusedNode ?? activeNode ?? targetNode ?? lastUncheckedNode.current;
    const visiblePreferred = preferredNode
      ? visibleRows.find((row) => row.node.node === preferredNode)
      : undefined;
    if (visiblePreferred) return visiblePreferred;

    const filteredPreferred = preferredNode
      ? filteredRows.find((row) => row.node.node === preferredNode)
      : undefined;
    if (filteredPreferred) return filteredPreferred;

    return filteredRows.find((row) => row.position.status === "NOT_CHECKED") ?? filteredRows[0] ?? orderedRows[0] ?? null;
  }, [activeNode, filteredRows, orderedRows, targetNode, visibleRows]);

  const applyHotkeyStatus = useCallback(
    (status: DiagnosticPositionStatus) => {
      const row = resolveHotkeyRow();
      if (!row) {
        onToast("Нет строки для быстрого ввода");
        return;
      }
      const shouldOpen = status === "YELLOW" || status === "RED" || status === "SKIPPED";
      focusDiagnosticRow(row);
      pushDetailCommand({ type: shouldOpen ? "open_node" : "collapse_node", node: row.node.node });
      void onSave({
        block: row.position.block,
        node: row.node.node,
        status,
        tags: row.position.tags,
        measurementValue: measurementValueForSave(row.position),
        measurementUnit: row.position.measurementUnit,
        recommendation: row.position.recommendation,
        notes: row.position.notes,
      });
    },
    [focusDiagnosticRow, onSave, onToast, pushDetailCommand, resolveHotkeyRow]
  );

  const openPhotoForHotkeyRow = useCallback(() => {
    const row = resolveHotkeyRow();
    if (!row) {
      onToast("Нет строки для фото");
      return;
    }
    if (!isProblemPosition(row.position)) {
      onToast("Фото добавляется для статусов Внимание или Замена");
      return;
    }
    focusDiagnosticRow(row);
    pushDetailCommand({ type: "open_node", node: row.node.node });
    window.setTimeout(() => {
      const input = document.getElementById(quickPhotoInputId(row.node.node)) as HTMLInputElement | null;
      input?.click();
    }, 140);
  }, [focusDiagnosticRow, onToast, pushDetailCommand, resolveHotkeyRow]);

  useEffect(() => {
    if (!uiCommand || handledCommand.current === uiCommand.nonce) return;
    handledCommand.current = uiCommand.nonce;

    if (uiCommand.type === "open_photo_node" || uiCommand.type === "open_node") {
      const row = orderedRows.find((item) => item.node.node === uiCommand.node);
      if (!row) {
        onToast("Пункт не найден");
        return;
      }
      focusDiagnosticRow(row);
      window.setTimeout(() => {
        pushDetailCommand({ type: "open_node", node: row.node.node });
      }, 120);
      return;
    }

    if (uiCommand.type === "collapse_all") {
      window.setTimeout(() => {
        setCollapsedBlocks(BLOCK_ORDER);
        pushDetailCommand({ type: "collapse_all" });
      }, 0);
      onToast("Все блоки свернуты");
      return;
    }

    if (uiCommand.type === "expand_problematic") {
      const problemBlocks = new Set(
        orderedRows.filter((row) => isProblemPosition(row.position)).map((row) => row.node.block)
      );
      if (problemBlocks.size === 0) {
        onToast("Проблемных пунктов нет");
      } else {
        window.setTimeout(() => {
          setCollapsedBlocks((prev) => prev.filter((block) => !problemBlocks.has(block)));
        }, 0);
        onToast("Проблемные пункты развернуты");
      }
      window.setTimeout(() => {
        pushDetailCommand({ type: "expand_problematic" });
      }, 0);
      return;
    }

    goNextUnchecked();
  }, [focusDiagnosticRow, goNextUnchecked, onToast, orderedRows, pushDetailCommand, uiCommand]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!shouldUseDiagnosticHotkeys() || isEditableHotkeyTarget(event.target) || event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }

      const quickStatus = HOTKEY_STATUS_MAP[event.key];
      if (quickStatus) {
        event.preventDefault();
        applyHotkeyStatus(quickStatus);
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        goNextUnchecked();
        return;
      }

      if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        openPhotoForHotkeyRow();
        return;
      }

      if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (canSummary) onSummary();
        else onToast("Для сводки нужно заполнить минимум половину диагностики");
        return;
      }

      if (event.key === "Escape") {
        const row = resolveHotkeyRow();
        if (!row) return;
        event.preventDefault();
        pushDetailCommand({ type: "collapse_node", node: row.node.node });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    applyHotkeyStatus,
    canSummary,
    goNextUnchecked,
    onSummary,
    onToast,
    openPhotoForHotkeyRow,
    pushDetailCommand,
    resolveHotkeyRow,
  ]);

  return (
    <div className="eco-diagnostic-hub eco-diagnostic-quick">
      <section className="eco-card eco-card--padded eco-diagnostic-vehicle eco-diagnostic-quick-vehicle">
        <div className="eco-diagnostic-quick-vehicle-head">
          <div>
            <div className="eco-page-kicker">Автомобиль</div>
            <h3>Карточка диагностики</h3>
          </div>
          <EcoBadge tone={filled >= total ? "success" : "warning"} dot>
            {filled} / {total}
          </EcoBadge>
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

      <section className="eco-diagnostic-vehicle-hints" aria-label="Параметры автомобиля для диагностики">
        <div className="eco-diagnostic-vehicle-hint-group">
          <span>Коробка</span>
          <div className="eco-diagnostic-segmented">
            {([
              ["atf", "АКПП"],
              ["manual", "МКПП"],
              ["unknown", "Не знаю"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={gearboxChoice === value ? "is-active" : ""}
                onClick={() => applyVehicleChoices(value, driveChoice)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="eco-diagnostic-vehicle-hint-group">
          <span>Привод</span>
          <div className="eco-diagnostic-segmented">
            {([
              ["front", "Передний"],
              ["rear", "Задний"],
              ["awd", "Полный"],
              ["unknown", "Не знаю"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={driveChoice === value ? "is-active" : ""}
                onClick={() => applyVehicleChoices(gearboxChoice, value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="eco-diagnostic-quick-progress" aria-label="Прогресс диагностики">
        <div className="eco-diagnostic-quick-progress-head">
          <div>
            <div className="eco-page-kicker">Прогресс</div>
            <strong>{progress}% заполнено</strong>
          </div>
          <span>
            {counts.summaryGreen} норма · {counts.summaryYellow} внимание · {counts.summaryRed} замена
            {skipped > 0 ? ` · ${skipped} пропущено` : ""}
          </span>
        </div>
        <i aria-hidden>
          <em style={{ width: `${progress}%` }} />
        </i>
      </section>

      <div className="eco-diagnostic-hotkey-hint" aria-label="Быстрый ввод">
        <span>Быстрый ввод:</span>
        <kbd>1</kbd> Норма · <kbd>2</kbd> Внимание · <kbd>3</kbd> Замена · <kbd>Enter</kbd> следующий
        <small>
          <kbd>4</kbd> пропустить · <kbd>F</kbd> фото · <kbd>S</kbd> сводка · <kbd>Esc</kbd> закрыть детали
        </small>
      </div>

      {history &&
        historyCount > 0 && (
        <details className="eco-diagnostic-history">
          <summary>
            <span>Обзор</span>
            <b>{historyRecordCountLabel(historyCount)}</b>
          </summary>
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
        </details>
      )}

      <div className="eco-diagnostic-quick-list">
        {props.filterMode !== "all" && (
          <div className="eco-diagnostic-quick-filter-note">
            <span>
              {props.filterMode === "issues" ? "Показаны только Внимание / Замена" : "Показаны только проблемы без фото"}
            </span>
            <button type="button" onClick={() => props.onFilterModeChange("all")}>
              Показать все
            </button>
          </div>
        )}
        {filteredRows.length === 0 && (
          <div className="eco-diagnostic-quick-empty">
            {props.filterMode === "issues"
              ? "Проблемных пунктов пока нет"
              : props.filterMode === "missingPhotos"
                ? "Проблем без фото нет"
                : "Пункты диагностики не найдены"}
          </div>
        )}
        {BLOCK_ORDER.map((block) => {
          const blockRows = orderedRows.filter((row) => row.node.block === block);
          const rows = filteredRows.filter((row) => row.node.block === block);
          const done = blockRows.filter((row) => row.position.status !== "NOT_CHECKED").length;
          const isCollapsed = collapsedBlocks.includes(block);
          if (blockRows.length === 0 || rows.length === 0) return null;
          return (
            <section key={block} className={`eco-diagnostic-quick-block ${isCollapsed ? "is-collapsed" : ""}`}>
              <div className="eco-diagnostic-quick-block-head">
                <div>
                  <Wrench className="eco-icon" aria-hidden />
                  <strong>{BLOCK_TITLES[block]}</strong>
                </div>
                <div className="eco-diagnostic-quick-block-tools">
                  <button type="button" onClick={() => toggleBlock(block)}>
                    {isCollapsed ? "Развернуть" : "Свернуть"}
                  </button>
                  <button type="button" onClick={() => props.onOpenBlock(block)}>
                    Подробно
                  </button>
                </div>
                <span>
                  {done} / {blockRows.length}
                </span>
              </div>
              {!isCollapsed && (
                <div className="eco-diagnostic-quick-rows">
                  {rows.map((row) => (
                    <QuickDiagnosticRow
                      key={`${row.node.node}-${row.position.id}`}
                      block={block}
                      node={row.node}
                      position={row.position}
                      tags={NODE_TAGS[row.node.node] ?? []}
                      recPresets={RECOMMENDATION_PRESETS[row.node.node] ?? RECOMMENDATION_PRESETS.default}
                      onSave={props.onSave}
                      saveError={props.saveErrors[row.node.node]}
                      onRetrySave={props.onRetrySave}
                      onPhoto={props.onPhoto}
                      onDeletePhoto={props.onDeletePhoto}
                      onVoice={props.onVoice}
                      onOpenDetail={() => props.onOpenDetail(block, row.node.node)}
                      detailCommand={detailCommand}
                      isTarget={targetNode === row.node.node || activeNode === row.node.node}
                      onActivate={() => setActiveNode(row.node.node)}
                      liveOffer={props.liveOffers.find((offer) => offer.node === row.node.node)}
                      onAddLiveOffer={props.onAddLiveOffer}
                      onSetOfferDecision={props.onSetOfferDecision}
                      crmReminderCreated={props.crmReminderPositionIds.includes(row.position.id)}
                      crmReminderLoading={props.crmReminderLoading}
                      onCreateReminder={() => props.onCreateReminders([row.position.id])}
                    />
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>

    </div>
  );
}

function DiagnosticSidebar(props: DiagnosticActionPanelProps) {
  return (
    <aside className="eco-diagnostic-sidebar" aria-label="Сводка диагностики">
      <DiagnosticActionPanel {...props} />
    </aside>
  );
}

function DiagnosticMobileActionBar(props: DiagnosticActionPanelProps) {
  return (
    <div className="eco-diagnostic-mobile-actions" aria-label="Действия диагностики">
      <DiagnosticActionPanel {...props} compact />
    </div>
  );
}

function DiagnosticActionPanel(props: DiagnosticActionPanelProps) {
  const remaining = Math.max(0, props.stats.total - props.stats.filled);
  const progress = props.stats.total ? Math.round((props.stats.filled / props.stats.total) * 100) : 0;
  const hasMissingPhotos = props.stats.missingPhoto.length > 0;
  const hasMissingRecommendations = props.stats.missingRecommendation.length > 0;
  const allNormal = props.stats.total > 0 && props.stats.summaryGreen === props.stats.total;
  const [liveOfferVariants, setLiveOfferVariants] = useState<Record<string, number>>({});
  const visibleLiveOffers = props.liveOffers.filter((offer) => offer.decision !== "ignored");
  const pendingLiveOffers = visibleLiveOffers.filter((offer) => !offer.decision || offer.decision === "later");
  const missingIssueSummary = [
    hasMissingPhotos
      ? `Без фото: ${props.stats.missingPhoto.length} ${problematicPointLabel(props.stats.missingPhoto.length)}`
      : "",
    hasMissingRecommendations ? `Без рекомендаций: ${props.stats.missingRecommendation.length}` : "",
  ].filter(Boolean);

  return (
    <div className={`eco-diagnostic-action-panel ${props.compact ? "is-compact" : ""}`}>
      <section className="eco-diagnostic-side-progress">
        <div className="eco-page-kicker">Сводка</div>
        <strong>
          Проверено {props.stats.filled} из {props.stats.total}
        </strong>
        <i aria-hidden>
          <em style={{ width: `${progress}%` }} />
        </i>
      </section>

      <section className="eco-diagnostic-side-counts" aria-label="Статусы">
        <span className="is-green">
          <b>{props.stats.summaryGreen}</b>
          Норма
        </span>
        <span className="is-yellow">
          <b>{props.stats.summaryYellow}</b>
          Внимание
        </span>
        <span className="is-red">
          <b>{props.stats.summaryRed}</b>
          Замена
        </span>
        <span>
          <b>{props.stats.skipped}</b>
          Пропущено
        </span>
      </section>

      {props.compact && missingIssueSummary.length > 0 && (
        <section className="eco-diagnostic-compact-alert" role="status" aria-live="polite">
          <strong>{missingIssueSummary.join(" · ")}</strong>
        </section>
      )}

      {!props.compact && (
        <section className={`eco-diagnostic-photo-alert ${hasMissingPhotos ? "has-missing" : ""}`}>
          <div>
            <div className="eco-page-kicker">Проблемы перед завершением</div>
            <strong>{missingIssueSummary.length > 0 ? missingIssueSummary.join(" · ") : "Фото и рекомендации готовы"}</strong>
            <span>
              {hasMissingPhotos || hasMissingRecommendations
                ? "Клик по действию раскроет нужную строку"
                : "У желтых и красных пунктов есть фото и рекомендации"}
            </span>
          </div>
          {(hasMissingPhotos || hasMissingRecommendations) && (
            <ul className="eco-diagnostic-photo-missing-list">
              {props.stats.missingPhoto.map((position) => (
                <li key={position.id}>
                  <span>{nodeTitle(position.node)} — нет фото</span>
                  <button type="button" onClick={() => props.quickActions.onAddMissingPhoto(position.node)}>
                    <Camera className="eco-icon" aria-hidden />
                    Добавить фото
                  </button>
                </li>
              ))}
              {props.stats.missingRecommendation.map((position) => (
                <li key={`rec-${position.id}`}>
                  <span>{nodeTitle(position.node)} — нет рекомендации</span>
                  <button type="button" onClick={() => props.quickActions.onAddMissingRecommendation(position.node)}>
                    <FileText className="eco-icon" aria-hidden />
                    Добавить
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {!props.compact && (
        <section className="eco-diagnostic-live-offers" aria-label="Офферы к добавлению">
          <div>
            <div className="eco-page-kicker">Офферы к добавлению</div>
            <strong>{pendingLiveOffers.length > 0 ? `${pendingLiveOffers.length} предлож.` : "Нет новых офферов"}</strong>
            <span>
              {pendingLiveOffers.length > 0
                ? "Появляются сразу по красным пунктам"
                : "Красные пункты с шаблонами появятся здесь"}
            </span>
          </div>

          {visibleLiveOffers.length > 0 && (
            <ul>
              {visibleLiveOffers.map((offer) => {
                const variantIndex = liveOfferVariants[offer.key] ?? 0;
                const variant = offer.variants[variantIndex] ?? offer.variants[0];
                return (
                  <li key={offer.key} className={`is-${offer.decision ?? "pending"}`}>
                    <div>
                      <b>{offer.title}</b>
                      <span>{offer.nodeTitle}</span>
                    </div>
                    {offer.variants.length > 1 ? (
                      <select
                        className="eco-input"
                        value={variantIndex}
                        onChange={(event) =>
                          setLiveOfferVariants((prev) => ({ ...prev, [offer.key]: Number(event.target.value) }))
                        }
                      >
                        {offer.variants.map((item, index) => (
                          <option key={item.label} value={index}>
                            {item.label} · {item.priceRub.toLocaleString("ru-RU")} ₽
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="eco-diagnostic-live-offer-price">
                        {variant?.label ?? offer.title} · {(variant?.priceRub ?? 0).toLocaleString("ru-RU")} ₽
                      </span>
                    )}
                    {offer.decision === "added" ? (
                      <em>Добавлено в отгрузку</em>
                    ) : (
                      <div className="eco-diagnostic-live-offer-actions">
                        <button type="button" onClick={() => props.onAddLiveOffer(offer, variantIndex)}>
                          <ClipboardCheck className="eco-icon" aria-hidden />
                          Добавить в отгрузку
                        </button>
                        <button type="button" onClick={() => props.onSetOfferDecision(offer.key, "later")}>
                          Добавить позже
                        </button>
                        <button type="button" onClick={() => props.onSetOfferDecision(offer.key, "ignored")}>
                          Не предлагать
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {!props.compact && (
        <section className="eco-diagnostic-report-link" aria-label="Ссылка отчёта">
          <div className="eco-page-kicker">Ссылка отчёта</div>
          {props.reportUrl ? (
            <a href={props.reportUrl} target="_blank" rel="noreferrer">
              {props.reportUrl}
            </a>
          ) : (
            <span>Будет создана после завершения диагностики</span>
          )}
        </section>
      )}

      <section className="eco-diagnostic-fast-actions" aria-label="Быстрые действия">
        <div className="eco-page-kicker">Быстрые действия</div>
        <div>
          <button type="button" onClick={props.quickActions.onMarkAllNormal} disabled={allNormal}>
            <CheckCheck className="eco-icon" aria-hidden />
            <span>Отметить всё нормой</span>
          </button>
          <button type="button" onClick={props.quickActions.onMarkRemainingNormal} disabled={remaining === 0}>
            <CheckCircle2 className="eco-icon" aria-hidden />
            <span>Оставшиеся нормой</span>
          </button>
          <button
            type="button"
            onClick={props.quickActions.onSkipNotApplicable}
            disabled={props.stats.notApplicableCandidates === 0}
          >
            <XCircle className="eco-icon" aria-hidden />
            <span>Пропустить неприменимые</span>
          </button>
          <button type="button" onClick={props.quickActions.onNextUnchecked} disabled={props.stats.unchecked === 0}>
            <SkipForward className="eco-icon" aria-hidden />
            <span>Следующий непроверенный</span>
          </button>
          <button type="button" onClick={props.quickActions.onCollapseAll}>
            <Minimize2 className="eco-icon" aria-hidden />
            <span>Свернуть все</span>
          </button>
          <button type="button" onClick={props.quickActions.onExpandProblematic}>
            <Maximize2 className="eco-icon" aria-hidden />
            <span>Развернуть проблемные</span>
          </button>
        </div>
      </section>

      <section className="eco-diagnostic-filter-actions" aria-label="Фильтр чек-листа">
        <div className="eco-page-kicker">Показать</div>
        <div>
          <button
            type="button"
            onClick={() => props.quickActions.onFilterModeChange("all")}
            className={props.quickActions.filterMode === "all" ? "is-active" : ""}
          >
            <ListChecks className="eco-icon" aria-hidden />
            <span>Все пункты</span>
          </button>
          <button
            type="button"
            onClick={() =>
              props.quickActions.onFilterModeChange(props.quickActions.filterMode === "issues" ? "all" : "issues")
            }
            className={props.quickActions.filterMode === "issues" ? "is-active" : ""}
          >
            <Eye className="eco-icon" aria-hidden />
            <span>Только Внимание / Замена</span>
          </button>
          <button
            type="button"
            onClick={() =>
              props.quickActions.onFilterModeChange(
                props.quickActions.filterMode === "missingPhotos" ? "all" : "missingPhotos"
              )
            }
            className={props.quickActions.filterMode === "missingPhotos" ? "is-active" : ""}
          >
            <ImageOff className="eco-icon" aria-hidden />
            <span>Только без фото</span>
          </button>
        </div>
      </section>

      <div className="eco-diagnostic-side-actions">
        <EcoButton type="button" onClick={props.onSummary} disabled={!props.canSummary} variant="primary">
          <FileText className="eco-icon" aria-hidden />
          К сводке
        </EcoButton>
        <EcoButton type="button" onClick={props.onComplete} disabled={hasMissingPhotos} variant="danger">
          <CheckCircle2 className="eco-icon" aria-hidden />
          Завершить
        </EcoButton>
        <EcoButton
          type="button"
          onClick={props.onOpenReport}
          disabled={props.reportActionsDisabled}
          title={props.reportActionsDisabled ? "Завершите диагностику перед открытием отчёта" : undefined}
        >
          <Eye className="eco-icon" aria-hidden />
          Открыть отчёт
        </EcoButton>
        <EcoButton
          type="button"
          onClick={props.onPrintReport}
          disabled={props.reportActionsDisabled}
          title={props.reportActionsDisabled ? "Завершите диагностику перед печатью" : undefined}
        >
          <FileText className="eco-icon" aria-hidden />
          Печать отчёта
        </EcoButton>
        <EcoButton
          type="button"
          onClick={props.onCopyReportLink}
          disabled={props.reportActionsDisabled}
          title={props.reportActionsDisabled ? "Завершите диагностику перед копированием ссылки" : undefined}
        >
          <ClipboardCheck className="eco-icon" aria-hidden />
          Скопировать ссылку отчёта
        </EcoButton>
      </div>
    </div>
  );
}

function DiagnosticTagPicker(props: {
  tags: TagDef[];
  selectedTags: string[];
  onChange: (nextTags: string[]) => void;
}) {
  const toggleTag = (code: string) => {
    props.onChange(
      props.selectedTags.includes(code)
        ? props.selectedTags.filter((selectedCode) => selectedCode !== code)
        : [...props.selectedTags, code]
    );
  };
  const renderTag = (tag: TagDef) => (
    <button
      key={tag.code}
      type="button"
      onClick={() => toggleTag(tag.code)}
      className={`eco-diagnostic-tag ${props.selectedTags.includes(tag.code) ? "is-active" : ""}`}
    >
      {tag.label}
    </button>
  );
  const visibleTags = props.tags.slice(0, TAG_CHIP_VISIBLE_LIMIT);
  const hiddenTags = props.tags.slice(TAG_CHIP_VISIBLE_LIMIT);

  return (
    <div className="eco-diagnostic-tags">
      {visibleTags.map(renderTag)}
      {hiddenTags.length > 0 && (
        <details className="eco-diagnostic-tags-more">
          <summary>Ещё {hiddenTags.length}</summary>
          <div>{hiddenTags.map(renderTag)}</div>
        </details>
      )}
    </div>
  );
}

function QuickDiagnosticRow(props: {
  block: DiagnosticBlockCode;
  node: CatalogNode;
  position: DiagnosticPositionRow;
  tags: TagDef[];
  recPresets: string[];
  onSave: (payload: DiagnosticPositionSavePayload) => Promise<void>;
  saveError?: DiagnosticPositionSaveError;
  onRetrySave: (payload: DiagnosticPositionSavePayload) => void;
  onPhoto: (node: string, files: File[], onProgress?: PhotoUploadProgress) => Promise<void>;
  onDeletePhoto: (photoId: string) => Promise<void>;
  onVoice: () => void;
  onOpenDetail: () => void;
  detailCommand: QuickDetailCommand | null;
  isTarget: boolean;
  onActivate: () => void;
  liveOffer?: DiagnosticLiveOffer;
  onAddLiveOffer: (offer: DiagnosticLiveOffer, variantIndex: number) => void;
  onSetOfferDecision: (key: string, decision: OfferDecision) => void;
  crmReminderCreated: boolean;
  crmReminderLoading: boolean;
  onCreateReminder: () => void;
}) {
  const measurement = props.node.measurement;
  const status = props.position.status;
  const [detailsOpen, setDetailsOpen] = useState(
    status === "YELLOW" || status === "RED" || (status === "SKIPPED" && Boolean(props.position.notes?.trim()))
  );
  const [tags, setTags] = useState<string[]>(props.position.tags ?? []);
  const [rec, setRec] = useState(props.position.recommendation ?? "");
  const [note, setNote] = useState(props.position.notes ?? "");
  const [meas, setMeas] = useState<string>(
    props.position.measurementValue != null ? String(props.position.measurementValue) : ""
  );
  const [photoProgress, setPhotoProgress] = useState<number | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [failedPhotoFiles, setFailedPhotoFiles] = useState<File[] | null>(null);
  const [deletingPhotoId, setDeletingPhotoId] = useState<string | null>(null);
  const [inlineOfferVariant, setInlineOfferVariant] = useState(0);
  const handledDetailCommand = useRef<number | null>(null);
  const measurementSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recommendationSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const detailCommand = props.detailCommand;

  const parseMeasurement = (rawValue = meas) => {
    if (!measurement || rawValue.trim() === "") return null;
    const value = Number.parseFloat(rawValue.replace(",", "."));
    return Number.isFinite(value) ? value : null;
  };

  const measurementUnit = measurement === "brake_fluid" ? "%" : measurement === "coolant" ? "°C" : null;
  const measurementLabel = measurement === "brake_fluid" ? "Влажность, %" : "Температура замерзания, °C";
  const measurementValue = parseMeasurement();
  const measurementPreviewStatus =
    measurement && measurementValue != null ? trafficLightFromMeasurement(measurement, measurementValue) : null;
  const measurementPreview = measurementPreviewStatus
    ? `${meas.trim()}${measurementUnit ?? ""} → ${statusLabel(measurementPreviewStatus)}`
    : "Введите замер";

  useEffect(() => {
    return () => {
      if (measurementSaveTimer.current) clearTimeout(measurementSaveTimer.current);
      if (recommendationSaveTimer.current) clearTimeout(recommendationSaveTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!detailCommand || handledDetailCommand.current === detailCommand.nonce) return;
    handledDetailCommand.current = detailCommand.nonce;
    window.setTimeout(() => {
      if ((detailCommand.type === "open_node" || detailCommand.type === "collapse_node") && detailCommand.node !== props.node.node) {
        return;
      }
      if (detailCommand.type === "open_node") {
        setDetailsOpen(true);
        return;
      }
      if (detailCommand.type === "collapse_node") {
        setDetailsOpen(false);
        return;
      }
      if (detailCommand.type === "collapse_all") {
        setDetailsOpen(false);
        return;
      }
      setDetailsOpen(status === "YELLOW" || status === "RED");
    }, 0);
  }, [detailCommand, props.node.node, status]);

  const persist = async (
    next: Partial<{
      status: DiagnosticPositionStatus;
      tags: string[];
      recommendation: string;
      measurementValue: number | null;
      notes: string;
    }>
  ) => {
    const nextStatus = next.status ?? status;
    await props.onSave({
      block: props.block as DiagnosticBlock,
      node: props.node.node,
      status: nextStatus,
      tags: next.tags ?? tags,
      measurementValue: next.measurementValue !== undefined ? next.measurementValue : parseMeasurement(),
      measurementUnit,
      recommendation: next.recommendation !== undefined ? next.recommendation || null : rec || null,
      notes: next.notes !== undefined ? next.notes || null : note || null,
    });
  };

  const applyMeasurement = (rawValue = meas) => {
    if (!measurement) return;
    if (measurementSaveTimer.current) clearTimeout(measurementSaveTimer.current);
    const value = parseMeasurement(rawValue);
    if (value == null) {
      void persist({ measurementValue: null });
      return;
    }
    const nextStatus = trafficLightFromMeasurement(measurement, value);
    if (nextStatus === "YELLOW" || nextStatus === "RED") setDetailsOpen(true);
    void persist({ status: nextStatus, measurementValue: value });
  };

  const scheduleMeasurementSave = (rawValue: string) => {
    if (!measurement) return;
    if (measurementSaveTimer.current) clearTimeout(measurementSaveTimer.current);
    const value = parseMeasurement(rawValue);
    measurementSaveTimer.current = setTimeout(() => {
      if (value == null) {
        void persist({ measurementValue: null });
        return;
      }
      const nextStatus = trafficLightFromMeasurement(measurement, value);
      if (nextStatus === "YELLOW" || nextStatus === "RED") setDetailsOpen(true);
      void persist({ status: nextStatus, measurementValue: value });
    }, 450);
  };

  const applyRecommendation = (value: string) => {
    if (recommendationSaveTimer.current) clearTimeout(recommendationSaveTimer.current);
    setRec(value);
    void persist({ recommendation: value });
  };

  const scheduleRecommendationSave = (value: string) => {
    if (recommendationSaveTimer.current) clearTimeout(recommendationSaveTimer.current);
    recommendationSaveTimer.current = setTimeout(() => {
      void persist({ recommendation: value });
    }, 450);
  };

  const showDetails = detailsOpen;
  const photosCount = props.position.photos.length;
  const inlineOffer = status === "RED" && props.liveOffer?.decision !== "ignored" ? props.liveOffer : undefined;
  const inlineOfferSelectedVariant = inlineOffer?.variants[inlineOfferVariant] ?? inlineOffer?.variants[0];
  const hasRowError = Boolean(props.saveError || photoError);

  const uploadPickedPhotos = async (picked: File[]) => {
    if (picked.length === 0) return;
    setDetailsOpen(true);
    setPhotoError(null);
    setPhotoProgress(0);
    try {
      await props.onPhoto(props.node.node, picked, setPhotoProgress);
      setPhotoProgress(null);
      setFailedPhotoFiles(null);
    } catch (error) {
      setPhotoProgress(null);
      setFailedPhotoFiles(picked);
      setPhotoError(error instanceof Error ? error.message : "Не удалось загрузить фото");
    }
  };

  const handlePhotoFiles = async (files: FileList | null) => {
    await uploadPickedPhotos(Array.from(files ?? []));
  };

  const handleDeletePhoto = async (photoId: string) => {
    setPhotoError(null);
    setDeletingPhotoId(photoId);
    try {
      await props.onDeletePhoto(photoId);
    } catch (error) {
      setPhotoError(error instanceof Error ? error.message : "Не удалось удалить фото");
    } finally {
      setDeletingPhotoId(null);
    }
  };

  return (
    <article
      id={quickRowDomId(props.node.node)}
      tabIndex={-1}
      data-diagnostic-node={props.node.node}
      onFocus={props.onActivate}
      onPointerDown={props.onActivate}
      className={`eco-diagnostic-quick-row eco-diagnostic-quick-row--${status.toLowerCase()} ${
        props.isTarget ? "is-target" : ""
      } ${hasRowError ? "is-save-error" : ""}`}
    >
      <div className="eco-diagnostic-quick-row-main">
        <div className="eco-diagnostic-quick-row-title">
          <strong>{props.node.title}</strong>
          <div>
            <EcoBadge tone={statusTone(status)} dot>
              {statusLabel(status)}
            </EcoBadge>
            {photosCount > 0 && <span>{photosCount} фото</span>}
          </div>
        </div>

        {measurement && (
          <label className="eco-diagnostic-quick-measure">
            <span>{measurementLabel}</span>
            <input
              type="text"
              inputMode="decimal"
              className="eco-input"
              value={meas}
              onChange={(e) => {
                setMeas(e.target.value);
                scheduleMeasurementSave(e.target.value);
              }}
              onBlur={() => applyMeasurement()}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.currentTarget.blur();
                }
              }}
            />
            <b
              className={`eco-diagnostic-quick-measure-result ${
                measurementPreviewStatus ? `is-${measurementPreviewStatus.toLowerCase()}` : ""
              }`}
            >
              {measurementPreview}
            </b>
          </label>
        )}

        <div className="eco-diagnostic-quick-statuses" role="group" aria-label={`Статус: ${props.node.title}`}>
          {(["GREEN", "YELLOW", "RED", "SKIPPED"] as const).map((nextStatus) => (
            <button
              key={nextStatus}
              type="button"
              onClick={() => {
                if (nextStatus === "YELLOW" || nextStatus === "RED" || nextStatus === "SKIPPED") setDetailsOpen(true);
                else setDetailsOpen(false);
                void persist({ status: nextStatus });
              }}
              className={`eco-diagnostic-quick-status eco-diagnostic-quick-status--${nextStatus.toLowerCase()} ${
                status === nextStatus ? "is-active" : ""
              }`}
            >
              {statusLabel(nextStatus)}
            </button>
          ))}
        </div>

        <div className="eco-diagnostic-quick-row-tools">
          <button
            type="button"
            className="eco-diagnostic-quick-chevron"
            aria-label={showDetails ? "Свернуть детали" : "Раскрыть детали"}
            onClick={() => setDetailsOpen((value) => !value)}
          >
            {showDetails ? <ChevronUp className="eco-icon" aria-hidden /> : <ChevronDown className="eco-icon" aria-hidden />}
          </button>
          <button type="button" onClick={() => setDetailsOpen((value) => !value)}>
            {showDetails ? "Скрыть детали" : "Детали"}
          </button>
          {!measurement && (
            <button type="button" onClick={props.onOpenDetail}>
              Открыть карточку
            </button>
          )}
        </div>
      </div>

      {props.saveError && (
        <div className="eco-diagnostic-row-save-error" role="status" aria-live="polite">
          <span>{props.saveError.message}</span>
          <button type="button" onClick={() => props.onRetrySave(props.saveError!.payload)}>
            Повторить
          </button>
        </div>
      )}

      {showDetails && (
        <div className="eco-diagnostic-quick-details">
          {(status === "YELLOW" || status === "RED") && (
            <>
              {props.tags.length > 0 && (
                <DiagnosticTagPicker
                  tags={props.tags}
                  selectedTags={tags}
                  onChange={(nextTags) => {
                    setTags(nextTags);
                    void persist({ tags: nextTags });
                  }}
                />
              )}

              {photosCount > 0 && (
                <div className="eco-diagnostic-photo-strip" aria-label={`Фото: ${props.node.title}`}>
                  {props.position.photos.map((photo) => (
                    <figure key={photo.id}>
                      {/* eslint-disable-next-line @next/next/no-img-element -- session-gated thumbnails are served by the diagnostic photo API */}
                      <img src={photoUrl(props.position.diagnosticId, photo.id)} alt={photo.caption ?? props.node.title} />
                      <button
                        type="button"
                        onClick={() => void handleDeletePhoto(photo.id)}
                        disabled={deletingPhotoId === photo.id}
                        aria-label="Удалить фото"
                      >
                        <Trash2 className="eco-icon" aria-hidden />
                      </button>
                    </figure>
                  ))}
                </div>
              )}

              <label className="eco-diagnostic-file eco-diagnostic-quick-file">
                <Camera className="eco-icon" aria-hidden />
                <span>{photosCount > 0 ? `Добавить ещё фото (${photosCount})` : "Фото обязательно для завершения"}</span>
                <input
                  id={quickPhotoInputId(props.node.node)}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  multiple
                  onChange={(e) => {
                    void handlePhotoFiles(e.target.files);
                    e.currentTarget.value = "";
                  }}
                />
              </label>

              {photoProgress != null && (
                <div className="eco-diagnostic-photo-progress" role="status" aria-live="polite">
                  <span>Загрузка фото: {photoProgress}%</span>
                  <i aria-hidden>
                    <em style={{ width: `${photoProgress}%` }} />
                  </i>
                </div>
              )}

              {photoError && (
                <div className="eco-diagnostic-photo-error">
                  <span>{photoError}</span>
                  {failedPhotoFiles && failedPhotoFiles.length > 0 && (
                    <button type="button" onClick={() => void uploadPickedPhotos(failedPhotoFiles)}>
                      Повторить
                    </button>
                  )}
                </div>
              )}

              {status === "RED" && (
                inlineOffer ? (
                  <div className={`eco-diagnostic-inline-offer is-${inlineOffer.decision ?? "pending"}`}>
                    <div>
                      <div className="eco-page-kicker">Рекомендуем добавить в отгрузку</div>
                      <strong>{inlineOffer.title}</strong>
                      <span>{inlineOffer.nodeTitle}</span>
                    </div>
                    {inlineOffer.variants.length > 1 ? (
                      <label>
                        <span>Вариант</span>
                        <select
                          className="eco-input"
                          value={inlineOfferVariant}
                          onChange={(event) => setInlineOfferVariant(Number(event.target.value))}
                        >
                          {inlineOffer.variants.map((variant, index) => (
                            <option key={variant.label} value={index}>
                              {variant.label} · {variant.priceRub.toLocaleString("ru-RU")} ₽
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : (
                      <span className="eco-diagnostic-inline-offer-price">
                        {inlineOfferSelectedVariant?.label ?? inlineOffer.title} ·{" "}
                        {(inlineOfferSelectedVariant?.priceRub ?? 0).toLocaleString("ru-RU")} ₽
                      </span>
                    )}
                    {inlineOffer.decision === "added" ? (
                      <em>Добавлено в отгрузку</em>
                    ) : (
                      <div>
                        <button type="button" onClick={() => props.onAddLiveOffer(inlineOffer, inlineOfferVariant)}>
                          <ClipboardCheck className="eco-icon" aria-hidden />
                          Добавить в отгрузку
                        </button>
                        <button type="button" onClick={() => props.onSetOfferDecision(inlineOffer.key, "later")}>
                          Добавить позже
                        </button>
                        <button type="button" onClick={() => props.onSetOfferDecision(inlineOffer.key, "ignored")}>
                          Не предлагать
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="eco-diagnostic-inline-offer is-manual">
                    <div>
                      <div className="eco-page-kicker">Рекомендация без товара</div>
                      <strong>{props.node.title}</strong>
                      <span>Для этого узла пока нет автоматического оффера.</span>
                    </div>
                    <button type="button" onClick={props.onOpenDetail}>
                      Добавить вручную
                    </button>
                  </div>
                )
              )}

              {status === "YELLOW" && (
                <div className={`eco-diagnostic-inline-reminder ${props.crmReminderCreated ? "is-created" : ""}`}>
                  <div>
                    <div className="eco-page-kicker">На следующий визит</div>
                    <strong>{props.crmReminderCreated ? "CRM-дело создано" : "Создать CRM-дело"}</strong>
                    <span>{rec || "Контроль через 5000 км или при следующем визите"}</span>
                  </div>
                  <button
                    type="button"
                    onClick={props.onCreateReminder}
                    disabled={props.crmReminderLoading || props.crmReminderCreated}
                  >
                    <FileText className="eco-icon" aria-hidden />
                    {props.crmReminderCreated ? "Готово" : "Создать напоминание"}
                  </button>
                </div>
              )}

              <div className="eco-diagnostic-quick-recommendation">
                <span>Рекомендация</span>
                <div className="eco-diagnostic-recommendation-chips" role="group" aria-label={`Рекомендации: ${props.node.title}`}>
                  {props.recPresets.slice(0, 3).map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      className={rec === preset ? "is-active" : ""}
                      onClick={() => applyRecommendation(preset)}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
                <label className="eco-field eco-diagnostic-custom-recommendation">
                  <span>Своя рекомендация</span>
                  <input
                    className="eco-input"
                    value={rec}
                    placeholder="Своя рекомендация"
                    onChange={(event) => {
                      setRec(event.target.value);
                      scheduleRecommendationSave(event.target.value);
                    }}
                    onBlur={(event) => applyRecommendation(event.target.value)}
                  />
                </label>
              </div>
            </>
          )}

          <label className="eco-field eco-diagnostic-quick-note">
            <span>{status === "SKIPPED" ? "Причина пропуска" : "Комментарий"}</span>
            <textarea
              className="eco-input"
              value={note}
              rows={2}
              placeholder={status === "SKIPPED" ? "Почему пункт пропущен" : "Комментарий мастера"}
              onChange={(e) => setNote(e.target.value)}
              onBlur={() => void persist({ notes: note })}
            />
          </label>

          <EcoButton
            type="button"
            onClick={props.onVoice}
            variant="ghost"
            size="sm"
            className="eco-diagnostic-quick-voice"
          >
            <Mic className="eco-icon" aria-hidden />
            Голосовая заметка
          </EcoButton>
          <EcoButton
            type="button"
            onClick={() => setDetailsOpen(false)}
            size="sm"
            className="eco-diagnostic-quick-collapse"
          >
            <ChevronUp className="eco-icon" aria-hidden />
            Свернуть
          </EcoButton>
        </div>
      )}
    </article>
  );
}

function BlockScreen(props: {
  block: DiagnosticBlockCode;
  positions: (DiagnosticPosition & { photos: DiagnosticPhoto[] })[];
  onPickNode: (node: string) => void;
  onBack: () => void;
}) {
  const rows = sortDiagnosticRows(
    props.positions
      .filter((position) => position.block === props.block)
      .map((position) => ({ node: catalogNodeForPosition(position), position }))
  );
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
        {rows.length === 0 && (
          <li className="eco-diagnostic-node-empty">В этом блоке нет активных пунктов для выбранных параметров автомобиля</li>
        )}
        {rows.map((row) => {
          const st = row.position.status;
          return (
            <li key={row.position.id}>
              <button
                type="button"
                onClick={() => props.onPickNode(row.node.node)}
                className="eco-diagnostic-node"
              >
                <span>{row.node.title}</span>
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
  tags: TagDef[];
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
    notes?: string | null;
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
    if (!props.position) return;
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

  if (!props.position) {
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
        <div className="eco-diagnostic-node-empty">Пункт не добавлен для выбранных параметров автомобиля</div>
      </div>
    );
  }

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
          <DiagnosticTagPicker
            tags={props.tags}
            selectedTags={tags}
            onChange={(next) => {
              setTags(next);
              void persist({ tags: next });
            }}
          />

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
  reportUrl: string | null;
  reportActionsDisabled: boolean;
  crmReminderPositionIds: string[];
  crmReminderLoading: boolean;
  onBack: () => void;
  onAddShipment: () => void;
  onCreateReminders: (positionIds?: string[]) => void;
  onCopyReportLink: () => void;
  onOpenReport: () => void;
  onPrintReport: () => void;
  onSendReportLater: () => void;
  onComplete: () => void;
}) {
  const positions = props.data?.positions ?? [];
  const greenCount = positions.filter((p) => p.status === "GREEN").length;
  const yellowPositions = positions.filter((p) => p.status === "YELLOW");
  const redPositions = positions.filter((p) => p.status === "RED");
  const skippedCount = positions.filter((p) => p.status === "SKIPPED").length;
  const problemPositions = [...redPositions, ...yellowPositions];
  const reminderPositionSet = new Set(props.crmReminderPositionIds);
  const variants = (o: DiagnosticOffer) => (Array.isArray(o.variants) ? (o.variants as { label: string; priceRub: number }[]) : []);
  const redOffers = (props.data?.offers ?? []).filter((o) => !o.nextVisitOnly);
  const yellowOffers = (props.data?.offers ?? []).filter((o) => o.nextVisitOnly);
  const redOffersByPosition = new Map<string, DiagnosticOffer[]>();
  for (const offer of redOffers) {
    if (!offer.relatedPositionId) continue;
    redOffersByPosition.set(offer.relatedPositionId, [...(redOffersByPosition.get(offer.relatedPositionId) ?? []), offer]);
  }
  const selectedShipmentOfferCount = redOffers.filter((offer) => props.selectedOffers[offer.id] !== undefined).length;
  const problemPhotos = problemPositions.flatMap((position) =>
    position.photos.map((photo) => ({ photo, position }))
  );
  const reportTitle = [props.data?.brand, props.data?.model, props.data?.licensePlate].filter(Boolean).join(" · ") || "Диагностика автомобиля";
  const nextVisitLabel = "через 30 дней";

  const renderOffer = (offer: DiagnosticOffer, selectable = true) => (
    <div key={offer.id} className="eco-diagnostic-summary-offer">
      {selectable ? (
        <label className="eco-diagnostic-offer-check">
          <input
            type="checkbox"
            checked={props.selectedOffers[offer.id] !== undefined}
            onChange={(e) => {
              if (e.target.checked) {
                props.setSelectedOffers((prev) => ({ ...prev, [offer.id]: prev[offer.id] ?? 0 }));
              } else {
                props.setSelectedOffers((prev) => {
                  const n = { ...prev };
                  delete n[offer.id];
                  return n;
                });
              }
            }}
          />
          <span>{offer.title}</span>
        </label>
      ) : (
        <div className="eco-diagnostic-offer-check">
          <span>{offer.title}</span>
        </div>
      )}
      <div className="eco-diagnostic-offer-variants">
        {variants(offer).map((variant, idx) =>
          selectable ? (
            <label key={`${offer.id}-${variant.label}`}>
              <input
                type="radio"
                name={`var-${offer.id}`}
                checked={(props.selectedOffers[offer.id] ?? 0) === idx}
                onChange={() => props.setSelectedOffers((prev) => ({ ...prev, [offer.id]: idx }))}
              />
              <span>{variant.label}</span>
              <b>{variant.priceRub.toLocaleString("ru-RU")} ₽</b>
            </label>
          ) : (
            <span key={`${offer.id}-${variant.label}`} className="eco-diagnostic-offer-static">
              <span>{variant.label}</span>
              <b>{variant.priceRub.toLocaleString("ru-RU")} ₽</b>
            </span>
          )
        )}
      </div>
    </div>
  );

  return (
    <div className="eco-diagnostic-summary">
      <div className="eco-diagnostic-panel-head">
        <EcoButton type="button" onClick={props.onBack} variant="ghost" size="sm">
          <ArrowLeft className="eco-icon" aria-hidden />
          К чек-листу
        </EcoButton>
        <div>
          <div className="eco-page-kicker">Сводка</div>
          <h2>Рекомендации и офферы</h2>
        </div>
      </div>

      <div className="eco-grid eco-grid--kpi eco-diagnostic-summary-kpis">
        <EcoKpi label="Норма" value={props.data?.summaryGreen ?? greenCount} sub="Без действий" tone="success" />
        <EcoKpi label="Внимание" value={props.data?.summaryYellow ?? yellowPositions.length} sub="На следующий визит" tone="warning" />
        <EcoKpi label="Замена" value={props.data?.summaryRed ?? redPositions.length} sub="Сделать сейчас" tone="danger" />
        <EcoKpi label="Пропущено" value={skippedCount} sub="Не применимо" tone="neutral" />
      </div>

      <section className="eco-card eco-card--padded eco-diagnostic-zone eco-diagnostic-zone--red">
        <div className="eco-diagnostic-section-head">
          <div className="eco-page-kicker">Красная зона</div>
          <h3>Что надо сделать сейчас</h3>
          <p>{redPositions.length > 0 ? "Выберите офферы, которые нужно добавить в отгрузку." : "Красных пунктов нет."}</p>
        </div>
        <div className="eco-diagnostic-zone-list">
          {redPositions.length === 0 && <div className="eco-diagnostic-summary-empty">Срочных замен не найдено</div>}
          {redPositions.map((position) => {
            const tagLabels = tagLabelsForNode(position.node, position.tags);
            const offers = redOffersByPosition.get(position.id) ?? [];
            return (
              <article key={position.id} className="eco-diagnostic-zone-item is-red">
                <div>
                  <strong>{nodeTitle(position.node)}</strong>
                  <span>{position.recommendation || "Рекомендация не указана"}</span>
                  {tagLabels.length > 0 && <em>{tagLabels.join(" · ")}</em>}
                </div>
                {offers.length > 0 ? (
                  <div className="eco-diagnostic-summary-offers">{offers.map((offer) => renderOffer(offer))}</div>
                ) : (
                  <div className="eco-diagnostic-summary-empty is-inline">Оффер не создан, можно добавить вручную</div>
                )}
              </article>
            );
          })}
        </div>
      </section>

      <section className="eco-card eco-card--padded eco-diagnostic-zone eco-diagnostic-zone--yellow">
        <div className="eco-diagnostic-section-head">
          <div className="eco-page-kicker">Жёлтая зона</div>
          <h3>Что предложить на следующий визит</h3>
          <p>{yellowPositions.length > 0 ? `Плановый контакт: ${nextVisitLabel}.` : "Жёлтых пунктов нет."}</p>
        </div>
        <div className="eco-diagnostic-zone-list">
          {yellowPositions.length === 0 && <div className="eco-diagnostic-summary-empty">Отложенных рекомендаций нет</div>}
          {yellowPositions.map((position) => {
            const tagLabels = tagLabelsForNode(position.node, position.tags);
            const reminderCreated = reminderPositionSet.has(position.id);
            return (
              <article key={position.id} className="eco-diagnostic-zone-item is-yellow">
                <div>
                  <strong>{nodeTitle(position.node)}</strong>
                  <span>{position.recommendation || "Контроль на следующем визите"}</span>
                  {tagLabels.length > 0 && <em>{tagLabels.join(" · ")}</em>}
                </div>
                <div className="eco-diagnostic-reminder-actions">
                  <EcoBadge tone="warning">На следующий визит</EcoBadge>
                  <EcoButton
                    type="button"
                    size="sm"
                    onClick={() => props.onCreateReminders([position.id])}
                    disabled={props.crmReminderLoading || reminderCreated}
                  >
                    <FileText className="eco-icon" aria-hidden />
                    {reminderCreated ? "CRM-дело создано" : "Создать CRM-дело"}
                  </EcoButton>
                </div>
              </article>
            );
          })}
          {yellowOffers.length > 0 && (
            <div className="eco-diagnostic-summary-offers is-next-visit">
              <strong>Офферы на следующий визит</strong>
              {yellowOffers.map((offer) => renderOffer(offer, false))}
            </div>
          )}
        </div>
      </section>

      <section className="eco-card eco-card--padded eco-diagnostic-photo-summary">
        <div className="eco-diagnostic-section-head">
          <div className="eco-page-kicker">Фото</div>
          <h3>Проблемные фото</h3>
          <p>{problemPhotos.length > 0 ? `${problemPhotos.length} фото по жёлтым и красным пунктам.` : "Фото проблемных зон пока нет."}</p>
        </div>
        {problemPhotos.length > 0 ? (
          <div className="eco-diagnostic-photo-summary-grid">
            {problemPhotos.map(({ photo, position }) => (
              <figure key={photo.id}>
                {/* eslint-disable-next-line @next/next/no-img-element -- session-gated thumbnails are served by the diagnostic photo API */}
                <img src={photoUrl(position.diagnosticId, photo.id)} alt={photo.caption ?? nodeTitle(position.node)} />
                <figcaption>{nodeTitle(position.node)}</figcaption>
              </figure>
            ))}
          </div>
        ) : (
          <div className="eco-diagnostic-summary-empty">Добавьте фото в проблемных строках чек-листа</div>
        )}
      </section>

      <section className="eco-card eco-card--padded eco-diagnostic-report-preview">
        <div className="eco-diagnostic-section-head">
          <div className="eco-page-kicker">Публичный отчёт</div>
          <h3>Preview для клиента</h3>
        </div>
        <div className="eco-diagnostic-report-preview-card">
          <div>
            <strong>{reportTitle}</strong>
            <span>
              Норма {greenCount} · Внимание {yellowPositions.length} · Замена {redPositions.length}
            </span>
          </div>
          <p>
            Клиент увидит проблемные пункты, рекомендации мастера и фото. Ссылка доступна после завершения диагностики.
          </p>
          {props.reportUrl ? (
            <a href={props.reportUrl} target="_blank" rel="noreferrer">
              {props.reportUrl}
            </a>
          ) : (
            <span>Ссылка появится после завершения или копирования отчёта</span>
          )}
        </div>
        <div className="eco-diagnostic-report-actions">
          <EcoButton
            type="button"
            onClick={props.onOpenReport}
            disabled={props.reportActionsDisabled}
            title={props.reportActionsDisabled ? "Завершите диагностику перед открытием отчёта" : undefined}
            size="sm"
          >
            <Eye className="eco-icon" aria-hidden />
            Открыть отчёт
          </EcoButton>
          <EcoButton
            type="button"
            onClick={props.onPrintReport}
            disabled={props.reportActionsDisabled}
            title={props.reportActionsDisabled ? "Завершите диагностику перед печатью" : undefined}
            size="sm"
          >
            <FileText className="eco-icon" aria-hidden />
            Печать отчёта
          </EcoButton>
          <EcoButton
            type="button"
            onClick={props.onCopyReportLink}
            disabled={props.reportActionsDisabled}
            title={props.reportActionsDisabled ? "Завершите диагностику перед копированием ссылки" : undefined}
            size="sm"
          >
            <ClipboardCheck className="eco-icon" aria-hidden />
            Копировать ссылку
          </EcoButton>
          <EcoButton type="button" onClick={props.onSendReportLater} variant="ghost" size="sm">
            <FileText className="eco-icon" aria-hidden />
            Скопировать позже
          </EcoButton>
        </div>
      </section>

      <div className="eco-diagnostic-actions">
        <EcoButton
          type="button"
          onClick={props.onAddShipment}
          variant="primary"
          disabled={selectedShipmentOfferCount === 0}
        >
          <ClipboardCheck className="eco-icon" aria-hidden />
          Добавить выбранное в отгрузку
        </EcoButton>
        <EcoButton
          type="button"
          onClick={() => props.onCreateReminders()}
          disabled={props.crmReminderLoading || yellowPositions.length === 0}
        >
          <FileText className="eco-icon" aria-hidden />
          Создать напоминания
        </EcoButton>
        <EcoButton
          type="button"
          onClick={props.onCopyReportLink}
          disabled={props.reportActionsDisabled}
          title={props.reportActionsDisabled ? "Завершите диагностику перед копированием ссылки" : undefined}
        >
          <ClipboardCheck className="eco-icon" aria-hidden />
          Скопировать ссылку отчёта
        </EcoButton>
        <EcoButton
          type="button"
          onClick={props.onOpenReport}
          disabled={props.reportActionsDisabled}
          title={props.reportActionsDisabled ? "Завершите диагностику перед открытием отчёта" : undefined}
        >
          <Eye className="eco-icon" aria-hidden />
          Открыть отчёт
        </EcoButton>
        <EcoButton
          type="button"
          onClick={props.onPrintReport}
          disabled={props.reportActionsDisabled}
          title={props.reportActionsDisabled ? "Завершите диагностику перед печатью" : undefined}
        >
          <FileText className="eco-icon" aria-hidden />
          Печать отчёта
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
