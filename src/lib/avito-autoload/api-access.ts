import { NextResponse } from "next/server";
import { z } from "zod";
import { requireBranchApi } from "@/lib/branch-api";
import { INTEGRATION_STORAGE_NOT_CONFIGURED_CODE, INTEGRATION_STORAGE_NOT_CONFIGURED_MESSAGE, isIntegrationEncryptionConfigurationError } from "@/lib/messenger/messenger-crypto";
import { canEditAvito, canViewAvito } from "./access";
import { AvitoAutoloadError } from "./schemas";

export async function requireAvitoApi(edit = false) {
  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access;
  if (!(edit ? canEditAvito(access.context) : canViewAvito(access.context))) return { ok: false as const, response: NextResponse.json({ error: edit ? "Недостаточно прав для изменения объявлений Авито" : "Нет доступа к разделу Авито" }, { status: 403 }) };
  return access;
}

export async function readAvitoRequest(request: Request): Promise<Record<string, unknown>> {
  const origin = request.headers.get("origin");
  const hosts = [new URL(request.url).host, request.headers.get("host"), request.headers.get("x-forwarded-host")?.split(",")[0].trim()].filter(Boolean);
  if (origin && !hosts.includes(new URL(origin).host)) throw new AvitoAutoloadError("Запрос должен исходить из эко-платформы", 403, "AVITO_ORIGIN_REJECTED");
  const text = await request.text();
  if (Buffer.byteLength(text) > 256 * 1024) throw new AvitoAutoloadError("Форма слишком большая", 413);
  try {
    const body = JSON.parse(text);
    if (body && typeof body === "object" && !Array.isArray(body)) return body;
  } catch { /* Return the same validation response without echoing credentials. */ }
  throw new AvitoAutoloadError("Неверный формат запроса", 400);
}

export function avitoApiError(error: unknown) {
  if (error instanceof z.ZodError) return NextResponse.json({ error: "Проверьте поля формы: неверное значение или формат", fields: error.issues.map((issue) => issue.path.join(".")) }, { status: 422 });
  if (error instanceof AvitoAutoloadError) return NextResponse.json({ error: error.message, code: error.code, ...(error.details ? { details: error.details } : {}) }, { status: error.status });
  if (isIntegrationEncryptionConfigurationError(error)) return NextResponse.json({ error: INTEGRATION_STORAGE_NOT_CONFIGURED_MESSAGE, code: INTEGRATION_STORAGE_NOT_CONFIGURED_CODE }, { status: 503 });
  return NextResponse.json({ error: "Не удалось выполнить действие Авито. Повторите после обновления страницы", code: "AVITO_TEMPORARILY_UNAVAILABLE" }, { status: 500 });
}
