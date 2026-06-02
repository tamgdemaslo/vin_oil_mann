"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, Copy, Phone, Printer } from "lucide-react";

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
  printMode?: boolean;
};

const REPORT_PHONE = "+7 (995) 054-58-59";
const REPORT_PHONE_HREF = "tel:+79950545859";
const WHATSAPP_HREF = "https://wa.me/79950545859";
const BOOKING_HREF = "/client-site#/vin";

async function fetchJson<T>(url: string): Promise<{ ok: true; data: T } | { ok: false }> {
  const response = await fetch(url);
  if (!response.ok) return { ok: false };
  try {
    return { ok: true, data: (await response.json()) as T };
  } catch {
    return { ok: false };
  }
}

function statusColor(status: string): string {
  if (status === "crit") return "#B91C1C";
  if (status === "warn") return "#B45309";
  if (status === "good") return "#15803D";
  if (status === "no-access") return "#6B7280";
  if (status === "by-mileage") return "#1D4ED8";
  if (status === "by-client") return "#7C3AED";
  return "#A3A3A3";
}

function statusIcon(status: string): string {
  if (status === "crit") return "×";
  if (status === "warn") return "!";
  if (status === "good") return "✓";
  if (status === "no-access") return "⊘";
  if (status === "by-mileage") return "≈";
  if (status === "by-client") return "”";
  return "○";
}

function statusLabel(status: string): string {
  if (status === "crit") return "Критично";
  if (status === "warn") return "Внимание";
  if (status === "good") return "Хорошо";
  if (status === "no-access") return "Доступ затруднён";
  if (status === "by-mileage") return "Вывод по пробегу";
  if (status === "by-client") return "Со слов клиента";
  return "Не проверено";
}

function formatDay(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
}

