import { ProxyAgent } from "undici";

const PARTS_CATALOGS_BASE = "https://api.parts-catalogs.com/v1";
const PARTS_CATALOGS_TIMEOUT_MS = 20_000;

let proxyAgent: ProxyAgent | null | undefined;

type FetchWithDispatcherInit = RequestInit & {
  dispatcher?: ProxyAgent;
};

function getPartsCatalogsProxyUrl(): string | null {
  return (
    process.env.PARTS_CATALOGS_PROXY_URL?.trim() ||
    process.env.FIXIE_URL?.trim() ||
    process.env.QUOTAGUARD_URL?.trim() ||
    null
  );
}

function getProxyAgent(): ProxyAgent | undefined {
  const proxyUrl = getPartsCatalogsProxyUrl();
  if (!proxyUrl) return undefined;
  proxyAgent ??= new ProxyAgent(proxyUrl);
  return proxyAgent;
}

export async function partsCatalogsRequest(
  path: string,
  params: Record<string, string> = {}
): Promise<{ status: number; data: unknown }> {
  const key = process.env.PARTS_CATALOGS_API_KEY?.trim();
  if (!key) return { status: 401, data: { error: "PARTS_CATALOGS_API_KEY не задан" } };

  const base = (process.env.PARTS_CATALOGS_API_BASE || PARTS_CATALOGS_BASE).replace(/\/$/, "");
  const url = path.startsWith("http") ? path : `${base}${path}`;
  const search = new URLSearchParams(params).toString();
  const fullUrl = search ? `${url}${url.includes("?") ? "&" : "?"}${search}` : url;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PARTS_CATALOGS_TIMEOUT_MS);

  try {
    const requestInit: FetchWithDispatcherInit = {
      signal: controller.signal,
      dispatcher: getProxyAgent(),
      headers: { Accept: "application/json", Authorization: key },
    };
    const res = await fetch(fullUrl, requestInit as RequestInit);
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  } catch (e) {
    return { status: 500, data: { error: String(e) } };
  } finally {
    clearTimeout(timeoutId);
  }
}
