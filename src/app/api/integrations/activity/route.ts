import { NextResponse } from "next/server";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { canManageBranchIntegrationSecrets } from "@/lib/integration-access";
import { listIntegrationActivity } from "@/lib/integration-owner-notifications";

export const runtime = "nodejs";

export async function GET() {
  const access = await requireBranchApi({ allowAll: false, requireActive: false });
  if (!access.ok) return access.response;
  if (!canManageBranchIntegrationSecrets(access.context)) {
    return NextResponse.json({ error: "Журнал интеграций доступен владельцу бизнес-группы" }, { status: 403 });
  }
  return NextResponse.json({ items: await runWithBranchApiContext(access.context, () => listIntegrationActivity(50)) });
}
