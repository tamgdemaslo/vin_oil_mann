import { NextRequest, NextResponse } from "next/server";
import {
  handleAppointmentCancelled,
  handleAppointmentCreated,
  handleAppointmentUpdated,
} from "@/lib/client-notifications/client-notifications";
import { getSession } from "@/lib/auth";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { getYclientsBranchConfig, type YclientsBranchConfig } from "@/lib/yclients/branch-config";
import { assertExternalSideEffectAllowed } from "@/lib/external-side-effects";

const USER_TOKEN_TTL_MS = 50 * 60 * 1000;

const runtimeUserTokens = new Map<string, { token: string; at: number }>();

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

async function resolveAuthHeader(
  config: YclientsBranchConfig,
  path: string
): Promise<{ header: string | null; authError?: string }> {
  const needsUserToken = /\/records\/|\/record\/|\/clients\/|\/company\/|\/timetable\//.test(path);
  if (!needsUserToken) return { header: `Bearer ${config.partnerToken}` };
  if (config.userToken) return { header: `Bearer ${config.partnerToken}, User ${config.userToken}` };

  const cached = runtimeUserTokens.get(config.branchId);
  if (
    cached &&
    Date.now() - cached.at <= USER_TOKEN_TTL_MS &&
    cached.token
  ) {
    return { header: `Bearer ${config.partnerToken}, User ${cached.token}` };
  }

  if (!config.userLogin || !config.userPassword) {
    return {
      header: null,
      authError:
        "Для филиала настройте userToken или пару userLogin/userPassword интеграции YCLIENTS.",
    };
  }

  const auth = await fetchUserTokenByCredentials(config, config.userLogin, config.userPassword);
  if (!auth.token) return { header: null, authError: auth.error ?? "Не удалось получить user token" };

  runtimeUserTokens.set(config.branchId, { token: auth.token, at: Date.now() });
  return { header: `Bearer ${config.partnerToken}, User ${auth.token}` };
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

function appointmentStatusFromComment(value: string) {
  const statusLine = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^Статус записи:/i.test(line));
  const normalized = (statusLine || value).toLowerCase();
  if (/не приехал|no[-_\s]?show/.test(normalized)) return "no_show";
  if (/уехал|выдан|left/.test(normalized)) return "left";
  if (/готов|done|заверш/.test(normalized)) return "done";
  if (/работ|in_work/.test(normalized)) return "in_work";
  if (/приехал|arrived/.test(normalized)) return "arrived";
  return null;
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
  const statusFromComment = appointmentStatusFromComment(comment);
  return {
    appointmentId: fallbackId ?? idStringValue(record.id) ?? idStringValue(record.record_id) ?? null,
    appointmentAt: datetime ?? null,
    clientName: stringValue(client.name) ?? stringValue(record.name) ?? stringValue(record.fullname) ?? null,
    clientPhone: stringValue(client.phone) ?? stringValue(record.phone) ?? null,
    clientEmail: stringValue(client.email) ?? stringValue(record.email) ?? null,
    serviceList: serviceList || null,
    car: vehicleMatch?.[1]?.trim() || null,
    status:
      statusFromComment ??
      (record.attendance === 1
        ? "arrived"
        : record.attendance === -1
          ? "no_show"
          : stringValue(record.status) ?? stringValue(record.state) ?? null),
    payload: { yclientsPayload: record },
  };
}

