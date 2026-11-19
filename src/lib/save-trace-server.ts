import type { NextRequest } from "next/server";
import { SAVE_OPERATION_HEADER, SAVE_REQUEST_HEADER, saveErrorCode, saveTrace, saveTraceId } from "./save-trace";

export async function withSaveTrace(
  request: NextRequest | undefined,
  handler: (log: ReturnType<typeof saveTrace>) => Promise<Response>,
) {
  if (!request || !saveTraceId(request.headers.get(SAVE_OPERATION_HEADER))) return handler(() => {});
  const log = saveTrace(request.headers, request.nextUrl.pathname, request.method, "app");
  log("handler_enter");
  try {
    const response = await handler(log);
    const id = saveTraceId(request.headers.get(SAVE_REQUEST_HEADER));
    if (id) response.headers.set(SAVE_REQUEST_HEADER, id);
    log("response", response.status);
    return response;
  } catch (error) {
    log("handler_failed", undefined, saveErrorCode(error));
    const id = saveTraceId(request.headers.get(SAVE_REQUEST_HEADER));
    return Response.json({ error: "Не удалось подтвердить сохранение" }, {
      status: 500, headers: id ? { [SAVE_REQUEST_HEADER]: id } : undefined,
    });
  }
}
