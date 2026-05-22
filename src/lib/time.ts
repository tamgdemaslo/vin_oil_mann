const APP_TZ = process.env.APP_TIMEZONE ?? "Europe/Moscow";

function getDateTimeParts(dt: Date, timeZone: string): {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
} {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(dt)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );

  return {
    year: parts.year ?? "1970",
    month: parts.month ?? "01",
    day: parts.day ?? "01",
    hour: parts.hour ?? "00",
    minute: parts.minute ?? "00",
    second: parts.second ?? "00",
  };
}

/** Возвращает локальную дату YYYY-MM-DD для момента dt в часовом поясе приложения */
export function toLocalDateString(dt: Date): string {
  const parts = getDateTimeParts(dt, APP_TZ);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Возвращает локальные дату и время в формате МойСклад: YYYY-MM-DD HH:mm:ss */
export function toMoyskladMomentString(dt = new Date()): string {
  const parts = getDateTimeParts(dt, APP_TZ);
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

/** Возвращает локальные дату и время для AQSI без UTC-сдвига: YYYY-MM-DDTHH:mm:ss */
export function toAqsiDateTimeString(dt = new Date()): string {
  return toMoyskladMomentString(dt).replace(" ", "T");
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
