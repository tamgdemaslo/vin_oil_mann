"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
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
  // The key keeps the visible month in sync with dates chosen through “nearest days”.
  return <MonthCalendar key={value.slice(0, 7)} value={value} today={today} max={max} onChange={onChange} />;
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
  return <section className={styles.calendar} aria-label="Дата визита">
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
  </section>;
}
