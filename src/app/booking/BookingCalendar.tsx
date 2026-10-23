"use client";

import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";
import { useId, useRef, useState } from "react";
import styles from "./booking.module.css";

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
function monthDate(month: string, offset = 0) {
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year, number - 1 + offset, 1, 12));
}
function iso(date: Date) { return date.toISOString().slice(0, 10); }

export default function BookingCalendar({ value, today, max, onChange }: {
  value: string; today: string; max: string; onChange: (date: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
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
      <MonthCalendar key={value.slice(0, 7)} value={value} today={today} max={max} onChange={chooseDate} />
    </div>
    <button ref={toggleRef} type="button" className={expanded ? styles.calendarCollapse : styles.calendarExpand}
      aria-expanded={expanded} aria-controls={calendarId} onClick={toggleCalendar}>
      {expanded ? <><ChevronUp aria-hidden /><span>Свернуть календарь</span></> : <><strong>{selectedDate}</strong><span>Изменить дату</span><ChevronDown aria-hidden /></>}
    </button>
  </section>;
}

function MonthCalendar({ value, today, max, onChange }: {
  value: string; today: string; max: string; onChange: (date: string) => void;
}) {
  const [month, setMonth] = useState(value.slice(0, 7));
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
    <div className={styles.calendarDays}>
      {Array.from({ length: cells }, (_, index) => {
        const date = new Date(first);
        date.setUTCDate(1 - offset + index);
        const dateValue = iso(date), outside = dateValue.slice(0, 7) !== month;
        const fullLabel = new Intl.DateTimeFormat("ru-RU", { dateStyle: "full", timeZone: "UTC" }).format(date);
        return <button type="button" key={dateValue} disabled={outside || dateValue < today || dateValue > max}
          className={value === dateValue ? styles.calendarSelected : outside ? styles.calendarOutside : undefined}
          aria-label={fullLabel} aria-pressed={value === dateValue} aria-current={dateValue === today ? "date" : undefined}
          onClick={() => onChange(dateValue)}>{date.getUTCDate()}</button>;
      })}
    </div>
  </>;
}
