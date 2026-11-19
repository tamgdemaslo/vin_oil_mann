export const SAVE_OPERATION_HEADER = "x-eco-operation-id";
export const SAVE_BRANCH_HEADER = "x-eco-save-branch";
export const SAVE_REQUEST_HEADER = "x-eco-request-id";
export const SAVED_REFRESH_FAILED = "Сохранено. Не удалось обновить список.";
export const UNKNOWN_SAVE_RESULT = "Результат сохранения неизвестен. Повторите сохранение той же формы для проверки результата.";

export function saveTraceId(value: string | null) {
  return value && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value) ? value.toLowerCase() : null;
}

function traceRoute(path: string) {
  const pathname = path.split("?")[0];
  if (pathname === "/api/booking-journal" || pathname === "/api/catalog/search" || pathname === "/api/crm/deals") return pathname;
  if (pathname === "/api/local-inventory/products") return pathname;
  if (/^\/api\/local-inventory\/products\/[^/]+$/.test(pathname)) return "/api/local-inventory/products/[id]";
  if (/^\/api\/client-cases\/[^/]+\/action$/.test(pathname)) return "/api/client-cases/[id]/action";
  if (/^\/api\/crm\/deals\/[^/]+\/order$/.test(pathname)) return "/api/crm/deals/[id]/order";
  return null;
}

export function saveTrace(headers: Headers, path: string, method: string, layer: "proxy" | "app" | "browser") {
  const operationId = saveTraceId(headers.get(SAVE_OPERATION_HEADER));
  const requestId = saveTraceId(headers.get(SAVE_REQUEST_HEADER));
  const route = traceRoute(path);
  const start = performance.now();
  return (phase: string, status?: number, code?: string) => {
    if (!operationId || !requestId || !route || !["POST", "PUT", "GET"].includes(method)) return;
    const safeCode = code && /^(?:P[0-9]{4}|TypeError|AbortError|TimeoutError|SyntaxError|booking_[a-z_]+(?:p[0-9]{4})?)$/.test(code) ? code : undefined;
    console.info("[save-trace]", JSON.stringify({
      time: new Date().toISOString(), operationId, requestId, route, method, layer, phase,
      durationMs: Math.round(performance.now() - start), status, code: safeCode,
    }));
  };
}

export function saveErrorCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") return error.code;
  return error instanceof Error ? error.name : undefined;
}

export async function tracedSaveFetch(path: string, options: RequestInit, operationId?: string) {
  if (!operationId) return fetch(path, options);
  const headers = new Headers(options.headers);
  headers.set(SAVE_OPERATION_HEADER, operationId);
  headers.set(SAVE_REQUEST_HEADER, crypto.randomUUID());
  const log = saveTrace(headers, path, options.method ?? "GET", "browser");
  log("send");
  try {
    const response = await fetch(path, { ...options, headers });
    log("headers", response.status);
    const readJson = response.json.bind(response);
    response.json = async () => {
      try {
        const result = await readJson();
        log("body_read", response.status);
        return result;
      } catch (error) {
        log("body_failed", response.status, saveErrorCode(error));
        throw error;
      }
    };
    return response;
  } catch (error) {
    log("fetch_failed", undefined, saveErrorCode(error));
    throw error;
  }
}

export type PendingSave = { operationId: string; body: string };

export function prepareSave(pending: { current: PendingSave | null }, body: string) {
  if (pending.current && pending.current.body !== body) {
    throw new Error("Сначала проверьте результат предыдущего сохранения с исходными значениями.");
  }
  return pending.current ??= { operationId: crypto.randomUUID(), body };
}

export function saveWasRejected(response: Response) {
  return response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status);
}
