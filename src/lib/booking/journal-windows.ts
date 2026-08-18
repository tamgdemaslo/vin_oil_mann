export type JournalBusyInterval = {
  start: number;
  end: number;
};

export type JournalWorkingHours = {
  isWorking: boolean;
  startTime: string | null;
  endTime: string | null;
};

const DEFAULT_WINDOW_MINUTES = 60;

function parseLocalTime(value: string | null | undefined) {
  const match = String(value ?? "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function formatLocalTime(value: number) {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function buildJournalFreeWindows(
  hours: JournalWorkingHours | null | undefined,
  occupiedIntervals: JournalBusyInterval[],
  windowMinutes = DEFAULT_WINDOW_MINUTES,
) {
  if (!hours?.isWorking) return [];
  const dayStart = parseLocalTime(hours.startTime);
  const dayEnd = parseLocalTime(hours.endTime);
  const duration = Math.max(5, Math.min(Math.trunc(windowMinutes), 24 * 60));
  if (dayStart === null || dayEnd === null || dayStart >= dayEnd) return [];

  const windows: string[] = [];
  for (let start = dayStart; start + duration <= dayEnd; start += duration) {
    const end = start + duration;
    const occupied = occupiedIntervals.some((interval) => start < interval.end && end > interval.start);
    if (!occupied) windows.push(formatLocalTime(start));
  }
  return windows;
}
