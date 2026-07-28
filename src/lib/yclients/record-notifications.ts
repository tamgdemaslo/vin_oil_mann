import {
  appointmentCreationNotificationExists,
  handleAppointmentCreated,
} from "@/lib/client-notifications/client-notifications";
import { parseServiceDateTime, toServiceDateInput } from "@/lib/date-time";
import { getYclientsBranchConfig, type YclientsBranchConfig } from "@/lib/yclients/branch-config";

const USER_TOKEN_TTL_MS = 50 * 60 * 1000;
const RECENT_YCLIENTS_RECORD_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_SYNCED_RECORD_NOTIFICATIONS = 10;
const DEFAULT_SYNC_DAYS_AHEAD = 60;
const DEFAULT_SYNC_PAGE_COUNT = 200;
const DEFAULT_SYNC_MAX_PAGES = 3;

type YclientsAuthCache = {
  token: string;
  at: number;
};

const authCacheByBranch = new Map<string, YclientsAuthCache>();

type SyncOptions = {
  companyId?: string | number | null;
  startDate?: string | null;
  endDate?: string | null;
  count?: number | null;
  maxPages?: number | null;
  maxNotifications?: number | null;
};

type SyncCounters = {
  checked: number;
  notified: number;
  skippedExisting: number;
  skippedNotRecent: number;
  skippedNoId: number;
  errors: Array<{ appointmentId: string | null; message: string }>;
  reachedLimit: boolean;
};

