import { NextRequest, NextResponse } from "next/server";
import {
  handleAppointmentCancelled,
  handleAppointmentCreated,
  handleAppointmentUpdated,
} from "@/lib/client-notifications/client-notifications";

const YCLIENTS_API_BASE = "https://api.yclients.com/api/v1";
const YCLIENTS_COMPANY_ID = process.env.YCLIENTS_COMPANY_ID ?? "9354";
const YCLIENTS_COMPANY_TITLE = process.env.YCLIENTS_COMPANY_TITLE ?? "Там где масло";
const YCLIENTS_PARTNER_TOKEN = process.env.YCLIENTS_PARTNER_TOKEN ?? "mz5bf2yp97nbs4s45e9j";
const YCLIENTS_USER_TOKEN = process.env.YCLIENTS_USER_TOKEN?.trim() ?? "";
const YCLIENTS_USER_LOGIN = process.env.YCLIENTS_USER_LOGIN?.trim() ?? "";
const YCLIENTS_USER_PASSWORD = process.env.YCLIENTS_USER_PASSWORD?.trim() ?? "";
const USER_TOKEN_TTL_MS = 50 * 60 * 1000;

let runtimeUserToken: { token: string; at: number } | null = null;

function extractUserToken(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const root = data as { user_token?: unknown; data?: { user_token?: unknown } };
  const direct = typeof root.user_token === "string" ? root.user_token.trim() : "";
  if (direct) return direct;
  const nested = typeof root.data?.user_token === "string" ? root.data.user_token.trim() : "";
  if (nested) return nested;
  return null;
}

