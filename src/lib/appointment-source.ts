import { listClientAppointments } from "@/lib/client-site-api";
import {
  appointmentDateTime,
  appointmentServiceDate,
  arrayValue,
  asRecord,
  stringValue,
  type AppointmentLike,
} from "@/lib/appointment-shipment-reconcile";

type YclientsStaff = {
  id?: string | number;
  name?: string;
  bookable?: boolean;
};

const YCLIENTS_API_BASE = "https://api.yclients.com/api/v1";
const YCLIENTS_COMPANY_ID = process.env.YCLIENTS_COMPANY_ID ?? "9354";
const YCLIENTS_PARTNER_TOKEN = process.env.YCLIENTS_PARTNER_TOKEN ?? "mz5bf2yp97nbs4s45e9j";
const YCLIENTS_USER_TOKEN = process.env.YCLIENTS_USER_TOKEN?.trim() ?? "";
const YCLIENTS_USER_LOGIN = process.env.YCLIENTS_USER_LOGIN?.trim() ?? "";
const YCLIENTS_USER_PASSWORD = process.env.YCLIENTS_USER_PASSWORD?.trim() ?? "";
const YCLIENTS_USER_TOKEN_TTL_MS = 50 * 60 * 1000;

let yclientsRuntimeUserToken: { token: string; at: number } | null = null;

function extractYclientsUserToken(data: unknown): string | null {
  const record = asRecord(data);
  const direct = stringValue(record.user_token);
  if (direct) return direct;
  const nested = stringValue(asRecord(record.data).user_token);
  return nested || null;
}

async function fetchYclientsUserToken() {
  const partner = YCLIENTS_PARTNER_TOKEN.trim();
  if (!partner || !YCLIENTS_USER_LOGIN || !YCLIENTS_USER_PASSWORD) return null;
  try {
    const res = await fetch(`${YCLIENTS_API_BASE}/auth`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${partner}`,
        Accept: "application/vnd.yclients.v2+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ login: YCLIENTS_USER_LOGIN, password: YCLIENTS_USER_PASSWORD }),
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return null;
    return extractYclientsUserToken(data);
  } catch {
    return null;
  }
}

async function resolveYclientsAuthHeader(needsUserToken: boolean) {
  const partner = YCLIENTS_PARTNER_TOKEN.trim();
  if (!partner) return null;
  if (!needsUserToken) return `Bearer ${partner}`;
  if (YCLIENTS_USER_TOKEN) return `Bearer ${partner}, User ${YCLIENTS_USER_TOKEN}`;
  if (
    yclientsRuntimeUserToken?.token &&
    Date.now() - yclientsRuntimeUserToken.at <= YCLIENTS_USER_TOKEN_TTL_MS
  ) {
    return `Bearer ${partner}, User ${yclientsRuntimeUserToken.token}`;
  }
  const token = await fetchYclientsUserToken();
  if (!token) return null;
  yclientsRuntimeUserToken = { token, at: Date.now() };
  return `Bearer ${partner}, User ${token}`;
}

async function yclientsData(path: string, needsUserToken: boolean) {
  const auth = await resolveYclientsAuthHeader(needsUserToken);
  if (!auth) return null;
  try {
    const res = await fetch(`${YCLIENTS_API_BASE}${path}`, {
      headers: {
        Authorization: auth,
        Accept: "application/vnd.yclients.v2+json",
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return res.json().catch(() => null) as Promise<unknown>;
  } catch {
    return null;
  }
}

export async function listYclientsAppointmentsForDate(date: string): Promise<AppointmentLike[]> {
  const staffJson = await yclientsData(`/book_staff/${YCLIENTS_COMPANY_ID}`, false);
  const staffRows = arrayValue<YclientsStaff>(asRecord(staffJson).data);
  const bookable = staffRows.filter((staff) => staff.bookable !== false);
  const staffIds = (bookable.length ? bookable : staffRows)
    .slice(0, 4)
    .map((staff) => stringValue(staff.id))
    .filter(Boolean);
  if (staffIds.length === 0) return [];

  const responses = await Promise.all(
    staffIds.map(async (staffId) => {
      const params = new URLSearchParams({
        page: "1",
        count: "100",
        start_date: date,
        end_date: date,
        staff_id: staffId,
      });
      const data = await yclientsData(`/records/${YCLIENTS_COMPANY_ID}?${params.toString()}`, true);
      return arrayValue<AppointmentLike>(asRecord(data).data).map((record) => ({
        ...record,
        id: stringValue(record.id),
        source: "yclients",
      }));
    })
  );
  return responses.flat();
}

export async function listAppointmentRowsForDate(date: string): Promise<AppointmentLike[]> {
  const [yclientsAppointments, localAppointments] = await Promise.all([
    listYclientsAppointmentsForDate(date),
    Promise.resolve((listClientAppointments() as AppointmentLike[]).map((item) => ({ ...item, source: "local" }))),
  ]);
  const rawAppointments = [...yclientsAppointments, ...localAppointments].filter((item, index, arr) => {
    const id = stringValue(item.id);
    return id && arr.findIndex((candidate) => stringValue(candidate.id) === id) === index;
  });
  return rawAppointments
    .filter((item) => appointmentServiceDate(item) === date)
    .sort((a, b) => (appointmentDateTime(a)?.getTime() ?? 0) - (appointmentDateTime(b)?.getTime() ?? 0));
}

