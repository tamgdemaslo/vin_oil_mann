const APP_TZ = process.env.APP_TIMEZONE ?? "Europe/Moscow";

/** Возвращает локальную дату YYYY-MM-DD для момента dt в часовом поясе приложения */
export function toLocalDateString(dt: Date): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(dt);
}

/** Возвращает начало рабочего дня (час, минута) для даты: будни 09:00, выходные 10:00 */
export function getWorkdayStart(date: Date): { hours: number; minutes: number } {
  const day = date.getDay();
  const isWeekend = day === 0 || day === 6;
  return isWeekend ? { hours: 10, minutes: 0 } : { hours: 9, minutes: 0 };
}

/** Проверяет, является ли дата (локальная) выходным */
export function isWeekend(dateStr: string): boolean {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const day = date.getDay();
  return day === 0 || day === 6;
}

/** Локальная дата «вчера» в поясе приложения */
export function getYesterdayLocal(): string {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const today = formatter.format(now);
  const d = new Date(today + "T12:00:00");
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Текущий момент в поясе приложения — дата и время для сравнения с началом рабочего дня */
export function nowInAppTz(): Date {
  const str = new Date().toLocaleString("sv-SE", { timeZone: APP_TZ });
  return new Date(str);
}
