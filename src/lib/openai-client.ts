import OpenAI from "openai";
import { fetch as undiciFetch, ProxyAgent } from "undici";

let proxyAgent: ProxyAgent | null | undefined;

type OpenAIConnectionCheck =
  | { ok: true; proxyConfigured: boolean; status: number; timeoutMs: number }
  | { ok: false; proxyConfigured: boolean; status?: number; timeoutMs: number; error: string };

export class OpenAIConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenAIConnectionError";
  }
}

function openAIProxyAgent(): ProxyAgent | undefined {
  const proxyUrl = process.env.OPENAI_PROXY_URL?.trim();
  if (!proxyUrl) return undefined;
  proxyAgent ??= new ProxyAgent(proxyUrl);
  return proxyAgent;
}

/**
 * All application OpenAI clients go through this factory. In production,
 * OPENAI_PROXY_URL points at the WireGuard-only HTTP CONNECT proxy; without it
 * the SDK keeps its normal direct behaviour for local development.
 */
export function createOpenAIClient(apiKey: string, options?: { timeout?: number; maxRetries?: number }): OpenAI {
  const dispatcher = openAIProxyAgent();
  return new OpenAI({
    apiKey,
    ...options,
    ...(dispatcher ? { fetchOptions: { dispatcher } } : {}),
  });
}

export async function checkOpenAIConnection(): Promise<OpenAIConnectionCheck> {
  const timeoutMs = 8_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const proxyConfigured = Boolean(process.env.OPENAI_PROXY_URL?.trim());
  try {
    const response = await undiciFetch("https://api.openai.com/v1/models", {
      signal: controller.signal,
      ...(openAIProxyAgent() ? { dispatcher: openAIProxyAgent() } : {}),
    });
    if (response.status === 401) return { ok: true, proxyConfigured, status: response.status, timeoutMs };
    return {
      ok: false,
      proxyConfigured,
      status: response.status,
      timeoutMs,
      error: response.status === 403
        ? "OpenAI отклонил VPN-выход (HTTP 403): проверьте страну выхода WireGuard"
        : `OpenAI ответил HTTP ${response.status}; ожидается HTTP 401 без ключа`,
    };
  } catch {
    const timedOut = controller.signal.aborted;
    return {
      ok: false,
      proxyConfigured,
      timeoutMs,
      error: timedOut
        ? "Защищённый прокси не установил HTTPS-соединение за 8 секунд"
        : "Не удалось установить HTTPS-соединение с OpenAI через текущий маршрут",
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Stop an assistant run before expensive research/model calls when the
 * configured OpenAI route is unavailable. This keeps a dead WireGuard route
 * from consuming the 75 s research timeout and then the model timeout.
 */
export async function assertOpenAIConnection() {
  const check = await checkOpenAIConnection();
  if (!check.ok) throw new OpenAIConnectionError(check.error);
  return check;
}
