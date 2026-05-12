export const MOYSKLAD_BASE = "https://api.moysklad.ru/api/remap/1.2";
const MOYSKLAD_TIMEOUT_MS = Math.max(5_000, parseInt(process.env.MOYSKLAD_TIMEOUT_MS ?? "15000", 10) || 15_000);

/**
 * Если в .env одновременно лежат Bearer и логин/пароль, по умолчанию используем Basic:
 * токен часто протухает, из‑за чего падает весь подбор (пустой список товаров).
 * Для работы только по токену: задайте MOYSKLAD_PREFER_BEARER=1.
 */
export function getMoySkladAuthHeader(): string | null {
  const login = process.env.MOYSKLAD_LOGIN?.trim();
  const password = process.env.MOYSKLAD_PASSWORD?.trim();
  const token = process.env.MOYSKLAD_TOKEN?.trim();
  const preferBearer = process.env.MOYSKLAD_PREFER_BEARER === "1" || process.env.MOYSKLAD_PREFER_BEARER === "true";

  if (login && password && !preferBearer) {
    return "Basic " + Buffer.from(`${login}:${password}`, "utf-8").toString("base64");
  }
  if (token) return `Bearer ${token}`;
  if (login && password) {
    return "Basic " + Buffer.from(`${login}:${password}`, "utf-8").toString("base64");
  }
  return null;
}

export function getMoySkladHeaders(): Record<string, string> | null {
  const auth = getMoySkladAuthHeader();
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
  const headers = getMoySkladHeaders();
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
      return { ok: false, error: errMsg };
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
