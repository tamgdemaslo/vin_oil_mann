"use client";

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
};

const REPORT_PHONE = "+7 (995) 054-58-59";

async function fetchJson<T>(url: string): Promise<{ ok: true; data: T } | { ok: false }> {
  const response = await fetch(url);
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

export function DiagnosticPublicReport({ token }: DiagnosticPublicReportProps) {
  const [payload, setPayload] = useState<ReportPayload | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
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
          setQrDataUrl(next.data.qrDataUrl ?? null);
        }
        setLoading(false);
        return;
      }
      const legacy = await fetchJson<LegacyPayload>(`/api/diagnostic/public/${encodeURIComponent(token)}`);
      if (legacy.ok) {
        if (!cancelled) {
          setPayload(adaptLegacy(legacy.data));
          setQrDataUrl(legacy.data.qrDataUrl ?? null);
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

  function printReport() {
    window.print();
  }

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
  const reportCode = payload.publicToken ?? token;
  const masterName = payload.master?.name || payload.master?.login || "мастер-диагност";
  const masterMasked = maskLogin(payload.master?.login || payload.master?.name);
  const percentGood = Math.round((good / (total || 1)) * 100);
  const verdictText = verdict(crit, warn, indirect);
  const verdictTitle = crit > 0 ? "есть срочное" : warn > 0 || indirect > 0 ? "почти в форме" : "в форме";
  const blocksForReport = payload.blocks.map((block, index) => ({
    ...block,
    num: String(index + 1).padStart(2, "0"),
    items: block.items.filter((item) => item.showInReport !== false),
  }));

  return (
    <main className="diag-print-screen is-print">
      <div className="diag-print-toolbar no-print">
        <a className="btn" href={payload.reportUrl}><ChevronLeft size={16} /> Онлайн-отчёт</a>
        <span>Диагностическая карта · печать A4</span>
        <button className="btn primary" type="button" onClick={printReport}><Printer size={16} /> Печать / PDF</button>
      </div>

      <article className="paper-a4 rep">
        <section className="rep-hero">
          <div className="rep-hero-top">
            <div className="rep-wordmark">ТАМ ГДЕ МАСЛО.</div>
            <div>ОТЧЁТ ДИАГНОСТИКИ · {formatNumericDate(reportDate)}</div>
            <div>TGM.REPORT / {reportCode}</div>
          </div>
          <div className="rep-hero-body">
            <div>
              <div className="rep-eyebrow rust">Проверили автомобиль</div>
              <h1 className="rep-title">
                {payload.vehicle.title}.<br />
                <span className="muted2">{checkedText}.</span>
              </h1>
              <div className="rep-facts">
                <div className="rep-fact">
                  <div className="k">Пробег</div>
                  <div className="v">{formatMileage(payload.vehicle.mileage)}</div>
                  <div className="u">км</div>
                </div>
                <div className="rep-fact">
                  <div className="k">Номер</div>
                  <div className="v sm">{payload.vehicle.licensePlate || "—"}</div>
                  <div className="u">госномер</div>
                </div>
                <div className="rep-fact">
                  <div className="k">Дата</div>
                  <div className="v sm">{formatDay(reportDate)}</div>
                  <div className="u">{formatYearTime(reportDate)}</div>
                </div>
                <div className="rep-fact">
                  <div className="k">Мастер</div>
                  <div className="v sm">{masterName}</div>
                  <div className="u">{masterMasked}</div>
                </div>
              </div>
            </div>
            <CarSilhouette vehicleTitle={payload.vehicle.title} vin={payload.vehicle.vin} />
          </div>
          <div className="rep-chequered" />
        </section>

        <section className="rep-verdict">
          <div className="rep-v-cell"><div className="n">{good}</div><div className="l">Хорошо</div></div>
          <div className="rep-v-cell"><div className="n">{warn}</div><div className="l">Внимание</div></div>
          <div className="rep-v-cell"><div className="n">{crit}</div><div className="l">Критично</div></div>
          <div className="rep-v-cell"><div className="n">{indirect}</div><div className="l">Косвенно</div></div>
          <div className="rep-v-statement">
            <span>Общий вердикт</span>
            <div className="s">{verdictTitle}</div>
          </div>
        </section>

        <section className="rep-sec">
          <div className="rep-sec-head">
            <div className="rep-sec-num">— 01 / 04</div>
            <div>
              <span className="rep-eyebrow rust">Что проверили</span>
              <h2 className="rep-h2">{total} {pluralRu(total, "пункт", "пункта", "пунктов")} · что мы посмотрели.</h2>
            </div>
          </div>
          <div className="rep-check">
            {blocksForReport.map((block) => (
              <div className="rep-block" key={block.code}>
                <div className="rep-block-head"><span>{block.num}</span>{block.title}</div>
                {block.items.map((item) => (
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

        <section className="rep-sec">
          <div className="rep-sec-head">
            <div className="rep-sec-num">— 02 / 04</div>
            <div>
              <span className="rep-eyebrow rust">Точки внимания</span>
              <h2 className="rep-h2">{recommendations.length} {pluralRu(recommendations.length, "рекомендация", "рекомендации", "рекомендаций")}.</h2>
            </div>
          </div>
          {recommendations.length > 0 ? (
            <div className="rep-recs">
              {recommendations.map((item) => {
                const normalized = normalizeStatus(item.status);
                return (
                  <article className="rep-rec" style={{ borderLeftColor: statusColor(normalized) }} key={`${item.blockTitle}-${item.code}`}>
                    <div className="rep-rec-head">
                      <h3>{item.title}</h3>
                      <span className="rep-rec-tag" style={{ background: statusColor(normalized) }}>{statusLabel(normalized)}</span>
                    </div>
                    <div className="rep-rec-desc">
                      <b>Обнаружено:</b> {item.comment || item.reportText?.sourceText || item.statusText || statusLabel(normalized)}.{" "}
                      <b>{item.recommendation || item.reportText?.recommendationText || "Согласовать дальнейшие действия с мастером"}.</b>
                    </div>
                    {(item.comment || item.reportText?.sourceText) && (
                      <div className="rep-rec-quote">«{item.comment || item.reportText?.sourceText}» — {masterName.split(" ")[0]}, мастер-диагност</div>
                    )}
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="rep-rec" style={{ borderLeftColor: statusColor("good") }}>
              <div className="rep-rec-head">
                <h3>Критичных рекомендаций нет</h3>
                <span className="rep-rec-tag" style={{ background: statusColor("good") }}>Хорошо</span>
              </div>
              <div className="rep-rec-desc">Плановое обслуживание можно проходить по регламенту. Состояние автомобиля зафиксировано на момент проверки.</div>
            </div>
          )}
        </section>

        <section className="rep-sec">
          <div className="rep-sec-head">
            <div className="rep-sec-num">— 03 / 04</div>
            <div>
              <span className="rep-eyebrow rust">Фотоотчёт</span>
              <h2 className="rep-h2">{photos.length} {pluralRu(photos.length, "фото", "фото", "фото")} с диагностики.</h2>
            </div>
          </div>
          {photos.length > 0 ? (
            <>
              <div className="rep-photos">
                {photos.map((photo, index) => <PhotoTile key={`${photo.id}-${index}`} photo={photo} index={index} status={photo.status} />)}
              </div>
              <div className="rep-photo-note">Фото приложены к конкретным пунктам диагностики и отражают состояние на момент проверки.</div>
            </>
          ) : (
            <div className="rep-rec" style={{ borderLeftColor: "#9a9a9a" }}>
              <div className="rep-rec-desc">Фото к этому отчёту не добавлены.</div>
            </div>
          )}
        </section>

        <section className="rep-sec">
          <div className="rep-sec-head">
            <div className="rep-sec-num">— 04 / 04</div>
            <div>
              <span className="rep-eyebrow rust">Полный список</span>
              <h2 className="rep-h2">Чек-лист диагностики.</h2>
            </div>
          </div>
          <div className="rep-legend">
            {["good", "warn", "crit", "no-access", "by-mileage", "by-client"].map((key) => (
              <span className="rep-key" key={key}><span className="rep-mark" style={{ background: statusColor(key) }}>{statusIcon(key)}</span>{payload.statusLegend?.[key]?.label ?? statusLabel(key)}</span>
            ))}
          </div>
          <div className="rep-check">
            {blocksForReport.map((block) => (
              <div className="rep-block" key={block.code}>
                <div className="rep-block-head"><span>{block.num}</span>{block.title}</div>
                {block.items.map((item) => (
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
              <div className="rep-foot-q">Согласуем работы, материалы и удобное время визита.</div>
              <div className="rep-foot-sub">Диагностика показывает состояние автомобиля на момент проверки. По косвенным статусам нужна дополнительная проверка или подтверждение.</div>
            </div>
            <div className="rep-foot-contact">
              <div className="ph">{REPORT_PHONE}</div>
              <div className="tg">Там где масло · Калининград</div>
              <div className="link">{payload.reportUrl}</div>
              {qrDataUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- QR data URL generated by API
                <img className="rep-qr" src={qrDataUrl} alt="QR-код онлайн-отчёта" />
              )}
            </div>
          </div>
          <div className="rep-sign">
            <div>
              <div className="rep-sign-line" />
              <div className="rep-sign-lbl">Мастер-диагност</div>
            </div>
            <div>
              <div className="rep-sign-line" />
              <div className="rep-sign-lbl">Клиент</div>
            </div>
            <div>
              <div className="rep-sign-line" />
              <div className="rep-sign-lbl">Дата</div>
            </div>
          </div>
          <div className="rep-disclaimer">
            * «Машина {verdictText}» означает состояние на момент проверки. Пункты «внимание», «критично» и косвенные статусы — рекомендации, а не предписания. Решение, что делать дальше, всегда за клиентом и мастером.
            Отчёт № {reportCode} · {formatNumericDate(reportDate)} · {percentGood}% пунктов в норме.
          </div>
        </footer>
      </article>
    </main>
  );
}
