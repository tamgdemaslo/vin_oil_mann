import {
  isMoySkladEnabled,
  isMoySkladRequestAllowed,
  moyskladDisabledMessage,
} from "@/lib/moysklad-flags";
import { getBranchIntegrationValues } from "@/lib/branch-integration-credentials";
import { assertExternalSideEffectAllowed } from "@/lib/external-side-effects";

export const MOYSKLAD_BASE = "https://api.moysklad.ru/api/remap/1.2";
const MOYSKLAD_TIMEOUT_MS = Math.max(5_000, parseInt(process.env.MOYSKLAD_TIMEOUT_MS ?? "15000", 10) || 15_000);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let nextRetryRequestAt = 0;

/** Ошибки, после которых имеет смысл повторить запрос (сеть, 5xx, лимит запросов МойСклад). */
export function isTransientMoySkladError(error: string): boolean {
  const lower = error.toLowerCase();
  return (
    lower.includes("таймаут") ||
    lower.includes("ограничение") ||
    lower.includes("превышено") ||
    lower.includes("rate limit") ||
    lower.includes("too many") ||
    lower.includes("429") ||
    lower.includes("fetch failed") ||
    lower.includes("abort") ||
    lower.includes("econnreset") ||
    lower.includes("socket") ||
    lower.includes("network") ||
    lower.includes("502") ||
    lower.includes("503") ||
    lower.includes("504")
  );
}

function backoffMsForMoySkladRetry(attempt: number, error: string): number {
  const lower = error.toLowerCase();
  const rateLimited =
    lower.includes("ограничение") ||
    lower.includes("превышено") ||
    lower.includes("429") ||
    lower.includes("rate limit") ||
    lower.includes("too many");
  const base = rateLimited ? 2_200 : 650;
  const jitter = Math.floor(Math.random() * 250);
  return Math.min(28_000, base * 2 ** attempt + jitter);
}

async function waitForRetryRequestSlot(minIntervalMs: number) {
  const interval = Math.max(0, minIntervalMs);
  if (interval <= 0) return;

  const now = Date.now();
  const waitMs = Math.max(0, nextRetryRequestAt - now);
  nextRetryRequestAt = Math.max(now, nextRetryRequestAt) + interval;
  if (waitMs > 0) {
    await sleep(waitMs);
  }
}

/**
 * Обёртка над {@link moyskladFetch} с повторными попытками при временных сбоях и при лимите запросов API.
 */
export async function moyskladFetchWithRetry<T>(
  path: string,
  options: RequestInit | undefined,
  attempts: number,
  config?: { minIntervalMs?: number }
): Promise<{ data: T; ok: true } | { error: string; ok: false }> {
  let lastError = "Ошибка запроса к МойСклад";
  const n = Math.max(1, Math.min(attempts, 12));
  for (let attempt = 0; attempt < n; attempt += 1) {
    await waitForRetryRequestSlot(config?.minIntervalMs ?? 0);
    const res = await moyskladFetch<T>(path, options);
    if (res.ok) return res;
    lastError = res.error;
    if (attempt >= n - 1 || !isTransientMoySkladError(res.error)) {
      return { ok: false, error: res.error };
    }
    await sleep(backoffMsForMoySkladRetry(attempt, res.error));
  }
  return { ok: false, error: lastError };
}

/**
 * Если в .env одновременно лежат Bearer и логин/пароль, по умолчанию используем Basic:
 * токен часто протухает, из‑за чего падает весь подбор (пустой список товаров).
 * Для работы только по токену: задайте MOYSKLAD_PREFER_BEARER=1.
 */
export async function getMoySkladAuthHeader(): Promise<string | null> {
  if (!isMoySkladEnabled()) return null;
  const credentials = await getBranchIntegrationValues("moysklad", ["token", "login", "password", "preferBearer"], []);
  const login = credentials.login?.trim();
  const password = credentials.password?.trim();
  const token = credentials.token?.trim();
  const preferBearer = credentials.preferBearer === "1" || credentials.preferBearer === "true";

  if (login && password && !preferBearer) {
    return "Basic " + Buffer.from(`${login}:${password}`, "utf-8").toString("base64");
  }
  if (token) return `Bearer ${token}`;
  if (login && password) {
    return "Basic " + Buffer.from(`${login}:${password}`, "utf-8").toString("base64");
  }
  return null;
}

export async function getMoySkladHeaders(): Promise<Record<string, string> | null> {
  const auth = await getMoySkladAuthHeader();
  if (!auth) return null;
  return {
    Authorization: auth,
    "Accept-Encoding": "gzip",
    Accept: "application/json;charset=utf-8",
    "Content-Type": "application/json",
  };
}

export type MoySkladMeta = {
  href: string;
  type: string;
  mediaType: string;
};

export async function moyskladFetch<T>(
  path: string,
  options?: RequestInit
): Promise<{ data: T; ok: true } | { error: string; ok: false }> {
  const method = options?.method ?? "GET";
  if (method.toUpperCase() !== "GET" && method.toUpperCase() !== "HEAD") {
    assertExternalSideEffectAllowed("moysklad_mutation");
  }
  if (!isMoySkladRequestAllowed(method)) {
    return {
      ok: false,
      error: moyskladDisabledMessage(method.toUpperCase() === "GET" || method.toUpperCase() === "HEAD" ? "read" : "write"),
    };
  }
  const headers = await getMoySkladHeaders();
  if (!headers) {
    return { ok: false, error: "МойСклад: не заданы MOYSKLAD_TOKEN или пара MOYSKLAD_LOGIN/MOYSKLAD_PASSWORD" };
  }
  const url = path.startsWith("http") ? path : `${MOYSKLAD_BASE}${path}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), MOYSKLAD_TIMEOUT_MS);
  try {
    const signal =
      options?.signal != null
        ? AbortSignal.any([options.signal, controller.signal])
        : controller.signal;
    const res = await fetch(url, {
      ...options,
      signal,
      headers: { ...headers, ...options?.headers },
    });
    clearTimeout(timeoutId);
    const data = (await res.json()) as T;
    if (!res.ok) {
      const errMsg = (data as { errors?: { error?: string }[] })?.errors?.[0]?.error ?? res.statusText;
      return { ok: false, error: `${res.status} ${errMsg}`.trim() };
    }
    return { ok: true, data };
  } catch (e) {
    clearTimeout(timeoutId);
    if (e instanceof Error && e.name === "AbortError") {
      return { ok: false, error: `Таймаут запроса к МойСклад (${Math.round(MOYSKLAD_TIMEOUT_MS / 1000)} сек)` };
    }
    return { ok: false, error: e instanceof Error ? e.message : "Ошибка запроса к МойСклад" };
  }
}
