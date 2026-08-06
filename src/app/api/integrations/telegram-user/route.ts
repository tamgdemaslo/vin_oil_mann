import { NextResponse } from "next/server";
import { z } from "zod";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { disconnectTelegramUserCredentials, getTelegramUserIntegrationStatus, saveTelegramUserIntegration } from "@/lib/telegram-user-integration";
import { canManageBranchIntegrationSecrets, canViewBranchIntegrationSettings } from "@/lib/integration-access";

export const runtime = "nodejs";

const inputSchema = z.object({
  apiId: z.string().trim().max(30).optional(),
  apiHash: z.string().trim().max(200).optional(),
  disconnect: z.boolean().optional(),
});

async function access() {
  const result = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!result.ok) return result;
  if (!canViewBranchIntegrationSettings(result.context)) {
    return { ok: false as const, response: NextResponse.json({ error: "Настройки Telegram недоступны для этой роли" }, { status: 403 }) };
  }
  return result;
}

export async function GET() {
  const auth = await access();
  if (!auth.ok) return auth.response;
  return NextResponse.json(await runWithBranchApiContext(auth.context, getTelegramUserIntegrationStatus));
}

export async function PATCH(request: Request) {
  const auth = await access();
  if (!auth.ok) return auth.response;
  if (!canManageBranchIntegrationSecrets(auth.context)) {
    return NextResponse.json({ error: "Менять секреты Telegram может только владелец" }, { status: 403 });
  }
  try {
    const input = inputSchema.parse(await request.json());
    const status = await runWithBranchApiContext(auth.context, () => input.disconnect
      ? disconnectTelegramUserCredentials(auth.context.userId)
      : saveTelegramUserIntegration(input, auth.context.userId));
    return NextResponse.json(status);
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Проверьте настройки Telegram" }, { status: 422 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Настройки Telegram не сохранены" }, { status: 422 });
  }
}
