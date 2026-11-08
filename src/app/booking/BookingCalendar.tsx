"use client";

import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { BookingDayLoad } from "@/lib/booking/availability";
import styles from "./booking.module.css";

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
function monthDate(month: string, offset = 0) {
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year, number - 1 + offset, 1, 12));
}
function iso(date: Date) { return date.toISOString().slice(0, 10); }

type LoadMonth = (month: string, signal: AbortSignal) => Promise<BookingDayLoad[]>;

export default function BookingCalendar({ value, today, max, onChange, initiallyExpanded = true, loadMonth }: {
  value: string;
  today: string;
  max: string;
  onChange: (date: string) => void;
  initiallyExpanded?: boolean;
  loadMonth?: LoadMonth;
}) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const calendarId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const selectedDate = new Intl.DateTimeFormat("ru-RU", {
    weekday: "short", day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));

  function collapseCalendar() {
    setExpanded(false);
    requestAnimationFrame(() => {
      toggleRef.current?.focus({ preventScroll: true });
      sectionRef.current?.scrollIntoView({ block: "start", behavior: "auto" });
    });
  }

  function chooseDate(date: string) {
    onChange(date);
    collapseCalendar();
  }

  function toggleCalendar() {
    if (expanded) { collapseCalendar(); return; }
    setExpanded(true);
    requestAnimationFrame(() => {
      const selectedDay = sectionRef.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
      selectedDay?.focus({ preventScroll: true });
      sectionRef.current?.scrollIntoView({ block: "start", behavior: "auto" });
    });
  }

  return <section ref={sectionRef} className={styles.calendar} aria-label="Дата визита">
    <div id={calendarId} hidden={!expanded}>
      {/* Keep the displayed month aligned with dates selected through nearest days. */}
      <MonthCalendar key={value.slice(0, 7)} value={value} today={today} max={max} onChange={chooseDate} loadMonth={expanded ? loadMonth : undefined} />
    </div>
    <button ref={toggleRef} type="button" className={expanded ? styles.calendarCollapse : styles.calendarExpand}
      aria-expanded={expanded} aria-controls={calendarId} onClick={toggleCalendar}>
      {expanded ? <><ChevronUp aria-hidden /><span>Свернуть календарь</span></> : <><strong>{selectedDate}</strong><span>Изменить дату</span><ChevronDown aria-hidden /></>}
    </button>
  </section>;
}

function MonthCalendar({ value, today, max, onChange, loadMonth }: {
  value: string; today: string; max: string; onChange: (date: string) => void; loadMonth?: LoadMonth;
}) {
  const [month, setMonth] = useState(value.slice(0, 7));
  const [result, setResult] = useState<{ month: string; load: LoadMonth; days: BookingDayLoad[] | null }>();
  useEffect(() => {
    if (!loadMonth) return;
    const controller = new AbortController();
    loadMonth(month, controller.signal).then(
      (days) => {
        if (!controller.signal.aborted) setResult({ month, load: loadMonth, days });
      },
      () => {
        if (!controller.signal.aborted) setResult({ month, load: loadMonth, days: null });
      },
    );
    return () => controller.abort();
  }, [loadMonth, month]);

  const monthResult = result?.month === month && result.load === loadMonth ? result : undefined;
  const loadByDay = new Map(monthResult?.days?.map((day) => [day.localDate, day]));
  const showsSlots = monthResult?.days?.some((day) => day.hasSlot !== null);

  const first = monthDate(month);
  const offset = (first.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const cells = Math.ceil((offset + daysInMonth) / 7) * 7;
  const label = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" }).format(first).replace(/ г\.$/u, "");
  return <>
    <div className={styles.calendarHeader}>
      <h3 aria-live="polite">{label}</h3>
      <div>
        <button type="button" aria-label="Предыдущий месяц" disabled={month <= today.slice(0, 7)} onClick={() => setMonth(iso(monthDate(month, -1)).slice(0, 7))}><ChevronLeft aria-hidden /></button>
        <button type="button" aria-label="Следующий месяц" disabled={month >= max.slice(0, 7)} onClick={() => setMonth(iso(monthDate(month, 1)).slice(0, 7))}><ChevronRight aria-hidden /></button>
      </div>
    </div>
    <div className={styles.calendarWeekdays} aria-hidden>{WEEKDAYS.map((day) => <span key={day}>{day}</span>)}</div>
    <div className={`${styles.calendarDays}${loadMonth ? ` ${styles.calendarWithLoad}` : ""}`}>
      {Array.from({ length: cells }, (_, index) => {
        const date = new Date(first);
        date.setUTCDate(1 - offset + index);
        const dateValue = iso(date), outside = dateValue.slice(0, 7) !== month;
        const fullLabel = new Intl.DateTimeFormat("ru-RU", { dateStyle: "full", timeZone: "UTC" }).format(date);
        const disabled = outside || dateValue < today || dateValue > max;
        const load = disabled ? undefined : loadByDay.get(dateValue);
        const occupied = load?.occupiedPercent;
        const segments = occupied === 100 ? 4 : occupied ? Math.min(3, Math.ceil(occupied / 25)) : 0;
        const description = [
          fullLabel,
          occupied === null ? "Нет смены" : occupied === undefined ? "" : `Занято ${occupied}% рабочего времени`,
          load?.hasSlot === true ? "Есть окно для выбранных услуг" : load?.hasSlot === false ? "Нет окна для выбранных услуг" : "",
        ].filter(Boolean).join(". ");
        return <button type="button" key={dateValue} disabled={disabled}
          className={value === dateValue ? styles.calendarSelected : outside ? styles.calendarOutside : undefined}
          aria-label={description} title={load ? description : undefined} aria-pressed={value === dateValue} aria-current={dateValue === today ? "date" : undefined}
          onClick={() => onChange(dateValue)}>
          {date.getUTCDate()}
          {load && <span className={styles.calendarDayLoad} aria-hidden="true">
            {occupied === null ? <span className={styles.calendarNoShift} /> : <span className={styles.calendarLoadBar}>
              {[0, 1, 2, 3].map((index) => <span key={index} data-filled={index < segments} />)}
            </span>}
            {load.hasSlot && <span className={styles.calendarSlotDot} />}
          </span>}
        </button>;
      })}
    </div>
    {loadMonth && <div className={styles.calendarLoadLegend} role="status">
      {!monthResult ? "Проверяем занятость…" : !monthResult.days ? "Не удалось загрузить занятость. Откройте календарь заново." : !monthResult.days.length ? "Месяц вне доступного периода записи" : <>
        <span>Чем полнее шкала, тем больше занято</span>
        <span><span className={styles.calendarNoShift} aria-hidden="true" /> Нет смены</span>
        {showsSlots && <span><span className={styles.calendarSlotDot} aria-hidden="true" /> Есть подходящее окно</span>}
      </>}
    </div>}
  </>;
}
