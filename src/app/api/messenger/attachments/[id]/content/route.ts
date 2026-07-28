import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { ensureMessengerIntegrationCoreSchema } from "@/lib/messenger/messenger-schema";
import { bufferToArrayBuffer, getMessengerStorageObject } from "@/lib/messenger/messenger-storage";
import { getMessengerOrganizationId } from "@/lib/messenger/messenger-tenant";
import { getScopedBranchId } from "@/lib/request-tenant-store";

export const dynamic = "force-dynamic";

function safeAsciiFileName(name?: string | null) {
  const cleaned = (name || "attachment")
    .normalize("NFKD")
    .replace(/[^\w.\- ]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
  return cleaned || "attachment";
}

function isInlineMime(mimeType: string) {
  const type = mimeType.toLowerCase();
  if (type === "image/svg+xml" || type === "text/html" || type === "application/xhtml+xml") return false;
  return type.startsWith("image/") || type.startsWith("video/") || type.startsWith("audio/") || type === "application/pdf";
}

function contentDisposition(mimeType: string, name?: string | null) {
  const fallback = safeAsciiFileName(name);
  const encoded = encodeURIComponent(name?.trim() || fallback);
  const disposition = isInlineMime(mimeType) ? "inline" : "attachment";
  return `${disposition}; filename="${fallback.replaceAll('"', "")}"; filename*=UTF-8''${encoded}`;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
      AND branch_id = ${getScopedBranchId()}
    LIMIT 1
  `;
  const attachment = rows[0];
  if (!attachment) return NextResponse.json({ error: "Вложение не найдено" }, { status: 404 });
  if (attachment.originalStorageKey) {
    const range = request.headers.get("range");
    const object = await getMessengerStorageObject(attachment.originalStorageKey, { range });
    const mimeType = attachment.mimeType || object.contentType || "application/octet-stream";
    const status = object.statusCode === 206 ? 206 : 200;
    const headers = new Headers({
      "Content-Type": isInlineMime(mimeType) ? mimeType : "application/octet-stream",
      "Content-Length": String(object.body.length),
      "Content-Disposition": contentDisposition(mimeType, attachment.name),
      "Cache-Control": "private, max-age=3600",
      "Accept-Ranges": "bytes",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; media-src 'self' blob:; img-src 'self' blob: data:; style-src 'unsafe-inline'",
    });
    if (object.contentRange) headers.set("Content-Range", object.contentRange);
    if (object.etag) headers.set("ETag", object.etag);
    return new NextResponse(bufferToArrayBuffer(object.body), {
      status,
      headers,
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
