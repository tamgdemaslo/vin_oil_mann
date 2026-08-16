import { BookingError } from "./errors";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

function formatter(timeZone: string, includeTime = true) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      ...(includeTime ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" as const } : {}),
    });
  } catch {
    throw new BookingError("У филиала указана некорректная таймзона", "booking_timezone_invalid", 500);
  }
}

function partsAt(value: Date, timeZone: string): ZonedParts {
  const values = Object.fromEntries(
    formatter(timeZone).formatToParts(value).map((part) => [part.type, part.value]),
  );
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
  };
}

export function assertLocalDate(value: string) {
  if (!DATE_PATTERN.test(value)) {
    throw new BookingError("Дата должна быть в формате ГГГГ-ММ-ДД", "booking_date_invalid");
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new BookingError("Указана несуществующая дата", "booking_date_invalid");
  }
  return value;
}

export function assertLocalTime(value: string) {
  if (!TIME_PATTERN.test(value)) {
    throw new BookingError("Время должно быть в формате ЧЧ:ММ", "booking_time_invalid");
  }
  return value;
}

export function localTimeToMinutes(value: string) {
  assertLocalTime(value);
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function minutesToLocalTime(value: number) {
  const normalized = Math.max(0, Math.min(1439, Math.floor(value)));
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

export function addLocalDays(localDate: string, days: number) {
  assertLocalDate(localDate);
  const date = new Date(`${localDate}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function localDateIsoWeekday(localDate: string) {
  assertLocalDate(localDate);
  const day = new Date(`${localDate}T12:00:00.000Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

export function zonedLocalToUtc(localDate: string, localTime: string, timeZone: string) {
  assertLocalDate(localDate);
  assertLocalTime(localTime);
  const [year, month, day] = localDate.split("-").map(Number);
  const [hour, minute] = localTime.split(":").map(Number);
  const desired = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let candidate = new Date(desired);

  for (let iteration = 0; iteration < 3; iteration += 1) {
    const represented = partsAt(candidate, timeZone);
    const representedUtc = Date.UTC(
      represented.year,
      represented.month - 1,
      represented.day,
      represented.hour,
      represented.minute,
    );
    const difference = desired - representedUtc;
    if (difference === 0) break;
    candidate = new Date(candidate.getTime() + difference);
  }

  const verified = partsAt(candidate, timeZone);
  if (
    verified.year !== year || verified.month !== month || verified.day !== day ||
    verified.hour !== hour || verified.minute !== minute
  ) {
    throw new BookingError("Это локальное время недоступно из-за перевода часов", "booking_local_time_unavailable");
  }
  return candidate;
}

export function formatLocalDate(value: Date, timeZone: string) {
  const parts = partsAt(value, timeZone);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function formatLocalTime(value: Date, timeZone: string) {
  const parts = partsAt(value, timeZone);
  return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

export function localDateUtcRange(localDate: string, timeZone: string) {
  return {
    start: zonedLocalToUtc(localDate, "00:00", timeZone),
    end: zonedLocalToUtc(addLocalDays(localDate, 1), "00:00", timeZone),
  };
}
