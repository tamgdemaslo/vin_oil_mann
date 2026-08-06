import { NextResponse } from "next/server";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { retryAqsiFiscalization } from "@/lib/aqsi-fiscalization";
import { canViewBranchIntegrationSettings } from "@/lib/integration-access";

export const runtime = "nodejs";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access.response;
  if (!canViewBranchIntegrationSettings(access.context)) {
    return NextResponse.json({ error: "Повторная отправка AQSI недоступна для этой роли" }, { status: 403 });
  }
  const { id } = await params;
  try {
    return NextResponse.json(await runWithBranchApiContext(access.context, () => retryAqsiFiscalization(id)));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Повторная отправка не выполнена" }, { status: 422 });
  }
}
