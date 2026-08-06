import { NextResponse } from "next/server";
import { z } from "zod";
import { validateAqsiConfig } from "@/lib/aqsi";
import { recordAqsiCheck, resolveAqsiCashRegister, safeAqsiError } from "@/lib/aqsi-integration";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { canManageBranchIntegrationSecrets, canViewBranchIntegrationSettings } from "@/lib/integration-access";
import type { AqsiResolvedConfig } from "@/lib/aqsi-integration";

export const runtime = "nodejs";

const schema = z.object({
  registerId: z.string().trim().min(1).max(100).optional(),
  name: z.string().trim().max(120).optional(),
  apiKey: z.string().trim().max(2_000).optional(),
  baseUrl: z.string().trim().url().max(500).optional(),
  ordersPath: z.string().trim().max(300).optional(),
  pendingOrderPath: z.string().trim().max(300).optional(),
  devicesPath: z.string().trim().max(300).optional(),
  deviceId: z.string().trim().max(200).optional(),
  shopId: z.string().trim().max(200).optional(),
  cashierId: z.string().trim().max(200).optional(),
});

export async function POST(request: Request) {
  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access.response;
  if (!canViewBranchIntegrationSettings(access.context)) {
    return NextResponse.json({ error: "Проверка AQSI недоступна для этой роли" }, { status: 403 });
  }
  try {
    const input = schema.parse(await request.json());
    if (input.apiKey && !canManageBranchIntegrationSecrets(access.context)) {
      return NextResponse.json({ error: "Проверять новый ключ AQSI может только владелец" }, { status: 403 });
    }
    return await runWithBranchApiContext(access.context, async () => {
      try {
        const stored = input.registerId ? await resolveAqsiCashRegister(input.registerId) : null;
        if (!stored && !input.apiKey) throw new Error("Введите API-ключ AQSI");
        const config: AqsiResolvedConfig = {
          registerId: stored?.registerId ?? "temporary",
          registerName: input.name || stored?.registerName || "Новая касса",
          apiKey: input.apiKey || stored?.apiKey || "",
          markingBypassPassword: stored?.markingBypassPassword,
          baseUrl: input.baseUrl || stored?.baseUrl || "https://api.aqsi.ru/pub",
          ordersPath: input.ordersPath || stored?.ordersPath || "/v2/Receipts",
          pendingOrderPath: input.pendingOrderPath || stored?.pendingOrderPath || "/v2/Orders/simple",
          devicesPath: input.devicesPath || stored?.devicesPath || "/v1/Devices",
          deviceId: input.deviceId === undefined ? stored?.deviceId : input.deviceId || undefined,
          shopId: input.shopId === undefined ? stored?.shopId : input.shopId || undefined,
          cashierId: input.cashierId === undefined ? stored?.cashierId : input.cashierId || undefined,
        };
        const checked = await validateAqsiConfig(config);
        if (input.registerId && !checked.needsDevice) await recordAqsiCheck(input.registerId, null);
        return NextResponse.json({
          ok: true,
          message: checked.needsDevice ? "AQSI отвечает. Выберите устройство из загруженного списка и сохраните кассу." : "Касса AQSI отвечает. Фискальный документ не создавался.",
          devices: checked.devices,
          binding: checked.binding,
          needsDevice: checked.needsDevice,
          integration: await (await import("@/lib/aqsi-integration")).getAqsiIntegrationStatus(),
        });
      } catch (error) {
        const safe = safeAqsiError(error);
        if (input.registerId) await recordAqsiCheck(input.registerId, safe).catch(() => undefined);
        return NextResponse.json({ ok: false, error: safe.message, code: safe.code }, { status: 422 });
      }
    });
  } catch {
    return NextResponse.json({ error: "Проверьте параметры кассы AQSI" }, { status: 422 });
  }
}
