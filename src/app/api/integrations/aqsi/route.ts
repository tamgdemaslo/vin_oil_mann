import { NextResponse } from "next/server";
import { z } from "zod";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { disconnectAqsiCashRegister, getAqsiIntegrationStatus, saveAqsiCashRegister } from "@/lib/aqsi-integration";
import { canManageBranchIntegrationSecrets, canViewBranchIntegrationSettings } from "@/lib/integration-access";
import {
  INTEGRATION_STORAGE_NOT_CONFIGURED_CODE,
  INTEGRATION_STORAGE_NOT_CONFIGURED_MESSAGE,
  isIntegrationEncryptionConfigurationError,
} from "@/lib/messenger/messenger-crypto";

export const runtime = "nodejs";

const inputSchema = z.object({
  id: z.string().trim().max(100).optional(),
  name: z.string().trim().max(120).optional(),
  apiKey: z.string().trim().max(2_000).optional(),
  markingBypassPassword: z.string().trim().max(300).optional(),
  baseUrl: z.string().trim().url().max(500).optional(),
  ordersPath: z.string().trim().max(300).optional(),
  pendingOrderPath: z.string().trim().max(300).optional(),
  devicesPath: z.string().trim().max(300).optional(),
  deviceId: z.string().trim().max(200).optional(),
  shopId: z.string().trim().max(200).optional(),
  cashierId: z.string().trim().max(200).optional(),
  isDefault: z.boolean().optional(),
  enabled: z.boolean().optional(),
  disconnect: z.boolean().optional(),
});

async function access() {
  const result = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!result.ok) return result;
  if (!canViewBranchIntegrationSettings(result.context)) {
    return { ok: false as const, response: NextResponse.json({ error: "Настройки AQSI недоступны для этой роли" }, { status: 403 }) };
  }
  return result;
}

export async function GET() {
  const auth = await access();
  if (!auth.ok) return auth.response;
  return NextResponse.json(await runWithBranchApiContext(auth.context, getAqsiIntegrationStatus));
}

export async function PATCH(request: Request) {
  const auth = await access();
  if (!auth.ok) return auth.response;
  try {
    const input = inputSchema.parse(await request.json());
    if (!canManageBranchIntegrationSecrets(auth.context) && (input.apiKey || input.markingBypassPassword || input.disconnect || input.enabled !== undefined || !input.id)) {
      return NextResponse.json({ error: "Добавлять кассы, менять секреты и отключать AQSI может только владелец" }, { status: 403 });
    }
    if (input.disconnect && !input.id) return NextResponse.json({ error: "Не указана касса AQSI" }, { status: 422 });
    const status = await runWithBranchApiContext(auth.context, () => input.disconnect
      ? disconnectAqsiCashRegister(input.id!, auth.context.userId)
      : saveAqsiCashRegister(input, auth.context.userId));
    return NextResponse.json(status);
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Проверьте настройки AQSI" }, { status: 422 });
    if (isIntegrationEncryptionConfigurationError(error)) {
      return NextResponse.json(
        { error: INTEGRATION_STORAGE_NOT_CONFIGURED_MESSAGE, code: INTEGRATION_STORAGE_NOT_CONFIGURED_CODE },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Настройки AQSI не сохранены" }, { status: 422 });
  }
}
