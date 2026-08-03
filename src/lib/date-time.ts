export const SERVICE_TIME_ZONE =
  process.env.NEXT_PUBLIC_APP_TIMEZONE?.trim() ||
  process.env.APP_TIMEZONE?.trim() ||
  "Europe/Moscow";

type DateTimeInput = Date | string | number | null | undefined;

type DateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function dateFromInput(value: DateTimeInput): Date | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const raw = value.trim();
  if (!raw) return null;
  const hasExplicitZone = /(?:z|[+-]\d{2}:?\d{2})$/i.test(raw);
  if (hasExplicitZone) {
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const serviceParts = parseServiceDateTimeParts(raw);
  if (serviceParts) return serviceDateTimeToUtc(serviceParts);
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseServiceDateTimeParts(value: string): DateTimeParts | null {
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?)?$/
  );
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4] ?? "0");
  const minute = Number(match[5] ?? "0");
  const second = Number(match[6] ?? "0");
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59
  ) {
    return null;
  }
  return { year, month, day, hour, minute, second };
}

function getPartsInServiceTime(date: Date): DateTimeParts {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: SERVICE_TIME_ZONE,
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
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)])
  );
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

function timeZoneOffsetMs(date: Date): number {
  const parts = getPartsInServiceTime(date);
  const localAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return localAsUtc - date.getTime();
}

export function serviceDateTimeToUtc(parts: DateTimeParts): Date {
  const localAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  const first = new Date(localAsUtc - timeZoneOffsetMs(new Date(localAsUtc)));
  const second = new Date(localAsUtc - timeZoneOffsetMs(first));
  return second;
}

export function parseServiceDateTime(value: DateTimeInput): Date | null {
  return dateFromInput(value);
}

export function toUtcIsoString(value: DateTimeInput = new Date()): string {
  return (dateFromInput(value) ?? new Date()).toISOString();
}

export function toServiceDateInput(value: DateTimeInput = new Date()): string {
  const date = dateFromInput(value) ?? new Date();
  const parts = getPartsInServiceTime(date);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

export function toServiceMomentString(value: DateTimeInput = new Date()): string {
  const date = dateFromInput(value) ?? new Date();
  const parts = getPartsInServiceTime(date);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)} ${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`;
}

export function formatServiceDate(value: DateTimeInput): string {
  const date = dateFromInput(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: SERVICE_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

export function formatServiceTime(value: DateTimeInput): string {
  const date = dateFromInput(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: SERVICE_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

export function formatServiceDateTime(value: DateTimeInput): string {
  const date = dateFromInput(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: SERVICE_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

export function formatServiceDayMonth(value: DateTimeInput): string {
  const date = dateFromInput(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: SERVICE_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
  }).format(date);
}
