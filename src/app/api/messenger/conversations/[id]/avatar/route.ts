import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
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
    Array<{ avatarUrl: string | null; avatarStatus: string | null; avatarStorageKey: string | null; avatarThumbnailKey: string | null }>
  >`
    SELECT participant_avatar_url AS "avatarUrl",
           avatar_status AS "avatarStatus",
           avatar_storage_key AS "avatarStorageKey",
           avatar_thumbnail_key AS "avatarThumbnailKey"
    FROM messenger_conversations
    WHERE id = ${id}
      AND organization_id = ${getMessengerOrganizationId()}
      AND branch_id = ${getScopedBranchId()}
    LIMIT 1
  `;
  const key = rows[0]?.avatarThumbnailKey || rows[0]?.avatarStorageKey;
  if (key) {
    const object = await getMessengerStorageObject(key);
    return new NextResponse(bufferToArrayBuffer(object.body), {
      headers: {
        "Content-Type": object.contentType || "image/jpeg",
        "Cache-Control": "private, max-age=3600",
      },
    });
  }
  const avatarUrl = rows[0]?.avatarUrl;
  if (avatarUrl?.startsWith("https://") || avatarUrl?.startsWith("http://")) {
    return NextResponse.redirect(avatarUrl, 302);
  }
  if (avatarUrl?.startsWith("data:image/")) {
    const match = avatarUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (match) {
      return new NextResponse(bufferToArrayBuffer(Buffer.from(match[2], "base64")), {
        headers: {
          "Content-Type": match[1],
          "Cache-Control": "private, max-age=3600",
        },
      });
    }
  }
  return NextResponse.json(
    {
      error: "Аватар ещё не загружен в хранилище",
      status: rows[0]?.avatarStatus ?? "pending",
    },
    { status: rows[0] ? 404 : 404 }
  );
}
