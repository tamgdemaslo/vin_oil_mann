import { NextResponse } from "next/server";
import { z } from "zod";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { disconnectRosskoIntegration, getRosskoIntegrationStatus, saveRosskoIntegration } from "@/lib/rossko-integration";
import { RosskoError, type RosskoConfig, rosskoCheckoutDetails, rosskoCheckoutOptions, rosskoConfig, validateRosskoCheckoutSelection } from "@/lib/rossko";
import { IntegrationNotConfiguredForBranch } from "@/lib/branch-integration-credentials";
import { canManageBranchIntegrationSecrets, canViewBranchIntegrationSettings } from "@/lib/integration-access";
import {
  INTEGRATION_STORAGE_NOT_CONFIGURED_CODE,
  INTEGRATION_STORAGE_NOT_CONFIGURED_MESSAGE,
  isIntegrationEncryptionConfigurationError,
} from "@/lib/messenger/messenger-crypto";

export const runtime = "nodejs";

const settingsSchema = z.object({
  key1: z.string().trim().max(1_000).optional(),
  key2: z.string().trim().max(1_000).optional(),
  deliveryId: z.string().trim().max(180).optional(),
  addressId: z.string().trim().max(180).optional(),
  paymentId: z.string().trim().max(180).optional(),
  requisiteId: z.string().trim().max(180).optional(),
  contactName: z.string().trim().max(180).optional(),
  contactPhone: z.string().trim().max(80).optional(),
  contactComment: z.string().trim().max(200).optional(),
  deliveryParts: z.boolean().optional(),
  offerPriority: z.enum(["optimal", "fastest", "lowest_price", "local_stock"]).optional(),
  disconnect: z.boolean().optional(),
});

async function accessForRossko() {
  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access;
  if (!canViewBranchIntegrationSettings(access.context)) {
    return { ok: false as const, response: NextResponse.json({ error: "Настройки ROSSKO доступны владельцу и администраторам" }, { status: 403 }) };
  }
  return access;
}

export async function GET() {
  const access = await accessForRossko();
  if (!access.ok) return access.response;
  try {
    return NextResponse.json(await runWithBranchApiContext(access.context, getRosskoIntegrationStatus));
  } catch {
    return NextResponse.json({ error: "Не удалось получить настройки ROSSKO", code: "ROSSKO_TEMPORARILY_UNAVAILABLE" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const access = await accessForRossko();
  if (!access.ok) return access.response;
  try {
    const body = settingsSchema.parse(await request.json());
    if (!canManageBranchIntegrationSecrets(access.context) && (body.key1 || body.key2 || body.disconnect)) {
      return NextResponse.json({ error: "Менять секреты и отключать ROSSKO может только владелец" }, { status: 403 });
    }
    const status = await runWithBranchApiContext(access.context, async () => {
      if (body.disconnect) return disconnectRosskoIntegration(access.context.userId);
      const current: RosskoConfig = await rosskoConfig().catch((error): RosskoConfig => {
        if (!(error instanceof IntegrationNotConfiguredForBranch)) throw error;
        return {
          key1: "",
          key2: "",
          timeoutMs: 20_000,
          requestsPerSecond: 4,
          deliveryParts: true,
          offerPriority: "optimal" as const,
        };
      });
      const config = {
        ...current,
        key1: body.key1 || current.key1,
        key2: body.key2 || current.key2,
        deliveryId: body.deliveryId ?? current.deliveryId,
        addressId: body.addressId ?? current.addressId,
        paymentId: body.paymentId ?? current.paymentId,
        requisiteId: body.requisiteId ?? current.requisiteId,
      };
      const options = rosskoCheckoutOptions(await rosskoCheckoutDetails(config));
      const errors = validateRosskoCheckoutSelection(options, config);
      if (errors.length) throw new RosskoError(errors.join(" "));

      const { deliveryParts, ...input } = body;
      const saved = await saveRosskoIntegration(
        { ...input, ...(deliveryParts == null ? {} : { deliveryParts: String(deliveryParts) }) },
        access.context.userId
      );
      return saved.status;
    });
    return NextResponse.json(status);
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Проверьте значения настроек ROSSKO" }, { status: 422 });
    if (error instanceof RosskoError) return NextResponse.json({ error: error.message }, { status: 422 });
    if (isIntegrationEncryptionConfigurationError(error)) {
      return NextResponse.json(
        { error: INTEGRATION_STORAGE_NOT_CONFIGURED_MESSAGE, code: INTEGRATION_STORAGE_NOT_CONFIGURED_CODE },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: "Не удалось сохранить настройки ROSSKO" }, { status: 500 });
  }
}
