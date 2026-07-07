"use client";
/* eslint-disable @next/next/no-img-element -- report renders brand assets and diagnostic photos in browser/PDF layouts. */

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, Printer } from "lucide-react";
import { formatServiceDayMonth, formatServiceTime, toServiceDateInput } from "@/lib/date-time";

type PublicReportPhoto = {
  id: string;
  caption: string;
  url: string;
  itemTitle: string;
  status: string;
};

type ReportItem = {
  code: string;
  title: string;
  blockTitle: string;
  status: string;
  statusLabel: string;
  statusText: string;
  value?: string;
  comment?: string;
  recommendation?: string;
  reportText?: {
    sourceText: string;
    resultText: string;
    recommendationText: string;
    photoText: string;
    shortText?: string;
  };
  showInReport?: boolean;
  selectedNotes?: string[];
  photos: { id: string; caption: string; url: string }[];
};

type ReportPayload = {
  reportUrl: string;
  publicToken?: string;
  publicTelegramUrl?: string | null;
  publicTelegramUsername?: string | null;
  publicReportPrimaryMessenger?: "telegram" | string | null;
  publicPhone?: string | null;
  publicBookingUrl?: string | null;
  publicSiteUrl?: string | null;
  publicAddress?: string | null;
  vehicle: {
    title: string;
    vin?: string | null;
    licensePlate?: string | null;
    mileage?: number | null;
  };
  vehiclePhoto?: {
    id: string;
    caption?: string | null;
    url: string;
    thumbnailUrl?: string;
    printUrl?: string;
    mimeType?: string | null;
    sizeBytes?: number | null;
    updatedAt?: string | null;
  } | null;
  clientName?: string | null;
  master?: { name?: string | null; login?: string | null };
  startedAt: string;
  completedAt?: string | null;
  clientWantsReminder?: boolean;
  counts: {
    total: number;
    good?: number;
    warn?: number;
    crit?: number;
    normal?: number;
    attention?: number;
    replace?: number;
    indirect: number;
  };
  blocks: { code: string; title: string; items: ReportItem[] }[];
  statusLegend?: Record<string, { label: string; color: string; icon: string; clientText: string }>;
};

type LegacyPayload = {
  publicUrl: string;
  qrDataUrl?: string;
  header: {
    brand: string | null;
    model: string | null;
    year: number | null;
    licensePlate: string | null;
    mileage: number | null;
    vin: string | null;
    startedAt: string;
    completedAt: string | null;
    summaryGreen: number;
    summaryYellow: number;
    summaryRed: number;
    mechanicLogin: string | null;
  };
  clientWantsReminder: boolean;
  positions: Array<{
    key: string;
    status: "YELLOW" | "RED";
    itemText?: {
      title?: string;
      statusLabel?: string;
      explanation?: string;
      recommendation?: string;
    };
    photos: { id: string; caption: string | null; url: string }[];
  }>;
  normalPositions?: Array<{ key: string; title: string }>;
};

type DiagnosticPublicReportProps = {
  token: string;
  mode?: "online" | "print";
  autoPrint?: boolean;
};

const REPORT_PHONE = "+7 (995) 054-58-59";
const REPORT_PHONE_HREF = "tel:+79950545859";
const BOOKING_HREF = "/client-site#/vin";
const ATTENTION_STATUSES = ["crit", "warn"] as const;
const INDIRECT_STATUSES = ["by-mileage", "by-client"] as const;
const ATTENTION_STATUS_ORDER: Record<string, number> = { crit: 0, warn: 1 };

async function fetchJson<T>(url: string): Promise<{ ok: true; data: T } | { ok: false }> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 20_000);
  let response: Response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } catch {
    window.clearTimeout(timer);
    return { ok: false };
  }
  window.clearTimeout(timer);
  if (!response.ok) return { ok: false };
  try {
    return { ok: true, data: (await response.json()) as T };
  } catch {
    return { ok: false };
  }
}

function normalizeStatus(status: string): string {
  const value = status.toLowerCase();
  if (["green", "normal", "ok", "good", "норма", "хорошо"].includes(value)) return "good";
  if (["yellow", "attention", "warning", "warn", "внимание"].includes(value)) return "warn";
  if (["red", "replace", "critical", "crit", "критично", "замена"].includes(value)) return "crit";
  if (["no_access", "no-access", "нет доступа", "доступ затруднён"].includes(value)) return "no-access";
  if (["by_mileage", "by-mileage", "по пробегу"].includes(value)) return "by-mileage";
  if (["by_client", "by-client", "со слов клиента"].includes(value)) return "by-client";
  return "unchecked";
}

function statusColor(status: string): string {
  const normalized = normalizeStatus(status);
  if (normalized === "crit") return "#991B1B";
  if (normalized === "warn") return "#9A4E12";
  if (normalized === "good") return "#166534";
  if (normalized === "no-access") return "#475569";
  if (normalized === "by-mileage") return "#475569";
  if (normalized === "by-client") return "#475569";
  return "#737373";
}

function statusIcon(status: string): string {
  const normalized = normalizeStatus(status);
  if (normalized === "crit") return "×";
  if (normalized === "warn") return "!";
  if (normalized === "good") return "✓";
  if (normalized === "no-access") return "⊘";
  if (normalized === "by-mileage") return "≈";
  if (normalized === "by-client") return "”";
  return "○";
}

function statusLabel(status: string): string {
  const normalized = normalizeStatus(status);
  if (normalized === "crit") return "Критично";
  if (normalized === "warn") return "Внимание";
  if (normalized === "good") return "Хорошо";
  if (normalized === "no-access") return "Доступ затруднён";
  if (normalized === "by-mileage") return "Вывод по пробегу";
  if (normalized === "by-client") return "Со слов клиента";
  return "Не проверено";
}

