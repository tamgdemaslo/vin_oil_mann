import {
  SERVICE_TIME_ZONE,
  formatServiceDate,
  parseServiceDateTime,
  serviceDateTimeToUtc,
  toServiceDateInput,
  toServiceMomentString,
} from "./date-time";

const APP_TZ = SERVICE_TIME_ZONE;

/** Возвращает локальную дату YYYY-MM-DD для момента dt в часовом поясе приложения */
export function toLocalDateString(dt: Date): string {
  return toServiceDateInput(dt);
}

/** Возвращает локальные дату и время для AQSI без UTC-сдвига: YYYY-MM-DDTHH:mm:ss */
export function toAqsiDateTimeString(dt = new Date()): string {
  return toServiceMomentString(dt).replace(" ", "T");
}

/** Возвращает начало рабочего дня (час, минута) для даты: будни 09:00, выходные 10:00 */
export function getWorkdayStart(date: Date): { hours: number; minutes: number } {
  const day = date.getDay();
  const isWeekend = day === 0 || day === 6;
  return isWeekend ? { hours: 10, minutes: 0 } : { hours: 9, minutes: 0 };
}

/** Проверяет, является ли дата (локальная) выходным */
export function isWeekend(dateStr: string): boolean {
  const parsed = parseServiceDateTime(`${dateStr} 12:00:00`);
  const label = parsed ? formatServiceDate(parsed) : "";
  if (!label) return false;
  const [day, month, year] = label.split(".").map(Number);
  const date = new Date(year, month - 1, day);
  const weekday = date.getDay();
  return weekday === 0 || weekday === 6;
}

/** Локальная дата «вчера» в поясе приложения */
export function getYesterdayLocal(): string {
  const today = toServiceDateInput(new Date());
  const [year, month, day] = today.split("-").map(Number);
  const yesterday = serviceDateTimeToUtc({ year, month, day: day - 1, hour: 12, minute: 0, second: 0 });
  return toServiceDateInput(yesterday);
}

/** Текущий момент в поясе приложения — дата и время для сравнения с началом рабочего дня */
export function nowInAppTz(): Date {
  const serviceNow = toServiceMomentString(new Date());
  return new Date(serviceNow.replace(" ", "T"));
}

export { APP_TZ, toServiceMomentString };