function formatYearTime(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return `${date.getFullYear()} · ${date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`;
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

function verdict(payload: ReportPayload): string {
  const crit = payload.counts.crit ?? payload.counts.replace ?? 0;
  const warn = payload.counts.warn ?? payload.counts.attention ?? 0;
  if (crit > 0) return "требует внимания";
  if (warn > 0 || payload.counts.indirect > 0) return "есть точки внимания";
  return "в порядке*";
}

function CarSilhouette({ vin }: { vin?: string | null }) {
  return (
    <div className="rep-hero-car">
      <svg viewBox="0 0 440 280" preserveAspectRatio="xMidYMid slice" aria-hidden>
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
      <div className="rep-car-tag">VIN {vin ? vin.slice(-6) : "—"}</div>
    </div>
  );
}

export function DiagnosticPublicReport({ token, printMode = false }: DiagnosticPublicReportProps) {
  const [payload, setPayload] = useState<ReportPayload | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reminder, setReminder] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      const next = await fetchJson<{ diagnostic: ReportPayload; qrDataUrl?: string }>(`/api/diagnostics/public/${encodeURIComponent(token)}`);
      if (next.ok) {
        if (!cancelled) {
          setPayload(next.data.diagnostic);
          setQrDataUrl(next.data.qrDataUrl ?? null);
          setReminder(Boolean(next.data.diagnostic.clientWantsReminder));
        }
        setLoading(false);
        return;
      }
      const legacy = await fetchJson<LegacyPayload>(`/api/diagnostic/public/${encodeURIComponent(token)}`);
      if (legacy.ok) {
        if (!cancelled) {
          setPayload(adaptLegacy(legacy.data));
          setQrDataUrl(legacy.data.qrDataUrl ?? null);
          setReminder(Boolean(legacy.data.clientWantsReminder));
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
  const recommendations = visibleItems
    .filter((item) => item.recommendation || ["warn", "crit", "no-access", "by-mileage", "by-client"].includes(item.status))
    .sort((a, b) => {
      const order: Record<string, number> = { crit: 0, warn: 1, "no-access": 2, "by-mileage": 2, "by-client": 2 };
      return (order[a.status] ?? 3) - (order[b.status] ?? 3);
    });
  const photos = visibleItems.flatMap((item) => item.photos.map((photo) => ({ ...photo, itemTitle: item.title, status: item.status })));

  async function saveReminder(next: boolean) {
    setReminder(next);
    const newApi = await fetch(`/api/diagnostics/public/${encodeURIComponent(token)}/reminder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientWantsReminder: next }),
    });
    if (!newApi.ok) {
      await fetch(`/api/diagnostic/public/${encodeURIComponent(token)}/reminder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientWantsReminder: next }),
      }).catch(() => {});
    }
  }

  if (loading) return <main className="diag-print-screen"><section className="diag-report-state">Загрузка отчёта...</section></main>;
  if (error || !payload) return <main className="diag-print-screen"><section className="diag-report-state is-error">{error ?? "Отчёт не найден"}</section></main>;

  const good = payload.counts.good ?? payload.counts.normal ?? 0;
  const warn = payload.counts.warn ?? payload.counts.attention ?? 0;
  const crit = payload.counts.crit ?? payload.counts.replace ?? 0;
  const reportDate = payload.completedAt ?? payload.startedAt;

  return (
    <main className={`diag-print-screen ${printMode ? "is-print" : "is-public"}`}>
      <div className="diag-print-toolbar no-print">
        <a href={payload.reportUrl} className="btn ghost"><ChevronLeft size={16} /> Онлайн-отчёт</a>
        <span>Клиентский отчёт · A4 · {photos.length} фото</span>
        <button className="btn primary" type="button" onClick={() => window.print()}><Printer size={16} /> Печать / PDF</button>
      </div>

      <article className="paper-a4 rep">
        <div className="rep-hero">
          <div className="rep-hero-top">
            <span className="rep-wordmark">ТАМ ГДЕ МАСЛО.</span>
            <span className="rep-hero-meta">ОТЧЁТ ДИАГНОСТИКИ · {payload.publicToken ?? token}</span>
          </div>
          <div className="rep-hero-body">
            <div>
              <div className="rep-eyebrow rust">Привет, {(payload.clientName || "клиент").split(" ")[0]}</div>
              <h1 className="rep-title">
                {payload.vehicle.title}<span className="rust">.</span><br />
                <span className="muted2">{payload.counts.total || visibleItems.length} пунктов проверены<span className="rust">.</span></span>
              </h1>
              <div className="rep-facts">
                <div className="rep-fact"><div className="k">Пробег</div><div className="v">{payload.vehicle.mileage?.toLocaleString("ru-RU") ?? "—"}</div><div className="u">км</div></div>
                <div className="rep-fact"><div className="k">Гос. номер</div><div className="v">{payload.vehicle.licensePlate || "—"}</div><div className="u">номер</div></div>
                <div className="rep-fact"><div className="k">Дата</div><div className="v">{formatDay(reportDate)}</div><div className="u">{formatYearTime(reportDate)}</div></div>
                <div className="rep-fact"><div className="k">Мастер</div><div className="v sm">{payload.master?.name || payload.master?.login || "—"}</div><div className="u">диагност</div></div>
              </div>
            </div>
            <CarSilhouette vin={payload.vehicle.vin} />
          </div>
          <div className="rep-chequered" />
        </div>

        <div className="rep-verdict">
          <div className="rep-v-cell good"><div className="n">{good}</div><div className="l">Хорошо</div></div>
          <div className="rep-v-cell warn"><div className="n">{warn}</div><div className="l">Внимание</div></div>
          <div className="rep-v-cell crit"><div className="n">{crit}</div><div className="l">Критично</div></div>
          <div className="rep-v-cell ind"><div className="n">{payload.counts.indirect}</div><div className="l">Косвенно</div></div>
          <div className="rep-v-statement">
            <div className="rep-eyebrow">Итог</div>
            <div className="s">Машина {verdict(payload)}</div>
          </div>
        </div>

        {recommendations.length > 0 && (
          <section className="rep-sec">
            <div className="rep-sec-head">
              <span className="rep-sec-num">01</span>
              <div><div className="rep-eyebrow rust">Что предлагаем</div><h2 className="rep-h2">Точки внимания · {recommendations.length}</h2></div>
            </div>
            <div className="rep-recs">
              {recommendations.map((item) => (
                <article className="rep-rec" key={`${item.blockTitle}-${item.code}`} style={{ borderLeftColor: statusColor(item.status) }}>
                  <div className="rep-rec-head">
                    <h3>{item.title}</h3>
                    <span className="rep-rec-tag" style={{ background: statusColor(item.status) }}>{item.statusLabel || statusLabel(item.status)}</span>
                  </div>
                  <div className="rep-rec-desc">{item.recommendation || item.reportText?.recommendationText || item.statusText}</div>
                  {(item.comment || item.reportText?.sourceText) && (
                    <div className="rep-rec-quote">
                      «{item.comment || item.reportText?.sourceText}»<br />
                      <span>— {payload.master?.name || "мастер-диагност"}</span>
                    </div>
                  )}
                </article>
              ))}
            </div>
          </section>
        )}

        {photos.length > 0 && (
          <section className="rep-sec">
            <div className="rep-sec-head">
              <span className="rep-sec-num">02</span>
              <div><div className="rep-eyebrow rust">Как это выглядит</div><h2 className="rep-h2">Фотоотчёт · {photos.length}</h2></div>
            </div>
            <div className="rep-photos">
              {photos.map((photo, index) => (
                <figure className="rep-photo" key={`${photo.id}-${index}`}>
                  <div className="rep-photo-img" style={{ backgroundImage: `url(${photo.url})` }}>
                    <div className="rep-photo-scrim" />
                    <span className="rep-photo-dot" style={{ background: statusColor(photo.status) }} />
                    <span className="rep-photo-no">IMG_{String(index + 1).padStart(3, "0")}</span>
                    <figcaption className="rep-photo-cap">
                      <span className="lbl">{photo.itemTitle}</span>
                      <span className="cap">{photo.caption}</span>
                    </figcaption>
                  </div>
                </figure>
              ))}
            </div>
            <div className="rep-photo-note">Снимки сделаны мастером в процессе осмотра {formatDay(reportDate)}.</div>
          </section>
        )}

        <section className="rep-sec">
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
            {payload.blocks.map((block, blockIndex) => (
              <div className="rep-block" key={block.code}>
                <div className="rep-block-head"><span className="rep-block-no">{String(blockIndex + 1).padStart(2, "0")}</span>{block.title}</div>
                {block.items.filter((item) => item.showInReport !== false).map((item) => (
                  <div className="rep-check-row" key={item.code}>
                    <span className="rep-mark sm" style={{ background: statusColor(item.status) }}>{statusIcon(item.status)}</span>
                    <span className="rep-check-label">{item.title}</span>
                    <span className="rep-check-val">{item.value || item.statusLabel || statusLabel(item.status)}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>

        <footer className="rep-foot">
          <div className="rep-foot-cta">
            <div>
              <div className="rep-eyebrow rust">Что дальше</div>
              <div className="rep-foot-q">Запишем на работы по точкам внимания?</div>
              <div className="rep-foot-sub">Подберём материалы заранее, согласуем время. Пишите в WhatsApp или звоните.</div>
              {!printMode && (
                <label className="rep-reminder no-print">
                  <input type="checkbox" checked={reminder} onChange={(event) => void saveReminder(event.target.checked)} />
                  Напомнить о следующем визите
                </label>
              )}
            </div>
            <div className="rep-foot-contact">
              <div className="ph">{REPORT_PHONE}</div>
              <div className="tg">WhatsApp · запись · печать</div>
              <div className="link">Онлайн-версия: {payload.reportUrl}</div>
              {!printMode && (
                <div className="rep-online-actions no-print">
                  <a href={REPORT_PHONE_HREF}><Phone size={14} /> Позвонить</a>
                  <a href={WHATSAPP_HREF}>WhatsApp</a>
                  <a href={BOOKING_HREF}>Записаться</a>
                  <button type="button" onClick={() => void navigator.clipboard?.writeText(payload.reportUrl)}><Copy size={14} /> Ссылка</button>
                </div>
              )}
            </div>
          </div>
          <div className="rep-sign">
            <div className="rep-sign-cell"><div className="rep-sign-line" /><div className="rep-sign-lbl">Мастер · {payload.master?.name || "диагност"}</div></div>
            <div className="rep-sign-cell"><div className="rep-sign-line" /><div className="rep-sign-lbl">Клиент · подпись</div></div>
            <div className="rep-sign-cell"><div className="rep-sign-line" /><div className="rep-sign-lbl">Дата ознакомления</div></div>
          </div>
          <div className="rep-disclaimer">
            * «В порядке» означает: критичных проблем для дальнейшей эксплуатации не выявлено. Пункты «внимание», «по пробегу» и «со слов клиента» — рекомендации, а не предписания.
            «Доступ затруднён» — пункт не осматривался напрямую и будет проверен на следующем визите. Карта отражает состояние авто на момент осмотра.
          </div>
          {qrDataUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- QR data URL generated by API
            <img className="rep-qr" src={qrDataUrl} alt="QR-код онлайн-отчёта" />
          )}
        </footer>
      </article>
    </main>
  );
}
