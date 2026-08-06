import { NextResponse } from "next/server";
import { requireBranchApi } from "@/lib/branch-api";
import { canManageBranchIntegrationSecrets } from "@/lib/integration-access";

export async function requireTelegramOwnerBranchApi() {
  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access;
  if (!canManageBranchIntegrationSecrets(access.context)) {
    return { ok: false as const, response: NextResponse.json({ error: "Только владелец может управлять рабочим Telegram" }, { status: 403 }) };
  }
  return access;
}
