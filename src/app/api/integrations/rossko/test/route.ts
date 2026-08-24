import { NextResponse } from "next/server";
import { z } from "zod";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { IntegrationNotConfiguredForBranch } from "@/lib/branch-integration-credentials";
import { RosskoError, type RosskoConfig, rosskoCheckoutDetails, rosskoCheckoutOptions, rosskoConfig, rosskoSearch, validateRosskoCheckoutSelection } from "@/lib/rossko";
import { recordRosskoCheck, rosskoIntegrationError } from "@/lib/rossko-integration";
import { canManageBranchIntegrationSecrets, canViewBranchIntegrationSettings } from "@/lib/integration-access";

export const runtime = "nodejs";

const testSchema = z.object({
  key1: z.string().trim().max(1_000).optional(),
  key2: z.string().trim().max(1_000).optional(),
  verifySearch: z.boolean().optional(),
});

const SEARCH_CHECK_TEXT = "KYB 333114";

function searchSummary(value: Record<string, unknown>) {
  const partsList = value.PartsList;
  const partValue = partsList && typeof partsList === "object" ? (partsList as Record<string, unknown>).Part : undefined;
  const parts = Array.isArray(partValue) ? partValue : partValue == null ? [] : [partValue];
  let stocks = 0;
  let prices = 0;
  let deliveries = 0;
  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    const stockValue = ((part as Record<string, unknown>).stocks as Record<string, unknown> | undefined)?.stock;
    const rows = Array.isArray(stockValue) ? stockValue : stockValue == null ? [] : [stockValue];
    for (const stock of rows) {
      if (!stock || typeof stock !== "object") continue;
      stocks += 1;
      const row = stock as Record<string, unknown>;
      if (row.price !== undefined && String(row.price).trim()) prices += 1;
      if (row.delivery !== undefined && String(row.delivery).trim()) deliveries += 1;
    }
  }
  return { query: SEARCH_CHECK_TEXT, offers: parts.length, stocks, prices, deliveries };
}

export async function POST(request: Request) {
  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access.response;
  if (!canViewBranchIntegrationSettings(access.context)) {
    return NextResponse.json({ error: "Проверка ROSSKO доступна владельцу и администраторам" }, { status: 403 });
  }

  let body: z.infer<typeof testSchema>;
  try {
    body = testSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Проверьте ключи ROSSKO" }, { status: 422 });
  }

  const usesTemporaryKeys = Boolean(body.key1 || body.key2);
  if (usesTemporaryKeys && !canManageBranchIntegrationSecrets(access.context)) {
    return NextResponse.json({ error: "Проверять новые ключи ROSSKO может только владелец" }, { status: 403 });
  }
  try {
    const result = await runWithBranchApiContext(access.context, async () => {
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
      };
      const checkout = rosskoCheckoutOptions(await rosskoCheckoutDetails(config));

      if (!body.verifySearch) {
        return {
          checkout,
          message: "Ключи проверены. Настройки для оформления заказа загружены из ROSSKO.",
          integration: usesTemporaryKeys ? undefined : await recordRosskoCheck(null),
        };
      }

      const errors = validateRosskoCheckoutSelection(checkout, config);
      if (errors.length) throw new RosskoError(errors.join(" "));
      const search = await rosskoSearch(config, {
        text: SEARCH_CHECK_TEXT,
        deliveryId: config.deliveryId ?? "",
        addressId: config.addressId,
      });
      const integration = await recordRosskoCheck(null);
      return {
        checkout,
        integration,
        message: "Проверки GetCheckoutDetails и GetSearch завершены. Заказ не создавался.",
        search: searchSummary(search),
      };
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const safe = rosskoIntegrationError(error, "check");
    const integration = !usesTemporaryKeys
      ? await runWithBranchApiContext(access.context, () => recordRosskoCheck(safe.code)).catch(() => null)
      : null;
    const errorMessage = error instanceof RosskoError ? error.message : safe.error;
    return NextResponse.json({ ok: false, error: errorMessage, code: safe.code, integration }, { status: errorMessage === safe.error && safe.code === "ROSSKO_NOT_CONFIGURED" ? 409 : 422 });
  }
}
