import { NextResponse } from "next/server";
import { listIntegrationMessengerChannels } from "@/lib/messenger/messenger-integrations";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";

export const dynamic = "force-dynamic";

export async function GET() {
  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access.response;
  const channels = await runWithBranchApiContext(access.context, () => listIntegrationMessengerChannels(access.context.user));
  return NextResponse.json({ channels });
}
