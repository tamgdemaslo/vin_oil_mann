import { listClientAppointments } from "@/lib/client-site-api";
import {
  appointmentDateTime,
  appointmentServiceDate,
  arrayValue,
  asRecord,
  stringValue,
  type AppointmentLike,
} from "@/lib/appointment-shipment-reconcile";
import { getYclientsBranchConfig, type YclientsBranchConfig } from "@/lib/yclients/branch-config";

type YclientsStaff = {
  id?: string | number;
  name?: string;
  bookable?: boolean;
};

const YCLIENTS_USER_TOKEN_TTL_MS = 50 * 60 * 1000;

const yclientsRuntimeUserTokens = new Map<string, { token: string; at: number }>();

function extractYclientsUserToken(data: unknown): string | null {
  const record = asRecord(data);
  const direct = stringValue(record.user_token);
  if (direct) return direct;
  const nested = stringValue(asRecord(record.data).user_token);
  return nested || null;
}

async function fetchYclientsUserToken(config: YclientsBranchConfig) {
  if (!config.userLogin || !config.userPassword) return null;
  try {
    const res = await fetch(`${config.apiBase}/auth`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.partnerToken}`,
        Accept: "application/vnd.yclients.v2+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ login: config.userLogin, password: config.userPassword }),
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return null;
    return extractYclientsUserToken(data);
  } catch {
    return null;
  }
}

async function resolveYclientsAuthHeader(config: YclientsBranchConfig, needsUserToken: boolean) {
  if (!needsUserToken) return `Bearer ${config.partnerToken}`;
  if (config.userToken) return `Bearer ${config.partnerToken}, User ${config.userToken}`;
  const cached = yclientsRuntimeUserTokens.get(config.branchId);
  if (
    cached?.token &&
    Date.now() - cached.at <= YCLIENTS_USER_TOKEN_TTL_MS
  ) {
    return `Bearer ${config.partnerToken}, User ${cached.token}`;
  }
  const token = await fetchYclientsUserToken(config);
  if (!token) return null;
  yclientsRuntimeUserTokens.set(config.branchId, { token, at: Date.now() });
  return `Bearer ${config.partnerToken}, User ${token}`;
}

async function yclientsData(config: YclientsBranchConfig, path: string, needsUserToken: boolean) {
  const auth = await resolveYclientsAuthHeader(config, needsUserToken);
  if (!auth) return null;
  try {
    const res = await fetch(`${config.apiBase}${path}`, {
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
  const config = await getYclientsBranchConfig();
  const staffJson = await yclientsData(config, `/book_staff/${config.companyId}`, false);
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
      const data = await yclientsData(config, `/records/${config.companyId}?${params.toString()}`, true);
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
