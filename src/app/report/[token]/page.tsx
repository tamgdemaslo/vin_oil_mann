"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { DiagnosticReportItemText } from "@/data/diagnostic-report-copy";

type ReportOffer = {
  title: string;
  nextVisitOnly: boolean;
  variants: { label: string; priceRub: number | null }[];
};

type ReportPosition = {
  key: string;
  block: string;
  node: string;
  status: "YELLOW" | "RED";
  tags: string[];
  measurementValue: number | null;
  measurementUnit: string | null;
  itemText: DiagnosticReportItemText;
  offers: ReportOffer[];
  photos: ReportPhoto[];
};

type ReportPhoto = { id: string; caption: string | null; url: string };

type NormalPosition = {
  key: string;
  block: string;
  node: string;
  title: string;
};

type SkippedPosition = {
  key: string;
  block: string;
  node: string;
  itemText: DiagnosticReportItemText;
};

type LightboxState = {
  title: string;
  photos: ReportPhoto[];
  index: number;
};

type ReminderTerm = "3m" | "6m" | "10000km" | "date";
type ReminderSaveState = "idle" | "saving" | "saved" | "error";

type PublicPayload = {
  publicUrl: string;
  qrDataUrl: string;
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
    reportCode: string | null;
  };
  clientWantsReminder: boolean;
  positions: ReportPosition[];
  normalPositions: NormalPosition[];
  skippedPositions: SkippedPosition[];
};

const REPORT_PHONE = "+7 (995) 054-58-59";
const REPORT_PHONE_HREF = "tel:+79950545859";
const BOOKING_HREF = "/client-site#/vin";
const WHATSAPP_HREF = "https://wa.me/79950545859";
const SERVICE_ADDRESS = "Калининград, Московский пр. 244; Дачная 6В; Юрия Гагарина 116";

const REMINDER_OPTIONS: { value: ReminderTerm; label: string }[] = [
  { value: "3m", label: "через 3 месяца" },
  { value: "6m", label: "через 6 месяцев" },
  { value: "10000km", label: "через 10 000 км" },
  { value: "date", label: "выбрать дату" },
];

