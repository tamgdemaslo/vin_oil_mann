import { NextResponse } from "next/server";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { prisma } from "@/lib/db";
import { ensureMessengerIntegrationCoreSchema } from "@/lib/messenger/messenger-schema";
import { getMessengerOrganizationId } from "@/lib/messenger/messenger-tenant";
import { getScopedBranchId } from "@/lib/request-tenant-store";

export const dynamic = "force-dynamic";

export async function GET() {
  const branchAccess = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!branchAccess.ok) return branchAccess.response;

  return runWithBranchApiContext(branchAccess.context, async () => {
    await ensureMessengerIntegrationCoreSchema();
    const rows = await prisma.$queryRaw<Array<{ unreadTotal: number }>>`
      SELECT COALESCE(SUM(unread_count), 0)::int AS "unreadTotal"
      FROM messenger_conversations
      WHERE organization_id = ${getMessengerOrganizationId()}
        AND branch_id = ${getScopedBranchId()}
        AND status <> 'archived'
    `;
    return NextResponse.json(
      { unreadTotal: rows[0]?.unreadTotal ?? 0 },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  });
}
