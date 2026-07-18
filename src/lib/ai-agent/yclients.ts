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
  if (/^\d{2}:\d{2}/.test(direct)) return direct.slice(0, 5);
  const datetime = clean(row.datetime) || clean(row.date);
  return datetime.match(/[T\s](\d{2}:\d{2})/)?.[1] ?? "";
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
  const dates = [...new Set(collectRecords(datesData).flatMap((row) => Object.values(row).map(isoDate)).filter(Boolean))]
    .filter((date) => {
      const parsed = new Date(`${date}T23:59:59`);
      return parsed >= today && parsed <= horizon;
    })
    .sort()
    .slice(0, 7);

  const slots: AgentBookingSlot[] = [];
  for (const date of dates) {
    const timeParams = new URLSearchParams();
    timeParams.set("service_ids[]", cfg.serviceId);
    const timeData = await requestJson(`/book_times/${cfg.companyId}/${cfg.staffId}/${date}?${timeParams.toString()}`);
    for (const row of collectRecords(timeData)) {
      const time = timeValue(row);
      if (!time) continue;
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
