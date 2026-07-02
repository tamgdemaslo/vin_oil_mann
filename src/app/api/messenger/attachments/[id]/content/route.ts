import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { ensureMessengerIntegrationCoreSchema } from "@/lib/messenger/messenger-schema";
import { bufferToArrayBuffer, getMessengerStorageObject, publicMessengerStorageUrl } from "@/lib/messenger/messenger-storage";
import { getMessengerOrganizationId } from "@/lib/messenger/messenger-tenant";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  await ensureMessengerIntegrationCoreSchema();
  const { id } = await params;
  const rows = await prisma.$queryRaw<
    Array<{ url: string | null; status: string; name: string | null; mimeType: string | null; originalStorageKey: string | null }>
  >`
    SELECT url, status, name, mime_type AS "mimeType", original_storage_key AS "originalStorageKey"
    FROM messenger_attachments
    WHERE id = ${id}
      AND organization_id = ${getMessengerOrganizationId()}
    LIMIT 1
  `;
  const attachment = rows[0];
  if (!attachment) return NextResponse.json({ error: "Вложение не найдено" }, { status: 404 });
  if (attachment.originalStorageKey) {
    const publicUrl = publicMessengerStorageUrl(attachment.originalStorageKey);
    if (publicUrl) return NextResponse.redirect(publicUrl, 302);
    const object = await getMessengerStorageObject(attachment.originalStorageKey);
    return new NextResponse(bufferToArrayBuffer(object.body), {
      headers: {
        "Content-Type": attachment.mimeType || object.contentType || "application/octet-stream",
        "Content-Length": String(object.body.length),
        "Content-Disposition": `inline; filename="${encodeURIComponent(attachment.name || "attachment")}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  }
  if (attachment.url?.startsWith("https://") || attachment.url?.startsWith("http://")) {
    return NextResponse.redirect(attachment.url, 302);
  }
  return NextResponse.json(
    {
      error: "Вложение ещё не загружено в хранилище",
      status: attachment.status,
      name: attachment.name,
    },
    { status: 404 }
  );
}
