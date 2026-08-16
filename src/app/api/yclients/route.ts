import { NextRequest, NextResponse } from "next/server";
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
  void request;
  return NextResponse.json(
    { success: false, error: "Запись через Yclients отключена. Используйте /api/booking-journal или /api/bookings." },
    { status: 410 },
  );
}

export async function PUT(request: NextRequest) {
  void request;
  return NextResponse.json(
    { success: false, error: "Изменение записи через Yclients отключено. Используйте собственный журнал записи." },
    { status: 410 },
  );
}

export async function DELETE(request: NextRequest) {
  void request;
  return NextResponse.json(
    { success: false, error: "Отмена записи через Yclients отключена. Используйте собственный журнал записи." },
    { status: 410 },
  );
}