async function fetchUserTokenByCredentials(
  login: string,
  password: string
): Promise<{ token: string | null; error?: string }> {
  const partner = YCLIENTS_PARTNER_TOKEN.trim();
  if (!partner) return { token: null, error: "YCLIENTS_PARTNER_TOKEN не задан" };
  try {
    const res = await fetch(`${YCLIENTS_API_BASE}/auth`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${partner}`,
        Accept: "application/vnd.yclients.v2+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ login, password }),
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));
    const token = extractUserToken(data);
    if (!res.ok || !token) {
      const metaError =
        (data as { meta?: { message?: string } })?.meta?.message ??
        (data as { error?: string })?.error ??
        "Не удалось получить user token";
      return { token: null, error: metaError };
    }
    return { token };
  } catch (error) {
    return { token: null, error: error instanceof Error ? error.message : "Ошибка авторизации YCLIENTS" };
  }
}

async function resolveAuthHeader(path: string): Promise<{ header: string | null; authError?: string }> {
  const partner = YCLIENTS_PARTNER_TOKEN.trim();
  if (!partner) return { header: null, authError: "YCLIENTS_PARTNER_TOKEN не задан" };
  const needsUserToken = /\/records\/|\/record\/|\/clients\/|\/company\/|\/timetable\//.test(path);
  if (!needsUserToken) return { header: `Bearer ${partner}` };
  if (YCLIENTS_USER_TOKEN) return { header: `Bearer ${partner}, User ${YCLIENTS_USER_TOKEN}` };

  if (
    runtimeUserToken &&
    Date.now() - runtimeUserToken.at <= USER_TOKEN_TTL_MS &&
    runtimeUserToken.token
  ) {
    return { header: `Bearer ${partner}, User ${runtimeUserToken.token}` };
  }

  if (!YCLIENTS_USER_LOGIN || !YCLIENTS_USER_PASSWORD) {
    return {
      header: null,
      authError:
        "Для этого метода нужен YCLIENTS_USER_TOKEN или пара YCLIENTS_USER_LOGIN/YCLIENTS_USER_PASSWORD в .env.local.",
    };
  }

  const auth = await fetchUserTokenByCredentials(YCLIENTS_USER_LOGIN, YCLIENTS_USER_PASSWORD);
  if (!auth.token) return { header: null, authError: auth.error ?? "Не удалось получить user token" };

  runtimeUserToken = { token: auth.token, at: Date.now() };
  return { header: `Bearer ${partner}, User ${auth.token}` };
}

type CompanyItem = { id?: number; title?: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
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

function normalizeCreateRecordPayload(rawPayload: unknown) {
  if (!isRecord(rawPayload)) return {};
  if (rawPayload.staff_id !== undefined || rawPayload.client !== undefined || rawPayload.datetime !== undefined) {
    return rawPayload;
  }

  const appointments = Array.isArray(rawPayload.appointments) ? rawPayload.appointments : [];
  const appointment = appointments.find(isRecord);
  if (!appointment) return rawPayload;

  const serviceIds = Array.isArray(appointment.services)
    ? appointment.services.map(numberValue).filter((item): item is number => item !== undefined)
    : [];

  return {
    staff_id: numberValue(appointment.staff_id),
    services: serviceIds.map((id) => ({ id })),
    client: {
      name: stringValue(rawPayload.fullname) ?? stringValue(rawPayload.name) ?? "",
      phone: stringValue(rawPayload.phone) ?? "",
      email: stringValue(rawPayload.email),
    },
    datetime: stringValue(appointment.datetime),
    seance_length: numberValue(appointment.seance_length),
    comment: stringValue(rawPayload.comment),
    save_if_busy: Boolean(rawPayload.save_if_busy),
    send_sms: Boolean(rawPayload.send_sms),
    sms_remain_hours: numberValue(rawPayload.sms_remain_hours),
    email_remain_hours: numberValue(rawPayload.email_remain_hours),
    attendance: numberValue(rawPayload.attendance),
    api_id: stringValue(rawPayload.api_id) ?? stringValue(rawPayload.apiId),
  };
}

function responseRecordId(data: unknown) {
  if (!isRecord(data)) return null;
  const nested = isRecord(data.data) ? data.data : data;
  const id =
    idStringValue(nested.id) ??
    idStringValue(nested.record_id) ??
    idStringValue(nested.recordId);
  return id ?? null;
}

function appointmentContextFromPayload(payload: unknown, fallbackId?: string | null) {
  const record = isRecord(payload) ? payload : {};
  const client = isRecord(record.client) ? record.client : {};
  const services = Array.isArray(record.services) ? record.services : [];
  const serviceList = services
    .map((service) => (isRecord(service) ? stringValue(service.title) ?? stringValue(service.name) ?? stringValue(service.id) : stringValue(service)))
    .filter(Boolean)
    .join(", ");
  const datetime = stringValue(record.datetime) ?? stringValue(record.date);
  const comment = stringValue(record.comment) ?? "";
  const vehicleMatch = comment.match(/(?:VIN|vin|ВИН|госномер|авто)[:\s]+([A-Za-zА-Яа-я0-9 ._-]{3,40})/);
  return {
    appointmentId: fallbackId ?? idStringValue(record.id) ?? idStringValue(record.record_id) ?? null,
    appointmentAt: datetime ?? null,
    clientName: stringValue(client.name) ?? stringValue(record.name) ?? stringValue(record.fullname) ?? null,
    clientPhone: stringValue(client.phone) ?? stringValue(record.phone) ?? null,
    clientEmail: stringValue(client.email) ?? stringValue(record.email) ?? null,
    serviceList: serviceList || null,
    car: vehicleMatch?.[1]?.trim() || null,
    status:
      record.attendance === 1
        ? "arrived"
        : stringValue(record.status) ?? stringValue(record.state) ?? null,
    payload: { yclientsPayload: record },
  };
}

async function fetchAccessibleCompanies(
  authHeader: string
): Promise<{ companies: CompanyItem[]; error?: string }> {
  try {
    const res = await fetch(`${YCLIENTS_API_BASE}/companies`, {
      headers: {
        Authorization: authHeader,
        Accept: "application/vnd.yclients.v2+json",
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message =
        (data as { error?: string })?.error ??
        (data as { meta?: { message?: string } })?.meta?.message ??
        "Не удалось получить список компаний";
      return { companies: [], error: message };
    }
    const companies = Array.isArray((data as { data?: unknown }).data)
      ? ((data as { data: CompanyItem[] }).data ?? [])
      : [];
    return { companies };
  } catch (error) {
    return {
      companies: [],
      error: error instanceof Error ? error.message : "Ошибка загрузки компаний",
    };
  }
}

async function resolveCompanyId(
  requestedCompanyId: string | null | undefined,
  authHeader: string
): Promise<{ companyId: string | null; companies: CompanyItem[]; error?: string }> {
  const companiesResult = await fetchAccessibleCompanies(authHeader);
  const companies = companiesResult.companies;
  const requested = requestedCompanyId?.trim();
  if (companies.length === 0) {
    return { companyId: requested ?? null, companies, error: companiesResult.error };
  }
  if (requested) {
    const found = companies.find((item) => String(item.id) === requested);
    if (found) return { companyId: requested, companies };
  }
  return { companyId: String(companies[0]?.id ?? ""), companies };
}

async function yclientsRequest(path: string, init?: RequestInit) {
  const resolved = await resolveAuthHeader(path);
  if (!resolved.header) {
    return NextResponse.json(
      { success: false, error: resolved.authError ?? "YCLIENTS токен не задан" },
      { status: 401 }
    );
  }
  const headers = {
    Authorization: resolved.header,
    Accept: "application/vnd.yclients.v2+json",
    "Content-Type": "application/json",
  };

  try {
    const res = await fetch(`${YCLIENTS_API_BASE}${path}`, {
      ...init,
      headers: {
        ...headers,
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && /\/records\/|\/record\/|\/clients\/|\/company\/|\/timetable\//.test(path)) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Не авторизовано в YCLIENTS. Добавьте YCLIENTS_USER_TOKEN или YCLIENTS_USER_LOGIN/YCLIENTS_USER_PASSWORD в .env.local.",
        },
        { status: 401 }
      );
    }
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Ошибка запроса к YCLIENTS",
      },
      { status: 500 }
    );
  }
}

function getRequired(search: URLSearchParams, key: string) {
  const value = search.get(key)?.trim();
  if (!value) throw new Error(`Параметр "${key}" обязателен`);
  return value;
}

export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams;
  const action = search.get("action");

  try {
    if (action === "config") {
      return NextResponse.json({
        success: true,
        data: {
          company_id: YCLIENTS_COMPANY_ID,
          company_title: YCLIENTS_COMPANY_TITLE,
        },
      });
    }

    if (action === "companies") {
      const resolved = await resolveAuthHeader("/company/");
      if (!resolved.header) {
        return NextResponse.json(
          { success: false, error: resolved.authError ?? "YCLIENTS токен не задан" },
          { status: 401 }
        );
      }
      const companyResolved = await resolveCompanyId(
        search.get("company_id")?.trim() || YCLIENTS_COMPANY_ID,
        resolved.header
      );
      return NextResponse.json({
        success: true,
        data: companyResolved.companies,
        default_company_id: companyResolved.companyId,
      });
    }

    const companyId = search.get("company_id")?.trim() || YCLIENTS_COMPANY_ID;
    if (!companyId) {
      return NextResponse.json(
        { success: false, error: "Не удалось определить company_id" },
        { status: 400 }
      );
    }

    switch (action) {
      case "services": {
        return yclientsRequest(`/book_services/${companyId}`);
      }
      case "staff": {
        const serviceIds = search.get("service_ids");
        const params = new URLSearchParams();
        if (serviceIds) params.set("service_ids[]", serviceIds);
        const qs = params.toString();
        return yclientsRequest(`/book_staff/${companyId}${qs ? `?${qs}` : ""}`);
      }
      case "dates": {
        const staffId = search.get("staff_id");
        const serviceIds = search.get("service_ids");
        const params = new URLSearchParams();
        if (staffId) params.set("staff_id", staffId);
        if (serviceIds) params.set("service_ids[]", serviceIds);
        const date = search.get("date");
        if (date) params.set("date", date);
        const qs = params.toString();
        return yclientsRequest(`/book_dates/${companyId}${qs ? `?${qs}` : ""}`);
      }
      case "times": {
        const staffId = getRequired(search, "staff_id");
        const date = getRequired(search, "date");
        const serviceIds = search.get("service_ids");
        const params = new URLSearchParams();
        if (serviceIds) params.set("service_ids[]", serviceIds);
        const qs = params.toString();
        return yclientsRequest(`/book_times/${companyId}/${staffId}/${date}${qs ? `?${qs}` : ""}`);
      }
      case "seances": {
        const staffId = getRequired(search, "staff_id");
        const date = getRequired(search, "date");
        const serviceIds = search.get("service_ids");
        const params = new URLSearchParams();
        if (serviceIds) params.set("service_ids[]", serviceIds);
        const qs = params.toString();
        return yclientsRequest(`/timetable/seances/${companyId}/${staffId}/${date}${qs ? `?${qs}` : ""}`);
      }
      case "clients": {
        return NextResponse.json(
          {
            success: false,
            error:
              "Список клиентов через booking API недоступен. Используйте ввод клиента вручную (телефон/имя).",
          },
          { status: 400 }
        );
      }
      case "records": {
        const page = search.get("page") ?? "1";
        const count = search.get("count") ?? "100";
        const startDate = search.get("start_date");
        const endDate = search.get("end_date");
        const staffId = search.get("staff_id");
        const params = new URLSearchParams({ page, count });
        if (startDate) params.set("start_date", startDate);
        if (endDate) params.set("end_date", endDate);
        if (staffId) params.set("staff_id", staffId);
        return yclientsRequest(`/records/${companyId}?${params.toString()}`);
      }
      case "record": {
        const recordId = getRequired(search, "record_id");
        return yclientsRequest(`/record/${companyId}/${recordId}`);
      }
      default:
        return NextResponse.json(
          { success: false, error: "Неизвестный action" },
          { status: 400 }
        );
    }
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Некорректные параметры" },
      { status: 400 }
    );
  }
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    action?: string;
    company_id?: number | string;
    payload?: unknown;
    login?: string;
    password?: string;
  };
  const action = body.action;

  if (action === "auth") {
    const login = body.login?.trim();
    const password = body.password?.trim();
    if (!login || !password) {
      return NextResponse.json(
        { success: false, error: "Нужны login и password для action=auth" },
        { status: 400 }
      );
    }
    const auth = await fetchUserTokenByCredentials(login, password);
    if (!auth.token) {
      return NextResponse.json(
        { success: false, error: auth.error ?? "Не удалось получить user token" },
        { status: 401 }
      );
    }
    runtimeUserToken = { token: auth.token, at: Date.now() };
    return NextResponse.json({ success: true, data: { user_token: auth.token } });
  }

  const companyId = String(body.company_id ?? YCLIENTS_COMPANY_ID).trim();
  if (!companyId) {
    return NextResponse.json(
      { success: false, error: "Не удалось определить company_id" },
      { status: 400 }
    );
  }

  if (action === "create-client") {
    return NextResponse.json(
      {
        success: false,
        error:
          "Создание клиента отдельным методом недоступно в booking API. Клиент создается автоматически при создании записи.",
      },
      { status: 400 }
    );
  }

  if (action === "create-record") {
    const normalizedPayload = normalizeCreateRecordPayload(body.payload);
    const response = await yclientsRequest(`/record/${companyId}`, {
      method: "POST",
      body: JSON.stringify(normalizedPayload),
    });
    if (response.ok) {
      const data = await response.clone().json().catch(() => null);
      await handleAppointmentCreated({
        source: "admin",
        ...appointmentContextFromPayload(normalizedPayload, responseRecordId(data)),
        initiatedById: "yclients",
      }).catch((error) => {
        console.warn("[client-notifications/yclients-create]", error);
      });
    }
    return response;
  }

  return NextResponse.json({ success: false, error: "Неизвестный action" }, { status: 400 });
}

export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const action = String(body.action ?? "");
  if (action !== "update-record") {
    return NextResponse.json({ success: false, error: "Неизвестный action" }, { status: 400 });
  }

  const companyId = String(body.company_id ?? YCLIENTS_COMPANY_ID).trim();
  const recordId = String(body.record_id ?? "").trim();
  if (!companyId || !recordId) {
    return NextResponse.json(
      { success: false, error: "Для редактирования нужны company_id и record_id" },
      { status: 400 }
    );
  }

  const response = await yclientsRequest(`/record/${companyId}/${recordId}`, {
    method: "PUT",
    body: JSON.stringify(body.payload ?? {}),
  });
  if (response.ok) {
    await handleAppointmentUpdated({
      ...appointmentContextFromPayload(body.payload, recordId),
      initiatedById: "yclients",
    }).catch((error) => {
      console.warn("[client-notifications/yclients-update]", error);
    });
  }
  return response;
}

export async function DELETE(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const action = String(body.action ?? "");
  if (action !== "delete-record") {
    return NextResponse.json({ success: false, error: "Неизвестный action" }, { status: 400 });
  }

  const companyId = String(body.company_id ?? YCLIENTS_COMPANY_ID).trim();
  const recordId = String(body.record_id ?? "").trim();
  if (!companyId || !recordId) {
    return NextResponse.json(
      { success: false, error: "Для удаления нужны company_id и record_id" },
      { status: 400 }
    );
  }

  const response = await yclientsRequest(`/record/${companyId}/${recordId}`, {
    method: "DELETE",
  });
  if (response.ok) {
    await handleAppointmentCancelled(recordId).catch((error) => {
      console.warn("[client-notifications/yclients-delete]", error);
    });
  }
  return response;
}