function formatReportDate(value: string | null): string {
  if (!value) return "Дата не указана";
  return new Date(value).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function formatPrintDate(value: string | null): string {
  if (!value) return "без даты";
  return new Date(value).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function pointWord(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "пункт";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "пункта";
  return "пунктов";
}

function buildSummaryConclusion(red: number, yellow: number): string {
  if (red > 0 && yellow > 0) {
    return `По результатам проверки есть ${red} ${pointWord(red)}, которые лучше заменить в ближайшее время, и ${yellow} ${pointWord(yellow)} для контроля на следующем визите.`;
  }
  if (red > 0) return `По результатам проверки есть ${red} ${pointWord(red)}, которые лучше заменить в ближайшее время.`;
  if (yellow > 0) return `По результатам проверки есть ${yellow} ${pointWord(yellow)} для контроля на следующем визите.`;
  return "По результатам проверки критичных рекомендаций нет. Плановое обслуживание можно проходить по регламенту.";
}

function vehicleTitle(header: PublicPayload["header"]): string {
  return [header.brand, header.model, header.year].filter(Boolean).join(" ") || "Автомобиль";
}

function formatMeasurement(position: ReportPosition): string | null {
  if (position.measurementValue == null && !position.measurementUnit) return null;
  return `${position.measurementValue ?? ""}${position.measurementUnit ? ` ${position.measurementUnit}` : ""}`.trim();
}

function offerLine(position: ReportPosition): string | null {
  const offer = position.offers[0];
  if (!offer) return null;
  const variant = offer.variants[0];
  if (!variant) return offer.title;
  return variant.priceRub == null ? `${offer.title}: ${variant.label}` : `${offer.title}: ${variant.label} · ${variant.priceRub.toLocaleString("ru-RU")} ₽`;
}

function formatFoundList(values: string[]): string {
  const text = values
    .map((value) => value.trim())
    .filter(Boolean)
    .join(", ");
  if (!text) return "Требуется контроль.";
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function statusToneClass(tone: DiagnosticReportItemText["statusTone"]): string {
  if (tone === "danger") return "is-red";
  if (tone === "warning") return "is-yellow";
  if (tone === "success") return "is-green";
  return "is-neutral";
}

function ReportRecommendationCard({
  position,
  reminderActive,
  onReminderClick,
  onPhotoOpen,
}: {
  position: ReportPosition;
  reminderActive?: boolean;
  onReminderClick?: () => void;
  onPhotoOpen?: (index: number) => void;
}) {
  const item = position.itemText;
  const toneClass = statusToneClass(item.statusTone);
  const measurement = formatMeasurement(position);
  const offer = offerLine(position);

  return (
    <article className={`client-report-card report-card ${toneClass}`}>
      <header>
        <div>
          <span className={`client-report-status ${toneClass}`}>{item.statusLabel}</span>
          <h3>{item.title}</h3>
        </div>
      </header>

      <div className="client-report-copy-block">
        <span>Что обнаружили</span>
        <p>{formatFoundList(item.found)}</p>
      </div>

      <div className="client-report-copy-block">
        <span>Комментарий</span>
        <p>{item.explanation}</p>
      </div>

      <div className="client-report-copy-block">
        <span>Рекомендация</span>
        <p>{item.recommendation}</p>
      </div>

      <div className="client-report-copy-block">
        <span>Когда лучше сделать</span>
        <p>{item.urgency}</p>
      </div>

      {(measurement || item.measurementText) && (
        <div className="client-report-measurement">
          <span>Показатель проверки</span>
          <strong>{measurement ?? item.measurementText}</strong>
        </div>
      )}

      {position.tags.length > 0 && (
        <div className="client-report-tags">
          {position.tags.slice(0, 6).map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
          {position.tags.length > 6 && <span>Ещё {position.tags.length - 6}</span>}
        </div>
      )}

      {position.photos.length > 0 ? (
        <div className="client-report-photos" aria-label="Фотографии по рекомендации">
          {position.photos.map((ph, photoIndex) => (
            <figure key={ph.id}>
              <button
                type="button"
                onClick={() => onPhotoOpen?.(photoIndex)}
                aria-label={`Открыть фото: ${ph.caption ?? item.title}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={ph.url} alt={ph.caption ?? item.title} />
              </button>
              {ph.caption && <figcaption>{ph.caption}</figcaption>}
            </figure>
          ))}
        </div>
      ) : (
        <p className="client-report-photo-empty">Фото не добавлено.</p>
      )}

      <div className="client-report-card-action no-print">
        <span>Что сделать</span>
        <strong>{offer ?? item.urgency}</strong>
        {position.status === "RED" ? (
          <a href={BOOKING_HREF}>{item.ctaLabel ?? "Согласовать работы"}</a>
        ) : (
          <button type="button" onClick={onReminderClick}>
            {reminderActive ? "Отмечено в сервисной карте" : (item.ctaLabel ?? "Поставить напоминание")}
          </button>
        )}
      </div>
    </article>
  );
}

function ReportPhotoLightbox({
  lightbox,
  onClose,
  onPrev,
  onNext,
}: {
  lightbox: LightboxState;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const currentPhoto = lightbox.photos[lightbox.index];
  const hasGallery = lightbox.photos.length > 1;

  return (
    <div className="client-report-lightbox no-print" role="dialog" aria-modal="true" aria-label={`Фото: ${lightbox.title}`}>
      <button type="button" className="client-report-lightbox-backdrop" onClick={onClose} aria-label="Закрыть просмотр фото" />
      <div className="client-report-lightbox-panel">
        <header>
          <div>
            <span>{hasGallery ? `${lightbox.index + 1} из ${lightbox.photos.length}` : "Фото"}</span>
            <strong>{lightbox.title}</strong>
          </div>
          <button type="button" onClick={onClose} aria-label="Закрыть просмотр фото">
            ×
          </button>
        </header>
        <div className="client-report-lightbox-image">
          {hasGallery && (
            <button type="button" className="is-prev" onClick={onPrev} aria-label="Предыдущее фото">
              ‹
            </button>
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={currentPhoto.url} alt={currentPhoto.caption ?? lightbox.title} />
          {hasGallery && (
            <button type="button" className="is-next" onClick={onNext} aria-label="Следующее фото">
              ›
            </button>
          )}
        </div>
        {currentPhoto.caption && <p>{currentPhoto.caption}</p>}
      </div>
    </div>
  );
}

function PrintPosterReport({ data }: { data: PublicPayload }) {
  const h = data.header;
  const reportDate = formatPrintDate(h.completedAt ?? h.startedAt);
  const total = h.summaryGreen + h.summaryYellow + h.summaryRed;
  const greenPct = Math.round((h.summaryGreen / Math.max(total, 1)) * 100);
  const urgent = data.positions.filter((position) => position.status === "RED");
  const planned = data.positions.filter((position) => position.status === "YELLOW");
  const allIssues = [...urgent, ...planned];
  const verdict = h.summaryRed > 0 ? "есть срочное" : h.summaryYellow > 0 ? "почти в форме" : "в форме";

  return (
    <section className="client-report-print-poster report-page" aria-label="Печатный отчёт диагностики">
      <div className="print-poster-topline">
        <span>Там где масло.</span>
        <span>отчёт диагностики</span>
        <span>{reportDate}</span>
        <span>TGM.REPORT / {h.reportCode}</span>
      </div>

      <header className="print-poster-hero report-card">
        <div>
          <span className="print-poster-eyebrow">Проверили автомобиль</span>
          <h1>
            {vehicleTitle(h)}
            <span>.</span>
          </h1>
          <p>{buildSummaryConclusion(h.summaryRed, h.summaryYellow)}</p>
          <div className="print-poster-meta">
            {h.licensePlate && <b>{h.licensePlate}</b>}
            {h.vin && <b>VIN ...{h.vin.slice(-6)}</b>}
            {h.mileage != null && <b>{h.mileage.toLocaleString("ru-RU")} км</b>}
            {h.mechanicLogin && <b>Мастер {h.mechanicLogin}</b>}
          </div>
        </div>
        <div className="print-poster-car" aria-hidden>
          <div className="print-poster-race">{h.licensePlate?.match(/\d{2,3}/)?.[0] ?? "39"}</div>
          <svg viewBox="0 0 440 260" role="img" aria-label="">
            <rect x="0" y="210" width="440" height="50" fill="#050505" />
            <path d="M44 192 80 154 152 136 252 132 322 140 370 160 405 193 396 210H54Z" fill="#3d3d3d" />
            <path d="M152 145 214 137 283 139 320 154 300 180 162 181Z" fill="#090909" />
            <circle cx="105" cy="210" r="23" fill="#070707" stroke="#545454" strokeWidth="2" />
            <circle cx="342" cy="210" r="23" fill="#070707" stroke="#545454" strokeWidth="2" />
            <circle cx="222" cy="176" r="16" fill="#c2410c" />
            <text x="222" y="182" textAnchor="middle" fontFamily="Arial" fontSize="18" fontWeight="800" fill="#0a0a0a">
              {h.licensePlate?.match(/\d{2,3}/)?.[0] ?? "39"}
            </text>
          </svg>
        </div>
      </header>

      <div className="print-poster-score report-card">
        <div>
          <strong>{h.summaryGreen}</strong>
          <span>В норме</span>
        </div>
        <div>
          <strong>{h.summaryYellow}</strong>
          <span>Внимание</span>
        </div>
        <div>
          <strong>{h.summaryRed}</strong>
          <span>Замена</span>
        </div>
        <div>
          <strong>{verdict}</strong>
          <span>{greenPct}% в норме</span>
        </div>
      </div>

      <section className="print-poster-section report-card">
        <div className="print-poster-section-head">
          <span>01 / рекомендации</span>
          <h2>{allIssues.length} {pointWord(allIssues.length)} внимания.</h2>
        </div>
        <div className="print-poster-recs">
          {allIssues.length > 0 ? (
            allIssues.map((position) => (
              <article key={position.key} className={`print-poster-rec ${position.status === "RED" ? "is-red" : "is-yellow"}`}>
                <div>
                  <h3>{position.itemText.title}</h3>
                  <span>{position.itemText.statusLabel}</span>
                </div>
                <p>{position.itemText.explanation}</p>
                <b>{position.itemText.recommendation}</b>
                <small>{position.itemText.urgency}</small>
              </article>
            ))
          ) : (
            <div className="print-poster-empty">Срочных и плановых рекомендаций нет.</div>
          )}
        </div>
      </section>

      <section className="print-poster-section report-card">
        <div className="print-poster-section-head">
          <span>02 / фото и онлайн-версия</span>
          <h2>Фото остаются по ссылке.</h2>
        </div>
        <div className="print-poster-evidence">
          <div className="print-poster-photos">
            {allIssues.flatMap((position) =>
              position.photos.slice(0, 2).map((photo) => (
                <figure key={photo.id}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo.url} alt={photo.caption ?? position.itemText.title} />
                  <figcaption>{photo.caption ?? position.itemText.title}</figcaption>
                </figure>
              ))
            ).slice(0, 6)}
          </div>
          <div className="print-poster-qr">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={data.qrDataUrl} alt="QR-код публичного отчёта" />
            <strong>Открыть отчёт онлайн</strong>
            <span>Отсканируйте QR-код, чтобы открыть отчёт с фото.</span>
          </div>
        </div>
      </section>

      <footer className="print-poster-footer">
        <span>{SERVICE_ADDRESS}</span>
        <strong>{REPORT_PHONE}</strong>
        <span>{data.publicUrl}</span>
      </footer>
    </section>
  );
}

export default function ClientReportPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [data, setData] = useState<PublicPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reminder, setReminder] = useState(true);
  const [reminderTerm, setReminderTerm] = useState<ReminderTerm>("6m");
  const [reminderDate, setReminderDate] = useState("");
  const [reminderSaveState, setReminderSaveState] = useState<ReminderSaveState>("idle");
  const [lightbox, setLightbox] = useState<LightboxState | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/diagnostic/public/${encodeURIComponent(token)}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(r.status === 404 ? "Отчёт не найден" : j.error ?? "Ошибка");
        return j;
      })
      .then((j) => {
        setData(j as PublicPayload);
        setReminder(Boolean(j.clientWantsReminder));
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Ошибка"));
  }, [token]);

  useEffect(() => {
    if (!lightbox) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setLightbox(null);
      if (event.key === "ArrowLeft") {
        setLightbox((current) => current && { ...current, index: current.index === 0 ? current.photos.length - 1 : current.index - 1 });
      }
      if (event.key === "ArrowRight") {
        setLightbox((current) => current && { ...current, index: current.index === current.photos.length - 1 ? 0 : current.index + 1 });
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [lightbox]);

  useEffect(() => {
    if (!data) return;
    if (new URLSearchParams(window.location.search).get("print") !== "1") return;
    const timer = window.setTimeout(() => window.print(), 450);
    return () => window.clearTimeout(timer);
  }, [data]);

  async function saveReminder(next: boolean) {
    setReminder(next);
    setReminderSaveState("saving");
    try {
      const response = await fetch(`/api/diagnostic/public/${encodeURIComponent(token)}/reminder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientWantsReminder: next,
          reminderTerm,
          reminderDate: reminderTerm === "date" ? reminderDate : null,
        }),
      });
      if (!response.ok) throw new Error("Не удалось сохранить");
      setReminderSaveState("saved");
    } catch {
      setReminderSaveState("error");
    }
  }

  async function copyReportLink() {
    try {
      await navigator.clipboard.writeText(data?.publicUrl ?? window.location.href);
      setCopyStatus("Ссылка скопирована");
    } catch {
      setCopyStatus("Не удалось скопировать");
    }
    window.setTimeout(() => setCopyStatus(null), 2200);
  }

  function openPhotoLightbox(position: ReportPosition, index: number) {
    if (position.photos.length === 0) return;
    setLightbox({ title: position.itemText.title, photos: position.photos, index });
  }

  if (error) {
    return (
      <main className="client-report-page">
        <div className="client-report-shell">
          <section className="client-report-state is-error">
            <strong>{error === "Отчёт не найден" ? "Отчёт не найден" : "Не удалось открыть отчёт"}</strong>
            <p>Проверьте ссылку или свяжитесь с сервисом.</p>
            <a href={REPORT_PHONE_HREF}>{REPORT_PHONE}</a>
          </section>
        </div>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="client-report-page">
        <div className="client-report-shell">
          <section className="client-report-state">Загрузка отчёта...</section>
        </div>
      </main>
    );
  }

  const h = data.header;
  const reportDate = formatReportDate(h.completedAt ?? h.startedAt);
  const urgentPositions = data.positions.filter((p) => p.status === "RED");
  const nextVisitPositions = data.positions.filter((p) => p.status === "YELLOW");
  const normalPositions = data.normalPositions ?? [];
  const skippedPositions = data.skippedPositions ?? [];
  const redCount = urgentPositions.length;
  const yellowCount = nextVisitPositions.length;
  const heroStatus = redCount > 0 ? "Есть срочные работы" : yellowCount > 0 ? "Требуется внимание" : "Критичных замечаний нет";
  const summaryConclusion = buildSummaryConclusion(h.summaryRed, h.summaryYellow);
  const nextStepTitle =
    redCount > 0 ? "Согласовать работы" : yellowCount > 0 ? "Запланировать следующий визит" : "Сохранить отчёт";
  const nextStepText =
    redCount > 0
      ? "В отчёте есть пункты, которые мастер рекомендует заменить сейчас или в ближайшее время."
      : yellowCount > 0
        ? "Срочного ремонта нет, но эти рекомендации удобно отметить в сервисной карте."
        : "Критичных замечаний нет. Отчёт можно сохранить или открыть позже по ссылке.";

  return (
    <main className="client-report-page">
      <div className="client-report-screen">
        <div className="client-report-shell">
          <section className="client-report-hero report-card">
            <div className="client-report-hero-main">
              <div className="client-report-brand">Там где масло<span>.</span></div>
              <div className="client-report-kicker">Отчёт диагностики</div>
              <h1>Отчёт диагностики</h1>
              <strong className="client-report-vehicle">{vehicleTitle(h)}</strong>
              <div className="client-report-meta">
                {h.vin && <span>VIN {h.vin}</span>}
                {h.licensePlate && <span>{h.licensePlate}</span>}
                <span>{reportDate}</span>
                {h.mileage != null && <span>{h.mileage.toLocaleString("ru-RU")} км</span>}
              </div>
              {h.mechanicLogin && <p className="client-report-master">Проверил мастер: {h.mechanicLogin}</p>}
            </div>
            <aside className="client-report-hero-side">
              <span>Общий статус</span>
              <strong>{heroStatus}</strong>
              <div>
                <small>{redCount > 0 ? "Рекомендуем согласовать работы" : "Можно выбрать удобное время для сервиса"}</small>
                <a href={REPORT_PHONE_HREF}>{REPORT_PHONE}</a>
              </div>
            </aside>
          </section>

          <section className="client-report-summary report-card" aria-label="Сводка диагностики">
            <article className="is-green">
              <div className="client-report-summary-icon" aria-hidden>✓</div>
              <div>
                <span>В норме</span>
                <strong>{h.summaryGreen} {pointWord(h.summaryGreen)}</strong>
              </div>
            </article>
            <article className="is-yellow">
              <div className="client-report-summary-icon" aria-hidden>!</div>
              <div>
                <span>Требует внимания</span>
                <strong>{h.summaryYellow} {pointWord(h.summaryYellow)}</strong>
              </div>
            </article>
            <article className="is-red">
              <div className="client-report-summary-icon" aria-hidden>●</div>
              <div>
                <span>Рекомендуем заменить</span>
                <strong>{h.summaryRed} {pointWord(h.summaryRed)}</strong>
              </div>
            </article>
          </section>
          <p className="client-report-summary-conclusion report-card">{summaryConclusion}</p>

          <section className="client-report-cta-panel report-card no-print" aria-label="Действия по отчёту">
            <div className="client-report-cta-copy">
              <span>Что дальше</span>
              <strong>{nextStepTitle}</strong>
              <p>{nextStepText}</p>
            </div>
            <div className="client-report-cta-main">
              <a href={BOOKING_HREF}>{redCount > 0 ? "Согласовать работы" : "Записаться"}</a>
              <a href={WHATSAPP_HREF} target="_blank" rel="noreferrer" className="is-secondary">WhatsApp</a>
            </div>
            <div className="client-report-cta-tools">
              <a href={REPORT_PHONE_HREF}>Позвонить</a>
              <button type="button" onClick={() => void copyReportLink()}>{copyStatus ?? "Скопировать ссылку"}</button>
              <button type="button" onClick={() => window.print()}>Печать отчёта</button>
            </div>
          </section>

          <section className="client-report-section client-report-urgency is-now">
            <div className="client-report-section-head">
              <div>
                <span>Рекомендуем сделать сейчас</span>
                <h2>Не откладывать</h2>
                <p>Работы из этой зоны лучше согласовать и выполнить в ближайшее удобное время.</p>
              </div>
              <div className="client-report-section-actions no-print">
                <a href={BOOKING_HREF}>Согласовать работы</a>
                <a href={WHATSAPP_HREF} target="_blank" rel="noreferrer" className="is-secondary">WhatsApp</a>
              </div>
            </div>

            {urgentPositions.length > 0 ? (
              <div className="client-report-grid">
                {urgentPositions.map((p) => (
                  <ReportRecommendationCard key={p.key} position={p} onPhotoOpen={(index) => openPhotoLightbox(p, index)} />
                ))}
              </div>
            ) : (
              <div className="client-report-empty report-card">
                <strong>Срочных работ нет</strong>
                <span>По итогам диагностики мастер не отметил пунктов, которые требуют немедленной замены.</span>
              </div>
            )}
          </section>

          <section className="client-report-section client-report-urgency is-next">
            <div className="client-report-section-head">
              <div>
                <span>Запланировать на следующий визит</span>
                <h2>Контроль и плановые работы</h2>
                <p>Эти пункты не выглядят срочными, но их стоит держать в плане обслуживания.</p>
              </div>
              <div className="client-report-section-actions no-print">
                <button type="button" onClick={() => void saveReminder(true)}>
                  {reminder ? "Отмечено в сервисной карте" : "Поставить напоминание"}
                </button>
                <a href={BOOKING_HREF} className="is-secondary">Записаться</a>
              </div>
            </div>

            {nextVisitPositions.length > 0 ? (
              <div className="client-report-grid">
                {nextVisitPositions.map((p) => (
                  <ReportRecommendationCard
                    key={p.key}
                    position={p}
                    reminderActive={reminder}
                    onReminderClick={() => void saveReminder(true)}
                    onPhotoOpen={(index) => openPhotoLightbox(p, index)}
                  />
                ))}
              </div>
            ) : (
              <div className="client-report-empty report-card">
                <strong>Плановых рекомендаций нет</strong>
                <span>Для следующего визита мастер не оставил отдельных контрольных пунктов.</span>
              </div>
            )}
          </section>

          <section className="client-report-normal report-card">
            <details>
              <summary>
                <div>
                  <span>Что в норме</span>
                  <strong>{h.summaryGreen} {pointWord(h.summaryGreen)} в норме</strong>
                </div>
                <b>Смотреть список</b>
              </summary>
              {normalPositions.length > 0 ? (
                <ul>
                  {normalPositions.map((position) => (
                    <li key={position.key}>{position.title}</li>
                  ))}
                </ul>
              ) : (
                <p>Нормальные пункты скрыты, чтобы отчёт не превращался в полный внутренний чек-лист.</p>
              )}
            </details>
          </section>

          {skippedPositions.length > 0 && (
            <section className="client-report-normal report-card">
              <details>
                <summary>
                  <div>
                    <span>Не проверялось</span>
                    <strong>{skippedPositions.length} {pointWord(skippedPositions.length)}</strong>
                  </div>
                  <b>Смотреть список</b>
                </summary>
                <ul>
                  {skippedPositions.map((position) => (
                    <li key={position.key}>{position.itemText.title}</li>
                  ))}
                </ul>
              </details>
            </section>
          )}

          <section className="client-report-reminder report-card no-print">
            <div className="client-report-reminder-head">
              <div>
                <span className="client-report-reminder-kicker">Напоминание</span>
                <strong>Отметить следующий сервисный контакт</strong>
                <p>Отметим в сервисной карте, что нужно связаться по следующему ТО.</p>
              </div>
              <label className="client-report-reminder-toggle">
                <input
                  type="checkbox"
                  checked={reminder}
                  onChange={(event) => {
                    setReminder(event.target.checked);
                    setReminderSaveState("idle");
                  }}
                />
                <span>{reminder ? "Включено" : "Выключено"}</span>
              </label>
            </div>
            <div className="client-report-reminder-options" role="group" aria-label="Срок напоминания">
              {REMINDER_OPTIONS.map((option) => (
                <label key={option.value} className={reminderTerm === option.value ? "is-active" : ""}>
                  <input
                    type="radio"
                    name="reminder-term"
                    value={option.value}
                    checked={reminderTerm === option.value}
                    disabled={!reminder}
                    onChange={() => {
                      setReminder(true);
                      setReminderTerm(option.value);
                      setReminderSaveState("idle");
                    }}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
            {reminderTerm === "date" && (
              <label className="client-report-reminder-date">
                <span>Дата контакта</span>
                <input
                  type="date"
                  value={reminderDate}
                  disabled={!reminder}
                  onChange={(event) => {
                    setReminderDate(event.target.value);
                    setReminderSaveState("idle");
                  }}
                />
              </label>
            )}
            <div className="client-report-reminder-footer">
              <p className={`client-report-reminder-status is-${reminderSaveState}`}>
                {reminderSaveState === "saving"
                  ? "Сохраняем отметку..."
                  : reminderSaveState === "saved"
                    ? "Отмечено в сервисной карте."
                    : reminderSaveState === "error"
                      ? "Не удалось сохранить, попробуйте ещё раз."
                      : "Выберите срок и сохраните отметку."}
              </p>
              <button type="button" onClick={() => void saveReminder(reminder)} disabled={reminderSaveState === "saving"}>
                {reminderSaveState === "saving" ? "Сохраняем..." : "Сохранить отметку"}
              </button>
            </div>
          </section>

          <section className="client-report-qr report-card">
            <div>
              <span>Открыть отчёт онлайн</span>
              <strong>QR-код публичной ссылки</strong>
              <p>Отсканируйте QR-код, чтобы открыть отчёт с фото.</p>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={data.qrDataUrl} alt="QR-код публичного отчёта" />
          </section>

          <section className="client-report-trust report-card">
            <div>
              <span>Документ сервиса</span>
              <strong>Диагностика выполнена в сервисе “Там где масло”</strong>
              <p>Отчёт отражает состояние автомобиля на момент проверки.</p>
            </div>
            <dl>
              <div>
                <dt>Адрес</dt>
                <dd>{SERVICE_ADDRESS}</dd>
              </div>
              <div>
                <dt>Телефон</dt>
                <dd><a href={REPORT_PHONE_HREF}>{REPORT_PHONE}</a></dd>
              </div>
              <div>
                <dt>Дата проверки</dt>
                <dd>{reportDate}</dd>
              </div>
              {h.mechanicLogin && (
                <div>
                  <dt>Мастер</dt>
                  <dd>{h.mechanicLogin}</dd>
                </div>
              )}
              {h.reportCode && (
                <div>
                  <dt>Код отчёта</dt>
                  <dd>{h.reportCode}</dd>
                </div>
              )}
            </dl>
          </section>
        </div>

        <nav className="client-report-mobile-cta no-print" aria-label="Действия по отчёту">
          <a href={REPORT_PHONE_HREF}>Позвонить</a>
          <a href={BOOKING_HREF}>Записаться</a>
        </nav>

        {lightbox && (
          <ReportPhotoLightbox
            lightbox={lightbox}
            onClose={() => setLightbox(null)}
            onPrev={() =>
              setLightbox((current) => current && { ...current, index: current.index === 0 ? current.photos.length - 1 : current.index - 1 })
            }
            onNext={() =>
              setLightbox((current) => current && { ...current, index: current.index === current.photos.length - 1 ? 0 : current.index + 1 })
            }
          />
        )}
      </div>

      <PrintPosterReport data={data} />
    </main>
  );
}
