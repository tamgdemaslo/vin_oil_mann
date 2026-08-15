import { NextRequest, NextResponse } from "next/server";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { prisma } from "@/lib/db";
import { ensureMessengerIntegrationCoreSchema } from "@/lib/messenger/messenger-schema";
import { getMessengerOrganizationId } from "@/lib/messenger/messenger-tenant";
import { getScopedBranchId } from "@/lib/request-tenant-store";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const branchAccess = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!branchAccess.ok) return branchAccess.response;

  return runWithBranchApiContext(branchAccess.context, async () => {
    await ensureMessengerIntegrationCoreSchema();
    const { id } = await params;
    const rows = await prisma.$queryRaw`
      SELECT
        id,
        organization_id AS "organizationId",
        message_id AS "messageId",
        messenger_account_id AS "messengerAccountId",
        conversation_id AS "conversationId",
        channel,
        direction,
        type,
        name,
        size,
        mime_type AS "mimeType",
        status,
        progress,
        error_code AS "errorCode",
        error_message AS "errorMessage",
        caption,
        width,
        height,
        duration,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM messenger_attachments
      WHERE id = ${id}
        AND organization_id = ${getMessengerOrganizationId()}
        AND branch_id = ${getScopedBranchId()}
      LIMIT 1
    `;
    const attachment = Array.isArray(rows) ? rows[0] : null;
    if (!attachment) return NextResponse.json({ error: "Вложение не найдено" }, { status: 404 });
    return NextResponse.json({ attachment });
  });
}