function isAttentionStatus(status: string): boolean {
  return ATTENTION_STATUSES.includes(normalizeStatus(status) as (typeof ATTENTION_STATUSES)[number]);
}

function isIndirectStatus(status: string): boolean {
  return INDIRECT_STATUSES.includes(normalizeStatus(status) as (typeof INDIRECT_STATUSES)[number]);
}

function sortBySeverity(a: ReportItem, b: ReportItem): number {
  const severityDelta = (ATTENTION_STATUS_ORDER[normalizeStatus(a.status)] ?? 9) - (ATTENTION_STATUS_ORDER[normalizeStatus(b.status)] ?? 9);
  if (severityDelta !== 0) return severityDelta;
  return a.blockTitle.localeCompare(b.blockTitle, "ru") || a.title.localeCompare(b.title, "ru");
}

function normalizedText(value?: string | null): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/ё/gu, "е")
    .replace(/[^a-zа-я0-9]+/giu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function itemShortResult(item: ReportItem): string {
  const text = item.reportText?.shortText?.trim();
  if (text) return text;
  return item.value || item.statusLabel || statusLabel(item.status);
}

function itemChecklistText(item: ReportItem): string {
  if (normalizeStatus(item.status) === "no-access") {
    return "Доступ затруднён · пункт не удалось проверить без дополнительного доступа.";
  }
  return itemShortResult(item);
}

function itemResultText(item: ReportItem): string {
  const text = item.reportText?.resultText?.trim();
  if (text) return text;
  return item.comment || item.statusText || statusLabel(item.status);
}

function itemRecommendationText(item: ReportItem): string {
  const text = item.reportText?.recommendationText?.trim();
  if (text) return text;
  return item.recommendation || "Согласовать дальнейшие действия с мастером.";
}

function shouldShowRecommendation(result: string, recommendation: string): boolean {
  const normalizedResult = result.toLowerCase();
  const normalizedRecommendation = recommendation
    .toLowerCase()
    .replace(/^рекомендуем\s+/u, "")
    .replace(/[.!?]/gu, "")
    .trim();
  return Boolean(normalizedRecommendation) && !normalizedResult.includes(normalizedRecommendation.slice(0, 26));
}

function detailChips(item: ReportItem, result: string, recommendation: string): string[] {
  const text = `${normalizedText(result)} ${normalizedText(recommendation)} ${normalizedText(item.title)} ${normalizedText(statusLabel(item.status))}`;
  const valueCandidate =
    item.code === "battery" && item.value && !/soh|здоров|%/iu.test(item.value)
      ? null
      : item.value;
  const candidates = [item.reportText?.shortText, valueCandidate, item.statusLabel, ...(item.selectedNotes ?? [])]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  const seen = new Set<string>();
  return candidates
    .filter((value) => {
      const normalized = normalizedText(value);
      if (!normalized || normalized.length < 3 || seen.has(normalized)) return false;
      seen.add(normalized);
      if (normalized === normalizedText(statusLabel(item.status))) return false;
      return !text.includes(normalized);
    })
    .slice(0, 3);
}

function clientItemTitle(title: string): string {
  return title
    .replace(/\bATF\b/giu, "масло АКПП / ATF")
    .replace(/\bАКПП\b/giu, "АКПП");
}

function telegramUsername(value?: string | null): string | null {
  if (!value) return null;
  const withoutUrl = value
    .trim()
    .replace(/^https?:\/\/(?:www\.)?(?:t\.me|telegram\.me)\//i, "")
    .replace(/^tg:\/\/resolve\?domain=/i, "");
  const username = withoutUrl.replace(/^@/, "").split(/[/?#&]/)[0]?.trim();
  return username || null;
}

function telegramUrl(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed) || /^tg:\/\//i.test(trimmed)) return trimmed;
  if (/^(?:www\.)?(?:t\.me|telegram\.me)\//i.test(trimmed)) return `https://${trimmed.replace(/^www\./i, "")}`;
  return null;
}

function blockSummary(items: ReportItem[]): string {
  const active = items.filter((item) => item.showInReport !== false);
  const countText = `${active.length} ${pluralRu(active.length, "пункт", "пункта", "пунктов")}`;
  if (active.some((item) => normalizeStatus(item.status) === "crit")) return `${countText} · есть критично`;
  if (active.some((item) => normalizeStatus(item.status) === "warn")) return `${countText} · есть внимание`;
  if (active.some((item) => isIndirectStatus(item.status))) return `${countText} · информационно`;
  if (active.every((item) => ["no-access", "unchecked"].includes(normalizeStatus(item.status)))) return countText;
  return `${countText} · всё хорошо`;
}

function formatDay(value?: string | null): string {
  if (!value) return "—";
  return formatServiceDayMonth(value);
}

function formatYearTime(value?: string | null): string {
  if (!value) return "—";
  const year = toServiceDateInput(value).slice(0, 4);
  return `${year} · ${formatServiceTime(value)}`;
}

function formatNumericDate(value?: string | null): string {
  if (!value) return "—";
  const [year, month, day] = toServiceDateInput(value).split("-");
  return `${day}.${month}.${year}`;
}

function formatMileage(value?: number | null): string {
  if (value == null) return "—";
  return value.toLocaleString("ru-RU").replace(/\u00a0/g, " ");
}

function maskLogin(login?: string | null): string {
  if (!login) return "TGM";
  if (login.length <= 2) return login;
  return `${login[0]}${"•".repeat(Math.max(1, login.length - 2))}${login.slice(-1)}`;
}

function adaptLegacy(payload: LegacyPayload): ReportPayload {
  const problemItems: ReportItem[] = payload.positions.map((position) => {
    const status = position.status === "RED" ? "crit" : "warn";
    return {
      code: position.key,
      title: position.itemText?.title || "Пункт диагностики",
      blockTitle: "Рекомендации",
      status,
      statusLabel: statusLabel(status),
      statusText: status === "crit" ? "Рекомендуем выполнить обслуживание в ближайшее время." : "Пункт требует внимания.",
      comment: position.itemText?.explanation ?? "",
      recommendation: position.itemText?.recommendation ?? "",
      photos: position.photos.map((photo) => ({
        id: photo.id,
        caption: photo.caption || position.itemText?.title || "Фото диагностики",
        url: photo.url,
      })),
    };
  });
  const normalItems: ReportItem[] = (payload.normalPositions ?? []).map((position) => ({
    code: position.key,
    title: position.title,
    blockTitle: "Проверено без замечаний",
    status: "good",
    statusLabel: "Хорошо",
    statusText: "Пункт проверен. Отклонений не выявлено.",
    photos: [],
  }));

  return {
    reportUrl: payload.publicUrl,
    vehicle: {
      title: [payload.header.brand, payload.header.model, payload.header.year ? String(payload.header.year) : ""].filter(Boolean).join(" ") || "Автомобиль",
      vin: payload.header.vin,
      licensePlate: payload.header.licensePlate,
      mileage: payload.header.mileage,
    },
    vehiclePhoto: null,
    master: { name: payload.header.mechanicLogin },
    startedAt: payload.header.startedAt,
    completedAt: payload.header.completedAt,
    clientWantsReminder: payload.clientWantsReminder,
    counts: {
      total: payload.header.summaryGreen + payload.header.summaryYellow + payload.header.summaryRed,
      good: payload.header.summaryGreen,
      warn: payload.header.summaryYellow,
      crit: payload.header.summaryRed,
      normal: payload.header.summaryGreen,
      attention: payload.header.summaryYellow,
      replace: payload.header.summaryRed,
      indirect: 0,
    },
    blocks: [
      { code: "legacy-problems", title: "Точки внимания", items: problemItems },
      { code: "legacy-normal", title: "Проверено без замечаний", items: normalItems },
    ],
  };
}

function verdict(crit: number, warn: number): string {
  if (crit > 0) return "требует внимания";
  if (warn > 0) return "есть точки внимания";
  return "в порядке";
}

function pluralRu(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

function CarSilhouette({
  vehicleTitle,
  vin,
  photoUrl,
  photoAlt,
}: {
  vehicleTitle: string;
  vin?: string | null;
  photoUrl?: string | null;
  photoAlt?: string;
}) {
  const [photoFailed, setPhotoFailed] = useState(false);
  const showPhoto = Boolean(photoUrl && !photoFailed);
  const showSilhouette = !photoUrl || photoFailed;

  return (
    <div className={`rep-hero-car ${showPhoto ? "has-photo" : ""} ${photoFailed ? "is-photo-failed" : ""}`}>
      {showSilhouette && (
        <svg viewBox="0 0 440 280" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} aria-hidden>
          <rect x="0" y="232" width="440" height="48" fill="#000" />
          <line x1="0" y1="232" x2="440" y2="232" stroke="#C2410C" strokeWidth="1" />
          <path d="M 50 205 L 90 170 L 160 155 L 240 150 L 300 155 L 350 175 L 385 205 L 390 210 L 385 220 L 370 220 L 360 232 Q 340 240 320 230 L 312 220 L 132 220 L 120 232 Q 100 240 80 230 L 70 220 L 60 220 Z" fill="#3D3D3D" />
          <path d="M 150 162 L 200 156 L 270 156 L 305 168 L 290 195 L 165 195 Z" fill="#0a0a0a" />
          <circle cx="100" cy="222" r="22" fill="#0a0a0a" stroke="#3a3a3a" strokeWidth="1.5" />
          <circle cx="100" cy="222" r="10" fill="#1a1a1a" stroke="#3a3a3a" />
          <circle cx="340" cy="222" r="22" fill="#0a0a0a" stroke="#3a3a3a" strokeWidth="1.5" />
          <circle cx="340" cy="222" r="10" fill="#1a1a1a" stroke="#3a3a3a" />
          <circle cx="220" cy="195" r="14" fill="#C2410C" />
          <text x="220" y="201" textAnchor="middle" fontFamily="Oswald" fontSize="18" fontWeight="700" fill="#0a0a0a">76</text>
        </svg>
      )}
      {showPhoto && (
        <img
          className="rep-hero-photo print-vehicle-photo"
          src={photoUrl || ""}
          alt={photoAlt || "Фото автомобиля"}
          loading="eager"
          decoding="sync"
          onError={() => setPhotoFailed(true)}
        />
      )}
      <div className="rep-car-tag">{vehicleTitle} · VIN {vin ? `...${vin.slice(-6)}` : "—"}</div>
    </div>
  );
}

function PhotoTile({ photo, index, status }: { photo: { id: string; caption: string; url: string; itemTitle: string }; index: number; status: string }) {
  const backgroundImage = `url("${photo.url.replace(/"/gu, "%22")}")`;

  return (
    <figure className="rep-photo" key={`${photo.id}-${index}`}>
      <div className="rep-photo-img" style={{ backgroundImage }}>
        <img
          src={photo.url}
          alt={photo.caption || photo.itemTitle || "Фото диагностики"}
          loading="eager"
          decoding="sync"
        />
        <div className="rep-photo-scrim" />
        <span className="rep-photo-dot" style={{ background: statusColor(status) }} />
        <span className="rep-photo-no">IMG_{String(index + 1).padStart(3, "0")}</span>
        <figcaption className="rep-photo-cap">
          <span className="lbl">{photo.itemTitle}</span>
          <span className="cap">{photo.caption || "Фото диагностики"}</span>
        </figcaption>
      </div>
    </figure>
  );
}

export function DiagnosticPublicReport({ token, mode = "online", autoPrint = false }: DiagnosticPublicReportProps) {
  const [payload, setPayload] = useState<ReportPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lightboxPhoto, setLightboxPhoto] = useState<PublicReportPhoto | null>(null);
  const [autoPrintRequested, setAutoPrintRequested] = useState(autoPrint);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      const next = await fetchJson<{ diagnostic: ReportPayload; qrDataUrl?: string }>(`/api/diagnostics/public/${encodeURIComponent(token)}`);
      if (next.ok) {
        if (!cancelled) {
          setPayload(next.data.diagnostic);
        }
        setLoading(false);
        return;
      }
      const legacy = await fetchJson<LegacyPayload>(`/api/diagnostic/public/${encodeURIComponent(token)}`);
      if (legacy.ok) {
        if (!cancelled) {
          setPayload(adaptLegacy(legacy.data));
        }
      } else if (!cancelled) {
        setError("Отчёт не найден");
      }
      if (!cancelled) setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    setAutoPrintRequested(autoPrint);
  }, [autoPrint]);

  useEffect(() => {
    if (mode !== "print" || !autoPrintRequested || loading || error || !payload) return;
    let cancelled = false;
    void (async () => {
      try {
        if (document.fonts?.ready) await document.fonts.ready;
      } catch {
        /* ignore */
      }
      await new Promise((resolve) => setTimeout(resolve, 650));
      if (!cancelled) {
        window.print();
        setAutoPrintRequested(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [autoPrintRequested, error, loading, mode, payload]);

  useEffect(() => {
    if (!lightboxPhoto) return undefined;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setLightboxPhoto(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [lightboxPhoto]);

  const visibleItems = useMemo(
    () => payload?.blocks.flatMap((block) => block.items.map((item) => ({ ...item, blockTitle: block.title }))).filter((item) => item.showInReport !== false) ?? [],
    [payload]
  );

    const reportCounts = useMemo(() => {
      const count = (status: string) => visibleItems.filter((item) => normalizeStatus(item.status) === status).length;
      return {
        total: visibleItems.length,
        good: count("good"),
        warn: count("warn"),
        crit: count("crit"),
        indirect: visibleItems.filter((item) => isIndirectStatus(item.status)).length,
      };
    }, [visibleItems]);

  if (loading) return <main className="diag-print-screen"><section className="diag-report-state">Загрузка отчёта...</section></main>;
  if (error || !payload) return <main className="diag-print-screen"><section className="diag-report-state is-error">{error ?? "Отчёт не найден"}</section></main>;

  const recommendations = visibleItems.filter((item) => isAttentionStatus(item.status)).sort(sortBySeverity);
  const noAccessCount = visibleItems.filter((item) => normalizeStatus(item.status) === "no-access").length;
  const uncheckedCount = visibleItems.filter((item) => normalizeStatus(item.status) === "unchecked").length;
  const recommendationPhotoIds = new Set(recommendations.flatMap((item) => item.photos.map((photo) => photo.id)));
  const vehiclePhoto = payload.vehiclePhoto?.url ? payload.vehiclePhoto : null;
  const vehiclePhotoReportUrl = vehiclePhoto?.url || vehiclePhoto?.thumbnailUrl || null;
  const vehiclePhotoPrintUrl = vehiclePhoto?.printUrl || vehiclePhoto?.url || vehiclePhoto?.thumbnailUrl || null;
  const diagnosticPhotos: PublicReportPhoto[] = visibleItems
    .filter((item) => normalizeStatus(item.status) !== "no-access")
    .flatMap((item) => item.photos.map((photo) => ({ ...photo, itemTitle: clientItemTitle(item.title), status: normalizeStatus(item.status) })));
  const photos: PublicReportPhoto[] = diagnosticPhotos;
  const generalPhotos = photos.filter((photo) => !recommendationPhotoIds.has(photo.id));
  const hasRealItems = reportCounts.total > 0;
  const good = hasRealItems ? reportCounts.good : payload.counts.good ?? payload.counts.normal ?? 0;
  const warn = hasRealItems ? reportCounts.warn : payload.counts.warn ?? payload.counts.attention ?? 0;
  const crit = hasRealItems ? reportCounts.crit : payload.counts.crit ?? payload.counts.replace ?? 0;
  const indirect = hasRealItems ? reportCounts.indirect : payload.counts.indirect ?? 0;
  const limitedCount = noAccessCount + uncheckedCount + indirect;
  const total = hasRealItems ? reportCounts.total : payload.counts.total || visibleItems.length;
  const reportDate = payload.completedAt ?? payload.startedAt;
  const checkedText = `${total} ${pluralRu(total, "пункт", "пункта", "пунктов")} ${total === 1 ? "проверен" : "проверены"}`;
  const checkedClientText = `Проверено ${total} ${pluralRu(total, "пункт", "пункта", "пунктов")}`;
  const attentionCount = recommendations.length;
  const recommendationsText = attentionCount > 0
    ? `Есть ${attentionCount} ${pluralRu(attentionCount, "рекомендация", "рекомендации", "рекомендаций")}`
    : "Рекомендаций по срочным работам нет";
  const mainResultTitle = crit > 0
    ? "Есть критичные замечания"
    : attentionCount > 0 || noAccessCount > 0
      ? "Критичных замечаний нет"
      : "Замечаний нет";
  const mainResultSubtitle = crit > 0
    ? `Нужно обратить внимание на ${attentionCount} ${pluralRu(attentionCount, "пункт", "пункта", "пунктов")}`
    : attentionCount > 0
      ? recommendationsText
      : "Рекомендаций нет";
  const limitedResultText = limitedCount > 0
    ? `${limitedCount} ${pluralRu(limitedCount, "пункт", "пункта", "пунктов")} ${limitedCount === 1 ? "не полностью проверен" : "не полностью проверены"}`
    : null;
  const reportCode = payload.publicToken ?? token;
  const masterName = payload.master?.name || payload.master?.login || "мастер-диагност";
  const masterMasked = maskLogin(payload.master?.login || payload.master?.name);
  const masterShortName = masterName.split(/\s+/u).filter(Boolean)[0] || masterMasked;
  const verdictText = verdict(crit, warn);
  const clientFirstName = (payload.clientName || "клиент").split(" ")[0] || "клиент";
  const primaryMessenger = (payload.publicReportPrimaryMessenger || "telegram").toLowerCase();
  const publicTelegramUsername = telegramUsername(payload.publicTelegramUsername ?? payload.publicTelegramUrl ?? null);
  const publicTelegramHref =
    primaryMessenger === "telegram"
      ? telegramUrl(payload.publicTelegramUrl) ?? (publicTelegramUsername ? `https://t.me/${publicTelegramUsername}` : null)
      : null;
  const publicPhone = payload.publicPhone || REPORT_PHONE;
  const publicPhoneHref = publicPhone ? `tel:${publicPhone.replace(/[^\d+]/gu, "")}` : REPORT_PHONE_HREF;
  const publicBookingUrl = payload.publicBookingUrl || BOOKING_HREF;
  const publicSite = payload.publicSiteUrl || "tamgdemaslo.ru";
  const publicAddress = payload.publicAddress || "Калининград";
  const nextStepTail = attentionCount > 0
    ? "объясним рекомендации и подскажем, что делать дальше."
    : "ответим на вопросы по отчёту и подскажем, что проверить при следующем визите.";
  const nextStepText = publicTelegramHref ? `Напишите нам — ${nextStepTail}` : `Позвоните нам — ${nextStepTail}`;
  const footerCopy = attentionCount > 0
    ? `Отчёт отражает состояние автомобиля на момент диагностики (${formatNumericDate(reportDate)}). Рекомендации помогают спланировать обслуживание и не заменяют отдельное согласование работ.`
    : `Отчёт отражает состояние автомобиля на момент диагностики (${formatNumericDate(reportDate)}). Если останутся вопросы по отчёту, мастер подскажет следующий шаг.`;
  const publicReportUrl = payload.reportUrl.replace(/\/print\/?$/, "").replace(/\/$/, "");
  const pdfUrl = `${publicReportUrl}/pdf`;
  const reportShareLabel = `tgm.report/${reportCode}`;
  const vehicleSummaryMeta = [
    formatNumericDate(reportDate),
    payload.vehicle.mileage != null ? `${formatMileage(payload.vehicle.mileage)} км` : null,
    `мастер ${masterShortName}`,
  ].filter(Boolean).join(" · ");
  const blocksForReport = payload.blocks.map((block, index) => ({
    ...block,
    num: String(index + 1).padStart(2, "0"),
    items: block.items.filter((item) => item.showInReport !== false),
  }));
  const checkColumnBreak = Math.ceil(blocksForReport.length / 2);
  const checkColumns = [
    blocksForReport.slice(0, checkColumnBreak),
    blocksForReport.slice(checkColumnBreak),
  ].filter((column) => column.length > 0);
  const compactStats = [
    { status: "good", value: good, label: "В норме" },
    { status: "warn", value: warn, label: "Внимание" },
    { status: "crit", value: crit, label: "Критично" },
    { status: "limited", value: limitedCount, label: "Не полностью" },
  ];
  const printPhotoSectionNumber = String((recommendations.length > 0 ? 1 : 0) + 1).padStart(2, "0");
  const printChecklistSectionNumber = String((recommendations.length > 0 ? 1 : 0) + (photos.length > 0 ? 1 : 0) + 1).padStart(2, "0");
  const publicPhotoSectionNumber = String((recommendations.length > 0 ? 1 : 0) + 1).padStart(2, "0");
  const publicChecklistSectionNumber = String((recommendations.length > 0 ? 1 : 0) + (photos.length > 0 ? 1 : 0) + 1).padStart(2, "0");
  const publicNextStepSectionNumber = String((recommendations.length > 0 ? 1 : 0) + (photos.length > 0 ? 1 : 0) + 2).padStart(2, "0");

  if (mode === "online") {
    return (
      <main className="diag-client-report-page is-public">
        <article className="tgm-client-report tgm-public-report grain">
          <header className="tgm-public-top report-mobile-container">
            <img src="/brand/logo-wordmark-light.svg" alt="Там где масло" />
            <div>
              <span>Клиентский отчёт</span>
              <small>{formatNumericDate(reportDate)}</small>
            </div>
          </header>

          <section className="tgm-public-hero report-mobile-container">
            <div className="tgm-public-hero-copy">
              <div className="tgm-public-vehicle-summary">
                <span className="tgm-public-eyebrow">Отчёт диагностики</span>
                <h1>{payload.vehicle.title || "Автомобиль"}</h1>
                <strong>{checkedClientText}</strong>
                <span>{vehicleSummaryMeta}</span>
                <details>
                  <summary>Данные автомобиля</summary>
                  <dl>
                    <div><dt>Дата</dt><dd>{formatNumericDate(reportDate)}</dd></div>
                    <div><dt>Мастер</dt><dd>{masterName}</dd></div>
                    <div><dt>Пробег</dt><dd>{formatMileage(payload.vehicle.mileage)} км</dd></div>
                    <div><dt>Номер</dt><dd>{payload.vehicle.licensePlate || "не указан"}</dd></div>
                    {payload.vehicle.vin && <div><dt>VIN</dt><dd>{payload.vehicle.vin}</dd></div>}
                  </dl>
                </details>
              </div>
              <div className="tgm-public-main-result">
                <span className="tgm-public-eyebrow">Итог</span>
                <strong>{mainResultTitle}</strong>
                <p>{mainResultSubtitle}</p>
                {limitedResultText && <small>{limitedResultText}</small>}
              </div>
              <div className="tgm-public-compact-stats" aria-label="Краткая статистика диагностики">
                <strong>Сводка по статусам</strong>
                <div>
                  {compactStats.map((item) => (
                    <span className={item.status} key={item.status}>
                      <b>{item.value}</b>
                      <em>{item.label}</em>
                    </span>
                  ))}
                </div>
              </div>
            </div>
            {vehiclePhotoReportUrl && (
              <figure className="tgm-public-vehicle-photo">
                <img src={vehiclePhotoReportUrl} alt={vehiclePhoto?.caption || payload.vehicle.title || "Фото автомобиля"} loading="eager" decoding="async" />
                <figcaption>{vehiclePhoto?.caption || "Фото автомобиля"}</figcaption>
              </figure>
            )}
          </section>

          {recommendations.length > 0 && (
            <section className="tgm-public-section report-mobile-container">
              <div className="tgm-public-section-head">
                <span>01 / рекомендации</span>
                <h2>Что требует внимания</h2>
                <p>Сначала показаны самые важные пункты.</p>
              </div>
              <div className="tgm-public-recs">
                {recommendations.map((item, index) => {
                  const normalized = normalizeStatus(item.status);
                  const result = itemResultText(item);
                  const recommendation = itemRecommendationText(item);
                  const chips = detailChips(item, result, recommendation);
                  return (
                    <article className={`tgm-public-rec ${normalized}`} key={`${item.blockTitle}-${item.code}`}>
                      <div className="tgm-public-rec-top">
                        <span className="tgm-public-rec-priority">{String(index + 1).padStart(2, "0")}</span>
                        <div className="tgm-public-rec-title">
                          <h3>{clientItemTitle(item.title)}</h3>
                          <small>{item.blockTitle}</small>
                        </div>
                        <span className={`tgm-public-rec-status ${normalized}`}>{statusLabel(normalized)}</span>
                      </div>
                      <div className="tgm-public-rec-body">
                        <div className="tgm-public-rec-block">
                          <span>Что обнаружено</span>
                          <p>{result}</p>
                        </div>
                      </div>
                      {shouldShowRecommendation(result, recommendation) && (
                        <div className="tgm-public-rec-note">
                          <span>Что рекомендуем</span>
                          <strong>{recommendation}</strong>
                        </div>
                      )}
                      {item.photos.length > 0 && (
                        <div className={`tgm-public-rec-photos ${item.photos.length === 1 ? "is-single" : ""}`}>
                          {item.photos.map((photo, photoIndex) => (
                            <a
                              className={`tgm-public-rec-photo ${photoIndex === 0 ? "is-main" : ""}`}
                              href={photo.url}
                              target="_blank"
                              rel="noreferrer"
                              key={photo.id}
                              onClick={(event) => {
                                event.preventDefault();
                                setLightboxPhoto({ ...photo, itemTitle: clientItemTitle(item.title), status: normalized });
                              }}
                              aria-label={`Открыть фото: ${photo.caption || clientItemTitle(item.title)}`}
                            >
                              <img src={photo.url} alt={photo.caption || clientItemTitle(item.title) || "Фото диагностики"} loading="lazy" decoding="async" />
                              <span className="tgm-public-rec-photo-caption">{photo.caption || clientItemTitle(item.title)}</span>
                              <span className="tgm-public-photo-open">Открыть фото</span>
                            </a>
                          ))}
                        </div>
                      )}
                      {chips.length > 0 && (
                        <div className="tgm-public-detail-chips" aria-label="Признаки">
                          {chips.map((chip) => <span className="tgm-public-chip" key={chip}>{chip}</span>)}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
          )}
  
            {generalPhotos.length > 0 && (
            <section className="tgm-public-section report-mobile-container">
              <div className="tgm-public-section-head">
                <span>{publicPhotoSectionNumber} / фотоотчёт</span>
                <h2>Дополнительные фото осмотра</h2>
                <p>Снимки, которые дополняют диагностику.</p>
              </div>
              <div className="tgm-public-photos">
                {generalPhotos.map((photo, index) => (
                  <a
                    className="tgm-public-photo"
                    href={photo.url}
                    target="_blank"
                    rel="noreferrer"
                    key={`${photo.id}-${index}`}
                    onClick={(event) => {
                      event.preventDefault();
                      setLightboxPhoto(photo);
                    }}
                    aria-label={`Открыть фото: ${photo.caption || photo.itemTitle || "Фото диагностики"}`}
                  >
                    <img src={photo.url} alt={photo.caption || photo.itemTitle || "Фото диагностики"} loading="lazy" decoding="async" />
                    <span className="tgm-public-photo-status" style={{ background: statusColor(photo.status) }} />
                    <div className="tgm-public-photo-caption">
                      <strong>{photo.itemTitle || "Фото диагностики"}</strong>
                      <span>{photo.caption || "Снимок с осмотра"}</span>
                    </div>
                  </a>
                ))}
              </div>
            </section>
          )}

          <section className="tgm-public-section report-mobile-container">
            <div className="tgm-public-section-head">
              <span>{publicChecklistSectionNumber} / полный список</span>
              <h2>Что проверили</h2>
            </div>
            <div className="tgm-public-accordions">
                {blocksForReport.map((block) => {
                  const hasAttention = block.items.some((item) => isAttentionStatus(item.status));
                  const openByDefault = hasAttention;
                  return (
                  <details className="tgm-public-accordion" open={openByDefault} key={block.code}>
                    <summary>
                      <div className="tgm-public-accordion-title">
                        <span>{block.title}</span>
                        <b>{blockSummary(block.items)}</b>
                      </div>
                      <strong className="tgm-public-accordion-action">
                        <span className="is-show">Показать пункты</span>
                        <span className="is-hide">Скрыть пункты</span>
                      </strong>
                    </summary>
                    <div className="tgm-public-checks">
                      {block.items.map((item) => {
                        const normalized = normalizeStatus(item.status);
                        return (
                          <div className="tgm-public-check" key={item.code}>
                            <span className="tgm-public-mark" style={{ background: statusColor(normalized) }}>{statusIcon(normalized)}</span>
                            <div>
                                <strong>{clientItemTitle(item.title)}</strong>
                                <span>{itemChecklistText(item)}</span>
                              </div>
                            <em className={`tgm-public-check-status ${normalized}`}>{statusLabel(normalized)}</em>
                          </div>
                        );
                      })}
                    </div>
                  </details>
                );
              })}
            </div>
          </section>

            <section className="tgm-public-next report-mobile-container">
              <div>
                <span>{publicNextStepSectionNumber} / что дальше</span>
                <h2>Остались вопросы?</h2>
                <p>{nextStepText}</p>
              </div>
            <div className="tgm-public-actions">
              {publicTelegramHref && <a className="is-primary" href={publicTelegramHref} target="_blank" rel="noreferrer">Написать в Telegram</a>}
              <a href={publicPhoneHref}>Позвонить</a>
              <a href={publicBookingUrl}>Записаться</a>
            </div>
          </section>

            <footer className="tgm-public-footer report-mobile-container">
              <img src="/brand/monogram-light.svg" alt="" aria-hidden />
              <div>
                <strong>Там где масло</strong>
                <p>{footerCopy}</p>
              <div className="tgm-public-footer-meta">
                <span>{publicPhone}</span>
                {publicTelegramUsername && <span>Telegram · @{publicTelegramUsername}</span>}
                <span>{publicSite}</span>
                <span>{publicAddress}</span>
              </div>
            </div>
          </footer>

          <nav className={`tgm-public-sticky no-print ${publicTelegramHref ? "has-telegram" : "no-telegram"}`} aria-label="Действия клиента">
            {publicTelegramHref && <a className="is-primary" href={publicTelegramHref} target="_blank" rel="noreferrer">Написать</a>}
            <a href={publicPhoneHref}>Позвонить</a>
            <a href={publicBookingUrl}>Записаться</a>
          </nav>

          {lightboxPhoto && (
            <div className="tgm-public-lightbox no-print" role="dialog" aria-modal="true" aria-label="Фото диагностики" onClick={() => setLightboxPhoto(null)}>
              <div className="tgm-public-lightbox-panel" onClick={(event) => event.stopPropagation()}>
                <button type="button" onClick={() => setLightboxPhoto(null)} aria-label="Закрыть фото">×</button>
                <img src={lightboxPhoto.url} alt={lightboxPhoto.caption || lightboxPhoto.itemTitle || "Фото диагностики"} />
                <div>
                  <strong>{lightboxPhoto.itemTitle}</strong>
                  <span>{lightboxPhoto.caption || "Фото диагностики"}</span>
                </div>
              </div>
            </div>
          )}
        </article>
      </main>
    );
  }

  return (
    <main className="diag-print-screen is-print">
      <div className="diag-print-toolbar no-print">
        <a className="btn" href={payload.reportUrl}><ChevronLeft size={16} /> Онлайн-отчёт</a>
        <div style={{ flex: 1 }} />
        <span>Клиентский отчёт · A4 · {photos.length} фото диагностики</span>
        {autoPrint ? (
          <button className="btn primary" type="button" onClick={() => setAutoPrintRequested(true)}>
            <Printer size={16} /> Открыть печать
          </button>
        ) : (
          <a className="btn primary" href={pdfUrl}><Printer size={16} /> Печать / PDF</a>
        )}
      </div>

      <article className="paper-a4 rep">
        <div className="rep-hero">
          <div className="rep-hero-top">
            <span className="rep-wordmark">ТАМ ГДЕ МАСЛО.</span>
            <span className="rep-hero-meta">ОТЧЁТ ДИАГНОСТИКИ · {reportCode}</span>
          </div>
          <div className="rep-hero-body">
            <div>
              <div className="rep-eyebrow rust">Привет, {clientFirstName}</div>
              <h1 className="rep-title">
                {payload.vehicle.title}<span className="rust">.</span><br />
                <span className="muted2">{checkedText}<span className="rust">.</span></span>
              </h1>
              <div className="rep-facts">
                <div className="rep-fact"><div className="k">Пробег</div><div className="v">{formatMileage(payload.vehicle.mileage)}</div><div className="u">км</div></div>
                <div className="rep-fact"><div className="k">Гос. номер</div><div className="v">{payload.vehicle.licensePlate || "—"}</div><div className="u">{payload.vehicle.vin ? `VIN ...${payload.vehicle.vin.slice(-6)}` : "авто"}</div></div>
                <div className="rep-fact"><div className="k">Дата</div><div className="v">{formatDay(reportDate)}</div><div className="u">{formatYearTime(reportDate)}</div></div>
                <div className="rep-fact"><div className="k">Мастер</div><div className="v sm">{masterName.split(" ").slice(-1)[0] || masterName}</div><div className="u">{masterName.split(" ")[0] || masterMasked}</div></div>
              </div>
            </div>
            <CarSilhouette
              vehicleTitle={payload.clientName?.split(" ")[1] || payload.clientName || payload.vehicle.title}
              vin={payload.vehicle.vin}
              photoUrl={vehiclePhotoPrintUrl}
              photoAlt={vehiclePhoto?.caption || payload.vehicle.title || "Фото автомобиля"}
            />
          </div>
          <div className="rep-chequered" />
        </div>

        <div className="rep-verdict">
          <div className="rep-v-cell good"><div className="n">{good}</div><div className="l">Хорошо</div></div>
          <div className="rep-v-cell warn"><div className="n">{warn}</div><div className="l">Внимание</div></div>
          <div className="rep-v-cell crit"><div className="n">{crit}</div><div className="l">Критично</div></div>
          <div className="rep-v-cell ind"><div className="n">{indirect}</div><div className="l">Косвенно</div></div>
          <div className="rep-v-statement">
            <div className="rep-eyebrow">Итог</div>
            <div className="s">Машина {noAccessCount > 0 && warn === 0 && crit === 0 ? "без критичных замечаний" : verdictText}</div>
          </div>
        </div>

          {recommendations.length > 0 && (
            <div className="rep-sec">
              <div className="rep-sec-head">
                <span className="rep-sec-num">01</span>
                <div><div className="rep-eyebrow rust">Что предлагаем</div><h2 className="rep-h2">Точки внимания · {recommendations.length}</h2></div>
            </div>
            <div className="rep-recs">
              {recommendations.map((item) => {
                const normalized = normalizeStatus(item.status);
                const result = itemResultText(item);
                const recommendation = itemRecommendationText(item);
                return (
                  <div className="rep-rec" style={{ borderLeftColor: statusColor(normalized) }} key={`${item.blockTitle}-${item.code}`}>
                    <div className="rep-rec-head">
                      <h3>{item.title}</h3>
                      <span className="rep-rec-tag" style={{ background: statusColor(normalized) }}>{statusLabel(normalized)}</span>
                    </div>
                    <div className="rep-rec-desc">
                      {result}
                      {shouldShowRecommendation(result, recommendation) && <> <b>{recommendation}</b></>}
                    </div>
                    {(item.comment || item.reportText?.sourceText) && (
                      <div className="rep-rec-quote">«{item.comment || item.reportText?.sourceText}»<br /><span>— {masterName.split(" ")[0]}, мастер-диагност</span></div>
                    )}
                  </div>
                );
              })}
            </div>
            </div>
          )}
  
          {photos.length > 0 && (
            <div className="rep-sec">
              <div className="rep-sec-head">
                <span className="rep-sec-num">{printPhotoSectionNumber}</span>
                <div><div className="rep-eyebrow rust">Как это выглядит</div><h2 className="rep-h2">Фотоотчёт · {photos.length}</h2></div>
              </div>
            <div className="rep-photos">
              {photos.map((photo, index) => <PhotoTile key={`${photo.id}-${index}`} photo={photo} index={index} status={photo.status} />)}
            </div>
            <div className="rep-photo-note">Снимки сделаны мастером в процессе осмотра {formatNumericDate(reportDate)}.</div>
          </div>
        )}

          <div className="rep-sec rep-check-sec">
            <div className="rep-sec-head">
              <span className="rep-sec-num">{printChecklistSectionNumber}</span>
              <div><div className="rep-eyebrow rust">Полный список</div><h2 className="rep-h2">Что мы посмотрели</h2></div>
          </div>
	          <div className="rep-legend">
	            {["good", "warn", "crit", "no-access", "by-mileage", "by-client"].map((key) => {
	              const legendLabel = key === "no-access" ? statusLabel(key) : payload.statusLegend?.[key]?.label ?? statusLabel(key);
	              return <span className="rep-key" key={key}><span className="rep-mark" style={{ background: statusColor(key) }}>{statusIcon(key)}</span>{legendLabel}</span>;
	            })}
	          </div>
          <div className="rep-check">
            {checkColumns.map((column, columnIndex) => (
              <div className="rep-check-col" key={`check-col-${columnIndex}`}>
                {column.map((block) => (
                  <div className="rep-block" key={block.code}>
                    <div className="rep-block-head"><span className="rep-block-no">{block.num}</span>{block.title}</div>
                    {block.items.map((item) => (
                        <div className="rep-check-row" key={item.code}>
                          <span className="rep-mark sm" style={{ background: statusColor(item.status) }}>{statusIcon(item.status)}</span>
                          <span className="rep-check-label">{item.title}</span>
                          <span className="rep-check-val">{itemChecklistText(item)}</span>
                        </div>
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        <div className="rep-foot">
          <div className="rep-foot-cta">
              <div>
                <div className="rep-eyebrow rust">Что дальше</div>
                <div className="rep-foot-q">{recommendations.length > 0 ? "Запишем на работы по точкам внимания?" : "Остались вопросы по отчёту?"}</div>
                <div className="rep-foot-sub">{recommendations.length > 0 ? "Подберём материалы заранее, согласуем время. Пишите в Telegram или звоните." : "Ответим на вопросы по отчёту и запишем на отдельную проверку. Пишите в Telegram или звоните."}</div>
            </div>
            <div className="rep-foot-contact">
              <div className="ph">{REPORT_PHONE}</div>
              <div className="tg">Telegram · @tamgdemaslo</div>
              <div className="link">Онлайн-версия: {reportShareLabel}</div>
            </div>
          </div>
          <div className="rep-sign">
            <div className="rep-sign-cell"><div className="rep-sign-line" /><div className="rep-sign-lbl">Мастер · {masterName}</div></div>
            <div className="rep-sign-cell"><div className="rep-sign-line" /><div className="rep-sign-lbl">Клиент · подпись</div></div>
            <div className="rep-sign-cell"><div className="rep-sign-line" /><div className="rep-sign-lbl">Дата ознакомления</div></div>
          </div>
            <div className="rep-disclaimer">
              * «В порядке» означает: критичных проблем для дальнейшей эксплуатации не выявлено. Пункты «внимание» и «критично» — поводы для согласования работ.
              Отметки «по пробегу» и «со слов клиента» приведены как информационный контекст. Карта отражает состояние авто на момент осмотра ({formatNumericDate(reportDate)}).
            </div>
        </div>
      </article>
    </main>
  );
}
