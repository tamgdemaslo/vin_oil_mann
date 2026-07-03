"use client";
/* eslint-disable @next/next/no-img-element -- report renders brand assets and diagnostic photos in browser/PDF layouts. */

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, Printer } from "lucide-react";
import { formatServiceDayMonth, formatServiceTime, toServiceDateInput } from "@/lib/date-time";

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
  photos: { id: string; caption: string; url: string }[];
};

type ReportPayload = {
  reportUrl: string;
  publicToken?: string;
  vehicle: {
    title: string;
    vin?: string | null;
    licensePlate?: string | null;
    mileage?: number | null;
  };
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
};

const REPORT_PHONE = "+7 (995) 054-58-59";
const REPORT_PHONE_HREF = "tel:+79950545859";
const WHATSAPP_HREF = "https://wa.me/79950545859";
const BOOKING_HREF = "/client-site#/vin";

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
  if (normalized === "crit") return "#B91C1C";
  if (normalized === "warn") return "#B45309";
  if (normalized === "good") return "#15803D";
  if (normalized === "no-access") return "#6B7280";
  if (normalized === "by-mileage") return "#1D4ED8";
  if (normalized === "by-client") return "#7C3AED";
  return "#A3A3A3";
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

function itemShortResult(item: ReportItem): string {
  const text = item.reportText?.shortText?.trim();
  if (text) return text;
  return item.value || item.statusLabel || statusLabel(item.status);
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

function verdict(crit: number, warn: number, indirect: number): string {
  if (crit > 0) return "требует внимания";
  if (warn > 0 || indirect > 0) return "есть точки внимания";
  return "в порядке";
}

function pluralRu(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

function CarSilhouette({ vehicleTitle, vin }: { vehicleTitle: string; vin?: string | null }) {
  return (
    <div className="rep-hero-car">
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
      <div className="rep-car-tag">{vehicleTitle} · VIN {vin ? `...${vin.slice(-6)}` : "—"}</div>
    </div>
  );
}

function PhotoTile({ photo, index, status }: { photo: { id: string; caption: string; url: string; itemTitle: string }; index: number; status: string }) {
  return (
    <figure className="rep-photo" key={`${photo.id}-${index}`}>
      <div className="rep-photo-img" style={{ backgroundImage: `url(${photo.url})` }}>
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

function OnlineCarSilhouette({ label }: { label: string }) {
  return (
    <div className="tgm-car-card">
      <div className="tgm-car-glow" />
      <svg viewBox="0 0 440 280" preserveAspectRatio="xMidYMid slice" aria-hidden>
        <rect x="0" y="232" width="440" height="48" fill="#000" />
        <line x1="0" y1="232" x2="440" y2="232" stroke="#C2410C" strokeWidth="1" />
        <path d="M44 206 L78 168 L150 150 L250 147 L320 152 L366 172 L398 206 L402 212 L396 222 L380 222 L368 232 Q348 240 328 230 L320 222 L128 222 L116 232 Q96 240 76 230 L66 222 L54 222 Z" fill="#3D3D3D" />
        <path d="M150 158 L210 150 L280 151 L318 166 L300 196 L162 196 Z" fill="#0a0a0a" />
        <line x1="232" y1="150" x2="232" y2="196" stroke="#1a1a1a" strokeWidth="2" />
        <ellipse cx="372" cy="196" rx="20" ry="7" fill="#F5F2ED" opacity="0.85" />
        <ellipse cx="372" cy="196" rx="12" ry="3.5" fill="#C2410C" />
        <circle cx="104" cy="222" r="22" fill="#0a0a0a" stroke="#3a3a3a" strokeWidth="1.5" />
        <circle cx="104" cy="222" r="10" fill="#1a1a1a" stroke="#3a3a3a" />
        <circle cx="344" cy="222" r="22" fill="#0a0a0a" stroke="#3a3a3a" strokeWidth="1.5" />
        <circle cx="344" cy="222" r="10" fill="#1a1a1a" stroke="#3a3a3a" />
        <circle cx="222" cy="190" r="15" fill="#C2410C" opacity="0.9" />
        <text x="222" y="196" textAnchor="middle" fontFamily="Oswald" fontSize="18" fontWeight="700" fill="#0a0a0a">76</text>
      </svg>
      <div className="tgm-car-region">76 · KGD</div>
      <div className="tgm-car-meta">{label}</div>
    </div>
  );
}

export function DiagnosticPublicReport({ token, mode = "online" }: DiagnosticPublicReportProps) {
  const [payload, setPayload] = useState<ReportPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      indirect: visibleItems.filter((item) => ["no-access", "by-mileage", "by-client"].includes(normalizeStatus(item.status))).length,
    };
  }, [visibleItems]);

  if (loading) return <main className="diag-print-screen"><section className="diag-report-state">Загрузка отчёта...</section></main>;
  if (error || !payload) return <main className="diag-print-screen"><section className="diag-report-state is-error">{error ?? "Отчёт не найден"}</section></main>;

  const recommendations = visibleItems
    .filter((item) => item.recommendation || ["warn", "crit", "no-access", "by-mileage", "by-client"].includes(normalizeStatus(item.status)))
    .sort((a, b) => {
      const order: Record<string, number> = { crit: 0, warn: 1, "no-access": 2, "by-mileage": 2, "by-client": 2 };
      return (order[normalizeStatus(a.status)] ?? 3) - (order[normalizeStatus(b.status)] ?? 3);
    });
  const photos = visibleItems.flatMap((item) => item.photos.map((photo) => ({ ...photo, itemTitle: item.title, status: normalizeStatus(item.status) })));
  const hasRealItems = reportCounts.total > 0;
  const good = hasRealItems ? reportCounts.good : payload.counts.good ?? payload.counts.normal ?? 0;
  const warn = hasRealItems ? reportCounts.warn : payload.counts.warn ?? payload.counts.attention ?? 0;
  const crit = hasRealItems ? reportCounts.crit : payload.counts.crit ?? payload.counts.replace ?? 0;
  const indirect = hasRealItems ? reportCounts.indirect : payload.counts.indirect ?? 0;
  const total = hasRealItems ? reportCounts.total : payload.counts.total || visibleItems.length;
  const reportDate = payload.completedAt ?? payload.startedAt;
  const checkedText = `${total} ${pluralRu(total, "пункт", "пункта", "пунктов")} проверены`;
  const checkedClientText = `Проверено ${total} ${pluralRu(total, "пункт", "пункта", "пунктов")}`;
  const attentionCount = recommendations.length;
  const attentionPointsText = attentionCount > 0
    ? `Есть ${attentionCount} ${pluralRu(attentionCount, "точка", "точки", "точек")} внимания`
    : "Критичных замечаний нет";
  const recommendationsText = attentionCount > 0
    ? `Есть ${attentionCount} ${pluralRu(attentionCount, "рекомендация", "рекомендации", "рекомендаций")}`
    : "Рекомендаций по срочным работам нет";
  const reportCode = payload.publicToken ?? token;
  const masterName = payload.master?.name || payload.master?.login || "мастер-диагност";
  const masterMasked = maskLogin(payload.master?.login || payload.master?.name);
  const percentGood = Math.round((good / (total || 1)) * 100);
  const verdictText = verdict(crit, warn, indirect);
  const vehicleShort = payload.vehicle.title.split(/\s+/).slice(0, 3).join(" ");
  const clientFirstName = (payload.clientName || "клиент").split(" ")[0] || "клиент";
  const publicReportUrl = payload.reportUrl.replace(/\/print\/?$/, "").replace(/\/$/, "");
  const pdfUrl = `${publicReportUrl}/pdf`;
  const reportShareLabel = `tgm.report/${reportCode}`;
  const nextVisitDate = (() => {
    const date = new Date(reportDate);
    if (Number.isNaN(date.getTime())) return "следующему визиту";
    date.setMonth(date.getMonth() + 6);
    return formatNumericDate(date.toISOString());
  })();
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

  if (mode === "online") {
    return (
      <main className="diag-client-report-page is-public">
        <article className="tgm-client-report tgm-public-report grain">
          <header className="tgm-public-top">
            <img src="/brand/logo-wordmark-light.svg" alt="Там где масло" />
            <span>Отчёт диагностики</span>
          </header>

          <section className="tgm-public-hero">
            <div className="tgm-public-hero-copy">
              <span className="tgm-public-eyebrow">Привет, {clientFirstName}</span>
              <h1>Автомобиль проверен</h1>
              <p>{checkedClientText}. {recommendationsText}.</p>
              <div className="tgm-public-vehicle">{payload.vehicle.title || "Ваш автомобиль"}</div>
            </div>
            <OnlineCarSilhouette label={vehicleShort || "Диагностика готова"} />
            <dl className="tgm-public-facts">
              <div>
                <dt>Дата</dt>
                <dd>{formatNumericDate(reportDate)}</dd>
              </div>
              <div>
                <dt>Мастер</dt>
                <dd>{masterName}</dd>
              </div>
              <div>
                <dt>Пробег</dt>
                <dd>{formatMileage(payload.vehicle.mileage)} км</dd>
              </div>
              <div>
                <dt>Номер</dt>
                <dd>{payload.vehicle.licensePlate || "не указан"}</dd>
              </div>
            </dl>
          </section>

          <section className="tgm-public-summary" aria-label="Сводка диагностики">
            <div className="tgm-public-kpi is-good">
              <span>{good}</span>
              <strong>Хорошо</strong>
            </div>
            <div className="tgm-public-kpi is-warn">
              <span>{warn}</span>
              <strong>Внимание</strong>
            </div>
            <div className="tgm-public-kpi is-crit">
              <span>{crit}</span>
              <strong>Критично</strong>
            </div>
            <div className="tgm-public-kpi is-indirect">
              <span>{indirect}</span>
              <strong>Косвенно</strong>
            </div>
          </section>

          <section className="tgm-public-result">
            <span>Итог</span>
            <h2>{attentionPointsText}</h2>
            <p>{percentGood}% пунктов без замечаний. Состояние отражает результат осмотра на {formatNumericDate(reportDate)}.</p>
          </section>

          <section className="tgm-public-section">
            <div className="tgm-public-section-head">
              <span>Точки внимания</span>
              <h2>{recommendationsText}</h2>
            </div>
            {recommendations.length > 0 ? (
              <div className="tgm-public-recs">
                {recommendations.map((item) => {
                  const normalized = normalizeStatus(item.status);
                  const result = itemResultText(item);
                  const recommendation = itemRecommendationText(item);
                  return (
                    <article className={`tgm-public-rec ${normalized}`} key={`${item.blockTitle}-${item.code}`}>
                      <div className="tgm-public-rec-head">
                        <h3>{item.title}</h3>
                        <span>{statusLabel(normalized)}</span>
                      </div>
                      <p>
                        {result}
                        {shouldShowRecommendation(result, recommendation) && <> <b>{recommendation}</b></>}
                      </p>
                      {(item.reportText?.shortText || item.value || item.statusLabel) && (
                        <div className="tgm-public-measure">
                          <span>Итог</span>
                          <strong>{itemShortResult(item)}</strong>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="tgm-public-empty">Срочных рекомендаций нет. Плановое обслуживание можно проходить по регламенту.</div>
            )}
          </section>

          <section className="tgm-public-section">
            <div className="tgm-public-section-head">
              <span>Фотоотчёт</span>
              <h2>Фото с диагностики</h2>
            </div>
            {photos.length > 0 ? (
              <div className="tgm-public-photos">
                {photos.map((photo, index) => (
                  <a className="tgm-public-photo" href={photo.url} target="_blank" rel="noreferrer" key={`${photo.id}-${index}`}>
                    <img src={photo.url} alt={photo.caption || photo.itemTitle || "Фото диагностики"} />
                    <span className="tgm-public-photo-status" style={{ background: statusColor(photo.status) }} />
                    <span>{photo.caption || photo.itemTitle || "Фото диагностики"}</span>
                  </a>
                ))}
              </div>
            ) : (
              <div className="tgm-public-empty">Фото к этому отчёту не добавлены.</div>
            )}
          </section>

          <section className="tgm-public-section">
            <div className="tgm-public-section-head">
              <span>Полный список</span>
              <h2>Что проверили</h2>
            </div>
            <div className="tgm-public-accordions">
              {blocksForReport.map((block) => {
                const hasAttention = block.items.some((item) => ["warn", "crit", "no-access", "by-mileage", "by-client"].includes(normalizeStatus(item.status)));
                return (
                  <details className="tgm-public-accordion" open={hasAttention} key={block.code}>
                    <summary>
                      <span>{block.title}</span>
                      <b>{block.items.length} {pluralRu(block.items.length, "пункт", "пункта", "пунктов")}</b>
                    </summary>
                    <div className="tgm-public-checks">
                      {block.items.map((item) => {
                        const normalized = normalizeStatus(item.status);
                        return (
                          <div className="tgm-public-check" key={item.code}>
                            <span className="tgm-public-mark" style={{ background: statusColor(normalized) }}>{statusIcon(normalized)}</span>
                            <div>
                              <strong>{item.title}</strong>
                              <span>{itemShortResult(item)}</span>
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

          <section className="tgm-public-next">
            <div>
              <span>Что дальше</span>
              <h2>Поможем с рекомендациями</h2>
              <p>Напишите нам, позвоните или выберите удобное время. Подготовим материалы заранее и напомним о следующей проверке к {nextVisitDate}.</p>
            </div>
            <div className="tgm-public-actions">
              <a className="is-primary" href={WHATSAPP_HREF}>Написать</a>
              <a href={REPORT_PHONE_HREF}>Позвонить</a>
              <a href={BOOKING_HREF}>Записаться</a>
            </div>
          </section>

          <footer className="tgm-public-footer">
            <img src="/brand/monogram-light.svg" alt="" aria-hidden />
            <p>Отчёт отражает состояние автомобиля на момент диагностики. Рекомендации помогают спланировать обслуживание и не заменяют отдельное согласование работ.</p>
          </footer>

          <nav className="tgm-public-sticky no-print" aria-label="Действия клиента">
            <a className="is-primary" href={WHATSAPP_HREF}>Написать</a>
            <a href={REPORT_PHONE_HREF}>Позвонить</a>
            <a href={BOOKING_HREF}>Записаться</a>
          </nav>
        </article>
      </main>
    );
  }

  return (
    <main className="diag-print-screen is-print">
      <div className="diag-print-toolbar no-print">
        <a className="btn" href={payload.reportUrl}><ChevronLeft size={16} /> Онлайн-отчёт</a>
        <div style={{ flex: 1 }} />
        <span>Клиентский отчёт · A4 · {photos.length} фото</span>
        <a className="btn primary" href={pdfUrl}><Printer size={16} /> Печать / PDF</a>
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
            <CarSilhouette vehicleTitle={payload.clientName?.split(" ")[1] || payload.clientName || payload.vehicle.title} vin={payload.vehicle.vin} />
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
            <div className="s">Машина {verdictText}</div>
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
              <span className="rep-sec-num">02</span>
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
            <span className="rep-sec-num">03</span>
            <div><div className="rep-eyebrow rust">Полный список</div><h2 className="rep-h2">Что мы посмотрели</h2></div>
          </div>
          <div className="rep-legend">
            {["good", "warn", "crit", "no-access", "by-mileage", "by-client"].map((key) => (
              <span className="rep-key" key={key}><span className="rep-mark" style={{ background: statusColor(key) }}>{statusIcon(key)}</span>{payload.statusLegend?.[key]?.label ?? statusLabel(key)}</span>
            ))}
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
                        <span className="rep-check-val">{itemShortResult(item)}</span>
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
              <div className="rep-foot-q">Запишем на работы по точкам внимания?</div>
              <div className="rep-foot-sub">Подберём материалы заранее, согласуем время. Пишите в Telegram или звоните.</div>
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
            * «В порядке» означает: критичных проблем для дальнейшей эксплуатации не выявлено. Пункты «внимание», «по пробегу» и «со слов клиента» — рекомендации, а не предписания.
            «Доступ затруднён» — пункт не осматривался напрямую и будет проверен на следующем визите. Карта отражает состояние авто на момент осмотра ({formatNumericDate(reportDate)}).
          </div>
        </div>
      </article>
    </main>
  );
}