async function fetchAccessibleCompanies(
  config: YclientsBranchConfig,
  authHeader: string
): Promise<{ companies: CompanyItem[]; error?: string }> {
  try {
    const res = await fetch(`${config.apiBase}/companies`, {
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
  config: YclientsBranchConfig,
  requestedCompanyId: string | null | undefined,
  authHeader: string
): Promise<{ companyId: string | null; companies: CompanyItem[]; error?: string }> {
  const requested = requestedCompanyId?.trim();
  if (requested && requested !== config.companyId) {
    return { companyId: null, companies: [], error: "company_id не относится к активному филиалу" };
  }
  const companiesResult = await fetchAccessibleCompanies(config, authHeader);
  const companies = companiesResult.companies.filter((item) => String(item.id) === config.companyId);
  if (companies.length === 0) {
    return { companyId: config.companyId, companies, error: companiesResult.error };
  }
  return { companyId: config.companyId, companies };
}

async function yclientsRequest(config: YclientsBranchConfig, path: string, init?: RequestInit) {
  if ((init?.method ?? "GET").toUpperCase() !== "GET") assertExternalSideEffectAllowed("yclients_mutation");
  const resolved = await resolveAuthHeader(config, path);
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
    const res = await fetch(`${config.apiBase}${path}`, {
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
            "Не авторизовано в YCLIENTS. Настройте userToken или userLogin/userPassword для активного филиала.",
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

function configuredCompanyId(requested: string | number | null | undefined, config: YclientsBranchConfig) {
  const value = String(requested ?? config.companyId).trim();
  if (!value) throw new Error("Не удалось определить company_id");
  if (value !== config.companyId) throw new Error("company_id не относится к активному филиалу");
  return value;
}

async function withYclientsRequestContext(
  operation: (config: YclientsBranchConfig) => Promise<NextResponse> | NextResponse
): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  }
  const branchAccess = await requireBranchApi();
  if (!branchAccess.ok) return branchAccess.response;

  return runWithBranchApiContext(branchAccess.context, async () => {
    let config: YclientsBranchConfig;
    try {
      config = await getYclientsBranchConfig();
    } catch (error) {
      return NextResponse.json(
        { success: false, error: error instanceof Error ? error.message : "YCLIENTS не настроен для активного филиала" },
        { status: 424 }
      );
    }
    return operation(config);
  });
}

export async function GET(request: NextRequest) {
  return withYclientsRequestContext(async (config) => {
    const search = request.nextUrl.searchParams;
    const action = search.get("action");

    try {
      if (action === "config") {
        return NextResponse.json({
          success: true,
          data: {
            company_id: config.companyId,
            company_title: config.companyTitle ?? "YCLIENTS",
          },
        });
      }

    if (action === "companies") {
      const resolved = await resolveAuthHeader(config, "/company/");
      if (!resolved.header) {
        return NextResponse.json(
          { success: false, error: resolved.authError ?? "YCLIENTS токен не задан" },
          { status: 401 }
        );
      }
      const companyResolved = await resolveCompanyId(
        config,
        search.get("company_id")?.trim() || config.companyId,
        resolved.header
      );
      if (!companyResolved.companyId) {
        return NextResponse.json({ success: false, error: companyResolved.error }, { status: 403 });
      }
      return NextResponse.json({
        success: true,
        data: companyResolved.companies,
        default_company_id: companyResolved.companyId,
      });
    }

    const companyId = configuredCompanyId(search.get("company_id"), config);

    switch (action) {
      case "services": {
        return yclientsRequest(config, `/book_services/${companyId}`);
      }
      case "staff": {
        const serviceIds = search.get("service_ids");
        const params = new URLSearchParams();
        if (serviceIds) params.set("service_ids[]", serviceIds);
        const qs = params.toString();
        return yclientsRequest(config, `/book_staff/${companyId}${qs ? `?${qs}` : ""}`);
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
        return yclientsRequest(config, `/book_dates/${companyId}${qs ? `?${qs}` : ""}`);
      }
      case "times": {
        const staffId = getRequired(search, "staff_id");
        const date = getRequired(search, "date");
        const serviceIds = search.get("service_ids");
        const params = new URLSearchParams();
        if (serviceIds) params.set("service_ids[]", serviceIds);
        const qs = params.toString();
        return yclientsRequest(config, `/book_times/${companyId}/${staffId}/${date}${qs ? `?${qs}` : ""}`);
      }
      case "seances": {
        const staffId = getRequired(search, "staff_id");
        const date = getRequired(search, "date");
        const serviceIds = search.get("service_ids");
        const params = new URLSearchParams();
        if (serviceIds) params.set("service_ids[]", serviceIds);
        const qs = params.toString();
        return yclientsRequest(config, `/timetable/seances/${companyId}/${staffId}/${date}${qs ? `?${qs}` : ""}`);
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
        return yclientsRequest(config, `/records/${companyId}?${params.toString()}`);
      }
      case "record": {
        const recordId = getRequired(search, "record_id");
        return yclientsRequest(config, `/record/${companyId}/${recordId}`);
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
  });
}

export async function POST(request: NextRequest) {
  return withYclientsRequestContext(async (config) => {
    const body = (await request.json().catch(() => ({}))) as {
      action?: string;
      company_id?: number | string;
      payload?: unknown;
      login?: string;
      password?: string;
    };
    const action = body.action;

  if (action === "auth") {
    return NextResponse.json(
      { success: false, error: "Интерактивная выдача user token отключена; настройте credential активного филиала" },
      { status: 410 }
    );
  }

  let companyId: string;
  try {
    companyId = configuredCompanyId(body.company_id, config);
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Недопустимый company_id" }, { status: 403 });
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
    const response = await yclientsRequest(config, `/record/${companyId}`, {
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
  });
}

export async function PUT(request: NextRequest) {
  return withYclientsRequestContext(async (config) => {
    const body = await request.json().catch(() => ({}));
    const action = String(body.action ?? "");
    if (action !== "update-record") {
      return NextResponse.json({ success: false, error: "Неизвестный action" }, { status: 400 });
    }

  let companyId: string;
  try {
    companyId = configuredCompanyId(body.company_id, config);
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Недопустимый company_id" }, { status: 403 });
  }
  const recordId = String(body.record_id ?? "").trim();
  if (!companyId || !recordId) {
    return NextResponse.json(
      { success: false, error: "Для редактирования нужны company_id и record_id" },
      { status: 400 }
    );
  }

  const response = await yclientsRequest(config, `/record/${companyId}/${recordId}`, {
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
  });
}

export async function DELETE(request: NextRequest) {
  return withYclientsRequestContext(async (config) => {
    const body = await request.json().catch(() => ({}));
    const action = String(body.action ?? "");
    if (action !== "delete-record") {
      return NextResponse.json({ success: false, error: "Неизвестный action" }, { status: 400 });
    }

  let companyId: string;
  try {
    companyId = configuredCompanyId(body.company_id, config);
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Недопустимый company_id" }, { status: 403 });
  }
  const recordId = String(body.record_id ?? "").trim();
  if (!companyId || !recordId) {
    return NextResponse.json(
      { success: false, error: "Для удаления нужны company_id и record_id" },
      { status: 400 }
    );
  }

  const response = await yclientsRequest(config, `/record/${companyId}/${recordId}`, {
    method: "DELETE",
  });
  if (response.ok) {
    await handleAppointmentCancelled(recordId).catch((error) => {
      console.warn("[client-notifications/yclients-delete]", error);
    });
  }
    return response;
  });
}
