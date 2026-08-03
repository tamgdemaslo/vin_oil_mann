import { safeReadJson } from "@/lib/http-json";

type ApiErrorPayload = { error?: string };

export type DashboardClientBundle<TDashboard, TShift, TCash> = {
  dashboard: TDashboard;
  shift: TShift | null;
  cash: TCash | null;
  shiftAvailable: boolean;
  cashAvailable: boolean;
  partialErrors: string[];
  loadedAt: number;
};

type UnknownBundle = DashboardClientBundle<unknown, unknown, unknown>;

const CACHE_TTL_MS = 1_500;

let cachedBundle: UnknownBundle | null = null;
let inFlightBundle: Promise<UnknownBundle> | null = null;

async function readRequiredJson<T>(response: Response, label: string): Promise<T> {
  const payload = await safeReadJson<T & ApiErrorPayload>(response);
  if (!response.ok) {
    throw new Error(payload?.error || `${label}: сервер ответил с ошибкой ${response.status}.`);
  }
  if (payload === undefined) {
    throw new Error(`${label}: сервер вернул пустой или невалидный ответ.`);
  }
  return payload;
}

async function readOptionalJson<T>(
  response: Response,
  label: string
): Promise<{ value: T | null; available: boolean; error: string | null }> {
  const payload = await safeReadJson<T & ApiErrorPayload>(response);
  if (!response.ok) {
    return {
      value: null,
      available: false,
      error: payload?.error || `${label}: ошибка ${response.status}.`,
    };
  }
  if (payload === undefined) {
    return { value: null, available: false, error: `${label}: ответ не удалось прочитать.` };
  }
  return { value: payload, available: true, error: null };
}

export function invalidateDashboardClientBundle() {
  cachedBundle = null;
}

export async function loadDashboardClientBundle<TDashboard, TShift, TCash>(options?: {
  force?: boolean;
}): Promise<DashboardClientBundle<TDashboard, TShift, TCash>> {
  if (options?.force) cachedBundle = null;
  if (inFlightBundle) {
    return inFlightBundle as Promise<DashboardClientBundle<TDashboard, TShift, TCash>>;
  }
  if (cachedBundle && Date.now() - cachedBundle.loadedAt < CACHE_TTL_MS) {
    return cachedBundle as DashboardClientBundle<TDashboard, TShift, TCash>;
  }

  inFlightBundle = (async () => {
    const [shiftResponse, cashResponse, dashboardResponse] = await Promise.all([
      fetch("/api/shifts/current", { cache: "no-store" }),
      fetch("/api/cash", { cache: "no-store" }),
      fetch("/api/dashboard/operations", { cache: "no-store" }),
    ]);

    const dashboard = await readRequiredJson<unknown>(dashboardResponse, "Операционная сводка");
    const [shiftResult, cashResult] = await Promise.all([
      readOptionalJson<unknown>(shiftResponse, "Рабочая смена"),
      readOptionalJson<unknown>(cashResponse, "Кассовая смена"),
    ]);

    const bundle: UnknownBundle = {
      dashboard,
      shift: shiftResult.value,
      cash: cashResult.value,
      shiftAvailable: shiftResult.available,
      cashAvailable: cashResult.available,
      partialErrors: [shiftResult.error, cashResult.error].filter((value): value is string => Boolean(value)),
      loadedAt: Date.now(),
    };
    cachedBundle = bundle;
    return bundle;
  })().finally(() => {
    inFlightBundle = null;
  });

  return inFlightBundle as Promise<DashboardClientBundle<TDashboard, TShift, TCash>>;
}
