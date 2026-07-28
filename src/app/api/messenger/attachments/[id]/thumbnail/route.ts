import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ensureMessengerIntegrationCoreSchema } from "@/lib/messenger/messenger-schema";
import { bufferToArrayBuffer, getMessengerStorageObject } from "@/lib/messenger/messenger-storage";
import { getMessengerOrganizationId } from "@/lib/messenger/messenger-tenant";
import { getScopedBranchId } from "@/lib/request-tenant-store";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  await ensureMessengerIntegrationCoreSchema();
  const { id } = await params;
  const rows = await prisma.$queryRaw<
    Array<{
      status: string;
      name: string | null;
      mimeType: string | null;
      originalStorageKey: string | null;
      thumbnailStorageKey: string | null;
    }>
  >`
    SELECT
      status,
      name,
      mime_type AS "mimeType",
      original_storage_key AS "originalStorageKey",
      thumbnail_storage_key AS "thumbnailStorageKey"
    FROM messenger_attachments
    WHERE id = ${id}
      AND organization_id = ${getMessengerOrganizationId()}
      AND branch_id = ${getScopedBranchId()}
    LIMIT 1
  `;
  const attachment = rows[0];
  if (!attachment) return NextResponse.json({ error: "Вложение не найдено" }, { status: 404 });
  const key = attachment.thumbnailStorageKey || attachment.originalStorageKey;
  if (!key) {
    return NextResponse.json({ error: "Превью ещё не загружено", status: attachment.status }, { status: 404 });
  }
  const object = await getMessengerStorageObject(key);
  return new NextResponse(bufferToArrayBuffer(object.body), {
    headers: {
      "Content-Type": attachment.mimeType || object.contentType || "application/octet-stream",
      "Content-Length": String(object.body.length),
      "Content-Disposition": `inline; filename="${encodeURIComponent(attachment.name || "thumbnail")}"`,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
