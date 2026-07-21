const YCLIENTS_API_BASE = "https://api.yclients.com/api/v1";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function collectRecords(value: unknown, depth = 0): JsonRecord[] {
  if (depth > 5) return [];
  if (Array.isArray(value)) return value.flatMap((item) => collectRecords(item, depth + 1));
  if (!value || typeof value !== "object") return [];
  const current = record(value);
  const nested = Object.values(current).flatMap((item) => collectRecords(item, depth + 1));
  return [current, ...nested];
}

function clean(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function config() {
  return {
    companyId: process.env.YCLIENTS_COMPANY_ID?.trim() || "9354",
    partnerToken: process.env.YCLIENTS_PARTNER_TOKEN?.trim() || "",
    userToken: process.env.YCLIENTS_USER_TOKEN?.trim() || "",
    serviceId: process.env.YCLIENTS_AI_SERVICE_ID?.trim() || "",
    staffId: process.env.YCLIENTS_AI_STAFF_ID?.trim() || "",
    branchAddress: process.env.YCLIENTS_AI_BRANCH_ADDRESS?.trim() || "Дачная, 6В",
  };
}

async function requestJson(path: string, options?: { user?: boolean; method?: string; body?: unknown }) {
  const cfg = config();
  if (!cfg.partnerToken) throw new Error("YCLIENTS_PARTNER_TOKEN не задан");
  if (options?.user && !cfg.userToken) throw new Error("YCLIENTS_USER_TOKEN не задан");
  const authorization = options?.user ? `Bearer ${cfg.partnerToken}, User ${cfg.userToken}` : `Bearer ${cfg.partnerToken}`;
  const response = await fetch(`${YCLIENTS_API_BASE}${path}`, {
    method: options?.method ?? "GET",
    headers: {
      Authorization: authorization,
      Accept: "application/vnd.yclients.v2+json",
      "Content-Type": "application/json",
    },
    body: options?.body === undefined ? undefined : JSON.stringify(options.body),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = clean(record(data).error) || clean(record(record(data).meta).message) || `YCLIENTS: HTTP ${response.status}`;
    throw new Error(message);
  }
  return data;
}

function isoDate(value: unknown) {
  return clean(value).match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1] ?? "";
}

function timeValue(row: JsonRecord) {
  const direct = clean(row.time) || clean(row.seance_time);
  const directMatch = direct.match(/^(\d{1,2}):(\d{2})/);
  if (directMatch) return `${directMatch[1].padStart(2, "0")}:${directMatch[2]}`;
  const datetime = clean(row.datetime) || clean(row.date);
  const datetimeMatch = datetime.match(/[T\s](\d{1,2}):(\d{2})/);
  return datetimeMatch ? `${datetimeMatch[1].padStart(2, "0")}:${datetimeMatch[2]}` : "";
}

function minutesFromTime(value: string) {
  const match = value.match(/^(\d{2}):(\d{2})$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/**
 * The booking endpoint returns starts suitable for the configured base service.
 * For a complex visit we must ensure several consecutive booking intervals are
 * still available; simply relabelling a 40-minute slot as a 2-hour one creates
 * overlapping appointments.
 */
function continuousStartsForDuration(
  rows: Array<{ time: string; row: JsonRecord }>,
  durationMinutes: number,
  baseServiceDurationMinutes: number
) {
  if (rows.length < 2 || durationMinutes <= baseServiceDurationMinutes) return rows;
  const minuteValues = rows.map(({ time }) => minutesFromTime(time)).filter((value): value is number => value != null);
  const deltas = minuteValues
    .slice(1)
    .map((value, index) => value - minuteValues[index])
    .filter((value) => value > 0 && value <= 120);
  const bookingStepMinutes = deltas.length ? Math.min(...deltas) : baseServiceDurationMinutes;
  const segments = Math.max(1, Math.ceil(durationMinutes / Math.max(10, baseServiceDurationMinutes)));
  const available = new Set(minuteValues);
  return rows.filter(({ time }) => {
    const start = minutesFromTime(time);
    if (start == null) return false;
    for (let segment = 1; segment < segments; segment += 1) {
      if (!available.has(start + segment * bookingStepMinutes)) return false;
    }
    return true;
  });
}

function datesFromBookingResponse(value: unknown, depth = 0): string[] {
  if (depth > 5) return [];
  if (typeof value === "string") {
    const date = isoDate(value);
    return date ? [date] : [];
  }
  if (Array.isArray(value)) return value.flatMap((item) => datesFromBookingResponse(item, depth + 1));
  if (!value || typeof value !== "object") return [];
  return Object.entries(record(value)).flatMap(([key, item]) => {
    const keyDate = isoDate(key);
    return keyDate ? [keyDate, ...datesFromBookingResponse(item, depth + 1)] : datesFromBookingResponse(item, depth + 1);
  });
}

export type AgentBookingSlot = {
  id: string;
  datetime: string;
  date: string;
  time: string;
  staffId: string;
  serviceId: string;
  address: string;
  durationMinutes: number;
  source: "yclients";
};

export async function getYclientsAvailableSlots(input: {
  limit: number;
  minLeadMinutes: number;
  horizonDays: number;
  durationMinutes: number;
  baseServiceDurationMinutes?: number;
  requestedDate?: string | null;
}): Promise<AgentBookingSlot[]> {
  const cfg = config();
  if (!cfg.serviceId || !cfg.staffId) {
    throw new Error("Для записи задайте YCLIENTS_AI_SERVICE_ID и YCLIENTS_AI_STAFF_ID");
  }
  const datesParams = new URLSearchParams();
  datesParams.set("staff_id", cfg.staffId);
  datesParams.set("service_ids[]", cfg.serviceId);
  const datesData = await requestJson(`/book_dates/${cfg.companyId}?${datesParams.toString()}`);
  const today = new Date();
  const horizon = new Date(today.getTime() + input.horizonDays * 86_400_000);
  const bookingData = record(record(datesData).data);
  const declaredDates = [
    ...(Array.isArray(bookingData.booking_dates) ? bookingData.booking_dates : []),
    ...(Array.isArray(bookingData.working_dates) ? bookingData.working_dates : []),
  ];
  const dates = [...new Set((declaredDates.length ? declaredDates.flatMap(isoDate) : datesFromBookingResponse(datesData)).filter(Boolean))]
    .filter((date) => {
      const parsed = new Date(`${date}T23:59:59`);
      return parsed >= today && parsed <= horizon && (!input.requestedDate || date >= input.requestedDate);
    })
    .sort()
    .slice(0, 7);

  const slots: AgentBookingSlot[] = [];
  for (const date of dates) {
    const timeParams = new URLSearchParams();
    timeParams.set("service_ids[]", cfg.serviceId);
    const timeData = await requestJson(`/book_times/${cfg.companyId}/${cfg.staffId}/${date}?${timeParams.toString()}`);
    const timeRows = collectRecords(timeData)
      .map((row) => ({ row, time: timeValue(row) }))
      .filter((item) => Boolean(item.time))
      .sort((left, right) => left.time.localeCompare(right.time));
    const uniqueTimeRows = timeRows.filter((item, index) => index === 0 || item.time !== timeRows[index - 1].time);
    const supportedStarts = continuousStartsForDuration(
      uniqueTimeRows,
      input.durationMinutes,
      input.baseServiceDurationMinutes ?? 45
    );
    for (const { time } of supportedStarts) {
      const datetime = `${date}T${time}:00`;
      if (new Date(datetime).getTime() < Date.now() + input.minLeadMinutes * 60_000) continue;
      const id = `yclients:${cfg.staffId}:${cfg.serviceId}:${date}:${time}`;
      if (slots.some((slot) => slot.id === id)) continue;
      slots.push({
        id,
        datetime,
        date,
        time,
        staffId: cfg.staffId,
        serviceId: cfg.serviceId,
        address: cfg.branchAddress,
        durationMinutes: input.durationMinutes,
        source: "yclients",
      });
      if (slots.length >= input.limit) return slots;
    }
  }
  return slots;
}

export function parseYclientsSlotId(slotId: string) {
  const match = slotId.match(/^yclients:([^:]+):([^:]+):(20\d{2}-\d{2}-\d{2}):(\d{2}:\d{2})$/);
  if (!match) throw new Error("Неизвестный идентификатор окна записи");
  return { staffId: match[1], serviceId: match[2], date: match[3], time: match[4] };
}

export async function createYclientsAppointment(input: {
  slotId: string;
  clientName: string;
  clientPhone: string;
  durationMinutes: number;
  comment: string;
}) {
  const cfg = config();
  const slot = parseYclientsSlotId(input.slotId);
  const payload = {
    staff_id: Number(slot.staffId),
    services: [{ id: Number(slot.serviceId) }],
    client: { name: input.clientName, phone: input.clientPhone },
    datetime: `${slot.date} ${slot.time}:00`,
    seance_length: input.durationMinutes * 60,
    comment: input.comment,
    save_if_busy: false,
    send_sms: false,
    api_id: "eco_ai_agent",
  };
  const data = await requestJson(`/record/${cfg.companyId}`, { user: true, method: "POST", body: payload });
  const rows = collectRecords(data);
  const id = rows.map((row) => clean(row.id) || clean(row.record_id)).find(Boolean);
  if (!id) throw new Error("YCLIENTS не вернул идентификатор созданной записи");
  return {
    id,
    datetime: `${slot.date}T${slot.time}:00`,
    address: cfg.branchAddress,
    source: "yclients",
  };
}
