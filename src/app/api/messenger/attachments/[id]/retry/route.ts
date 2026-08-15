import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { enqueueMessengerMediaJob } from "@/lib/messenger/messenger-media";
import { ensureMessengerIntegrationCoreSchema } from "@/lib/messenger/messenger-schema";
import { getMessengerOrganizationId } from "@/lib/messenger/messenger-tenant";

export const dynamic = "force-dynamic";

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const branchAccess = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!branchAccess.ok) return branchAccess.response;
  if (branchAccess.context.user.role !== "owner" && branchAccess.context.user.role !== "admin") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  }
  return runWithBranchApiContext(branchAccess.context, async () => {
    await ensureMessengerIntegrationCoreSchema();
    const { id } = await params;
    const rows = await prisma.$queryRaw<Array<{ id: string; status: string; messengerAccountId: string | null }>>`
      UPDATE messenger_attachments
      SET status = 'queued',
          progress = 0,
          error_code = NULL,
          error_message = NULL,
          next_attempt_at = NULL,
          updated_at = now()
      WHERE id = ${id}
        AND organization_id = ${getMessengerOrganizationId()}
        AND branch_id = ${branchAccess.context.branchId}
      RETURNING id, status, messenger_account_id AS "messengerAccountId"
    `;
    if (!rows[0]) return NextResponse.json({ error: "Вложение не найдено" }, { status: 404 });
    await enqueueMessengerMediaJob({
      organizationId: getMessengerOrganizationId(),
      messengerAccountId: rows[0].messengerAccountId,
      attachmentId: id,
      operation: "download",
    });
    return NextResponse.json({ ok: true, attachment: rows[0], message: "Вложение поставлено в очередь на повторную загрузку." }, { status: 202 });
  });
}