export type YclientsRecordNotificationSyncResult = {
  ok: boolean;
  companyId: string;
  startDate: string;
  endDate: string;
  pages: number;
  checked: number;
  notified: number;
  skippedExisting: number;
  skippedNotRecent: number;
  skippedNoId: number;
  reachedLimit: boolean;
  errors: Array<{ appointmentId: string | null; message: string }>;
  status?: number;
  error?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function numberValue(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function idStringValue(value: unknown): string | undefined {
  const text = stringValue(value);
  if (text) return text;
  const number = numberValue(value);
  return number ? String(number) : undefined;
}

function boundedPositiveInteger(value: number | null | undefined, fallback: number, max: number) {
  if (!Number.isFinite(value ?? NaN) || !value || value < 1) return fallback;
  return Math.min(Math.floor(value), max);
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function parseYclientsDate(value: unknown): Date | null {
  const text = stringValue(value);
  if (!text) return null;
  const withColonOffset = text.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  return parseServiceDateTime(withColonOffset) ?? parseServiceDateTime(withColonOffset.replace(" ", "T"));
}

function yclientsClientName(client: Record<string, unknown>, record: Record<string, unknown>) {
  const parts = [client.surname, client.name, client.patronymic].map(stringValue).filter(Boolean);
  return (
    stringValue(client.display_name) ||
    parts.join(" ") ||
    stringValue(client.name) ||
    stringValue(record.name) ||
    stringValue(record.fullname) ||
    null
  );
}

function yclientsServiceList(record: Record<string, unknown>) {
  return arrayValue(record.services)
    .map((service) => (isRecord(service) ? stringValue(service.title) || stringValue(service.name) || idStringValue(service.id) : stringValue(service)))
    .filter(Boolean)
    .join(", ");
}

function appointmentContextFromYclientsRecord(record: Record<string, unknown>, fallbackId?: string | null) {
  const client = isRecord(record.client) ? record.client : {};
  const staff = isRecord(record.staff) ? record.staff : {};
  const comment = stringValue(record.comment) ?? "";
  const vehicleMatch = comment.match(/(?:VIN|vin|ВИН|госномер|авто)[:\s]+([A-Za-zА-Яа-я0-9 ._-]{3,40})/);
  const appointmentId = fallbackId ?? idStringValue(record.id) ?? idStringValue(record.record_id) ?? null;
  return {
    appointmentId,
    appointmentAt: stringValue(record.datetime) || stringValue(record.date) || null,
    clientName: yclientsClientName(client, record),
    clientPhone: stringValue(client.phone) || stringValue(record.phone) || null,
    clientEmail: stringValue(client.email) || stringValue(record.email) || null,
    serviceList: yclientsServiceList(record) || null,
    car: vehicleMatch?.[1]?.trim() || null,
    masterName: stringValue(staff.name) || null,
    status:
      record.attendance === 1 || record.visit_attendance === 1
        ? "arrived"
        : stringValue(record.status) || stringValue(record.state) || null,
    payload: {
      sourceId: appointmentId,
      yclientsRecordId: appointmentId,
      yclientsVisitId: idStringValue(record.visit_id) || null,
      recordFrom: stringValue(record.record_from) || null,
      online: Boolean(record.online),
      bookformId: numberValue(record.bookform_id),
      shortLink: stringValue(record.short_link) || null,
      reviewLink: stringValue(record.review_link) || null,
    },
  };
}

function yclientsRecordSource(record: Record<string, unknown>): "client" | "admin" {
  if (record.online || record.bookform_id || stringValue(record.from_url) || numberValue(record.created_user_id) === 0) {
    return "client";
  }
  return "admin";
}

function isRecentFutureYclientsRecord(record: Record<string, unknown>, now = new Date()) {
  if (record.deleted === true) return false;
  const createdAt = parseYclientsDate(record.create_date ?? record.created ?? record.date_created);
  if (!createdAt) return false;
  const createdDelta = now.getTime() - createdAt.getTime();
  if (createdDelta < -5 * 60_000 || createdDelta > RECENT_YCLIENTS_RECORD_WINDOW_MS) return false;

  const appointmentAt = parseYclientsDate(record.datetime ?? record.date);
  if (appointmentAt && appointmentAt.getTime() < now.getTime() - 30 * 60_000) return false;
  return true;
}

function extractUserToken(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const root = data as { user_token?: unknown; data?: { user_token?: unknown } };
  const direct = typeof root.user_token === "string" ? root.user_token.trim() : "";
  if (direct) return direct;
  const nested = typeof root.data?.user_token === "string" ? root.data.user_token.trim() : "";
  return nested || null;
}

function yclientsErrorMessage(data: unknown, fallback: string) {
  if (!isRecord(data)) return fallback;
  return (
    stringValue(data.error) ||
    (isRecord(data.meta) ? stringValue(data.meta.message) : undefined) ||
    stringValue(data.message) ||
    fallback
  );
}

async function fetchUserTokenByCredentials(
  config: YclientsBranchConfig,
  login: string,
  password: string
): Promise<{ token: string | null; error?: string }> {
  try {
    const res = await fetch(`${config.apiBase}/auth`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.partnerToken}`,
        Accept: "application/vnd.yclients.v2+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ login, password }),
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));
    const token = extractUserToken(data);
    if (!res.ok || !token) {
      return { token: null, error: yclientsErrorMessage(data, "Не удалось получить user token") };
    }
    return { token };
  } catch (error) {
    return { token: null, error: error instanceof Error ? error.message : "Ошибка авторизации YCLIENTS" };
  }
}

async function resolveAuthHeader(config: YclientsBranchConfig): Promise<{ header: string | null; authError?: string }> {
  if (config.userToken) return { header: `Bearer ${config.partnerToken}, User ${config.userToken}` };

  const cached = authCacheByBranch.get(config.branchId);
  if (cached && Date.now() - cached.at <= USER_TOKEN_TTL_MS && cached.token) {
    return { header: `Bearer ${config.partnerToken}, User ${cached.token}` };
  }

  if (!config.userLogin || !config.userPassword) {
    return {
      header: null,
      authError:
        "Для синхронизации записей настройте userToken или пару userLogin/userPassword интеграции YCLIENTS активного филиала.",
    };
  }

  const auth = await fetchUserTokenByCredentials(config, config.userLogin, config.userPassword);
  if (!auth.token) return { header: null, authError: auth.error ?? "Не удалось получить user token" };
  authCacheByBranch.set(config.branchId, { token: auth.token, at: Date.now() });
  return { header: `Bearer ${config.partnerToken}, User ${auth.token}` };
}

async function yclientsJsonRequest(config: YclientsBranchConfig, path: string) {
  const resolved = await resolveAuthHeader(config);
  if (!resolved.header) {
    return { ok: false, status: 401, data: null, error: resolved.authError ?? "YCLIENTS токен не задан" };
  }

  try {
    const response = await fetch(`${config.apiBase}${path}`, {
      headers: {
        Authorization: resolved.header,
        Accept: "application/vnd.yclients.v2+json",
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        data,
        error: yclientsErrorMessage(data, "Ошибка запроса к YCLIENTS"),
      };
    }
    return { ok: true, status: response.status, data, error: null };
  } catch (error) {
    return {
      ok: false,
      status: 500,
      data: null,
      error: error instanceof Error ? error.message : "Ошибка запроса к YCLIENTS",
    };
  }
}

async function notifyRecentYclientsRecords(
  data: unknown,
  options: { maxNotifications: number; counters: SyncCounters }
) {
  const root = isRecord(data) ? data : {};
  const records = arrayValue(root.data).filter(isRecord);
  const now = new Date();

  for (const record of records) {
    options.counters.checked += 1;
    if (options.counters.notified >= options.maxNotifications) {
      options.counters.reachedLimit = true;
      break;
    }
    if (!isRecentFutureYclientsRecord(record, now)) {
      options.counters.skippedNotRecent += 1;
      continue;
    }

    const appointmentId = idStringValue(record.id) || idStringValue(record.record_id) || null;
    if (!appointmentId) {
      options.counters.skippedNoId += 1;
      continue;
    }
    if (await appointmentCreationNotificationExists(appointmentId)) {
      options.counters.skippedExisting += 1;
      continue;
    }

    try {
      await handleAppointmentCreated({
        source: yclientsRecordSource(record),
        ...appointmentContextFromYclientsRecord(record, appointmentId),
        initiatedById: "yclients-sync",
      });
      options.counters.notified += 1;
    } catch (error) {
      options.counters.errors.push({
        appointmentId,
        message: error instanceof Error ? error.message : "Не удалось создать уведомление",
      });
    }
  }
}

export async function syncRecentYclientsRecordNotifications(
  options: SyncOptions = {}
): Promise<YclientsRecordNotificationSyncResult> {
  const config = await getYclientsBranchConfig();
  const companyId = config.companyId;
  if (options.companyId != null && String(options.companyId).trim() !== companyId) {
    throw new Error("YCLIENTS companyId does not belong to the active branch integration");
  }
  const now = new Date();
  const startDate = options.startDate?.trim() || toServiceDateInput(addDays(now, -1));
  const endDate =
    options.endDate?.trim() ||
    toServiceDateInput(addDays(now, DEFAULT_SYNC_DAYS_AHEAD));
  const count = boundedPositiveInteger(options.count, DEFAULT_SYNC_PAGE_COUNT, 500);
  const maxPages = boundedPositiveInteger(options.maxPages, DEFAULT_SYNC_MAX_PAGES, 10);
  const maxNotifications = boundedPositiveInteger(
    options.maxNotifications,
    MAX_SYNCED_RECORD_NOTIFICATIONS,
    50
  );
  const counters: SyncCounters = {
    checked: 0,
    notified: 0,
    skippedExisting: 0,
    skippedNotRecent: 0,
    skippedNoId: 0,
    errors: [],
    reachedLimit: false,
  };

  if (!companyId) {
    return {
      ok: false,
      companyId,
      startDate,
      endDate,
      pages: 0,
      ...counters,
      status: 400,
      error: "Не удалось определить company_id",
    };
  }

  let pages = 0;
  for (let page = 1; page <= maxPages; page += 1) {
    const params = new URLSearchParams({
      page: String(page),
      count: String(count),
      start_date: startDate,
      end_date: endDate,
    });
    const response = await yclientsJsonRequest(config, `/records/${companyId}?${params.toString()}`);
    pages = page;
    if (!response.ok) {
      return {
        ok: false,
        companyId,
        startDate,
        endDate,
        pages,
        ...counters,
        status: response.status,
        error: response.error ?? "Ошибка запроса к YCLIENTS",
      };
    }

    await notifyRecentYclientsRecords(response.data, { maxNotifications, counters });
    const records = isRecord(response.data) ? arrayValue(response.data.data) : [];
    if (records.length < count || counters.reachedLimit) break;
  }

  return {
    ok: counters.errors.length === 0,
    companyId,
    startDate,
    endDate,
    pages,
    ...counters,
    error: counters.errors.length ? "Часть уведомлений не создана" : undefined,
  };
}
