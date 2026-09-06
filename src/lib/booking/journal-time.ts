import { assertLocalDate, assertLocalTime, formatLocalDate, formatLocalTime, zonedLocalToUtc } from "./timezone";

const JOURNAL_LOCAL_PATTERN = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::\d{2})?$/u;

function localParts(value: string) {
  const match = value.trim().match(JOURNAL_LOCAL_PATTERN);
  if (!match) return null;
  return { date: assertLocalDate(match[1]), time: assertLocalTime(match[2]) };
}

/** Convert a UTC instant to the branch-local value expected by datetime-local. */
export function utcInstantToJournalLocal(value: string | Date, timeZone: string) {
  const instant = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(instant.getTime())) return "";
  return `${formatLocalDate(instant, timeZone)}T${formatLocalTime(instant, timeZone)}`;
}

/** Convert a branch-local wall-clock value to its unique UTC instant. */
export function journalLocalToUtcIso(value: string, timeZone: string) {
  const parts = localParts(value);
  if (!parts) return "";
  return zonedLocalToUtc(parts.date, parts.time, timeZone).toISOString();
}

/** Calendar arithmetic for datetime-local values, independent of the machine timezone. */
export function addMinutesToJournalLocal(value: string, minutes: number) {
  const parts = localParts(value);
  if (!parts || !Number.isFinite(minutes)) return "";
  const [year, month, day] = parts.date.split("-").map(Number);
  const [hour, minute] = parts.time.split(":").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day, hour, minute + Math.trunc(minutes)));
  return `${shifted.toISOString().slice(0, 10)}T${shifted.toISOString().slice(11, 16)}`;
}

export function journalLocalDurationMinutes(startValue: string, endValue: string) {
  const start = localParts(startValue);
  const end = localParts(endValue);
  if (!start || !end) return null;
  const asMinute = (parts: { date: string; time: string }) => {
    const [year, month, day] = parts.date.split("-").map(Number);
    const [hour, minute] = parts.time.split(":").map(Number);
    return Date.UTC(year, month - 1, day, hour, minute) / 60_000;
  };
  const duration = asMinute(end) - asMinute(start);
  return duration > 0 ? duration : null;
}

export function journalLocalDate(value: string) {
  return localParts(value)?.date ?? "";
}

export function journalLocalTime(value: string) {
  return localParts(value)?.time ?? "";
}
