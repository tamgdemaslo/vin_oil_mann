import { NextResponse } from "next/server";
import { listIntegrationMessengerAccounts } from "@/lib/messenger/messenger-integrations";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";

export const dynamic = "force-dynamic";

export async function GET() {
  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access.response;
  if (access.context.user.role !== "owner" && access.context.user.role !== "admin") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  }
  const accounts = await runWithBranchApiContext(access.context, () => listIntegrationMessengerAccounts(access.context.user));
  return NextResponse.json({ accounts });
}
