import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/db";
import { requireApiSessionWithShift } from "@/lib/api-session-shift";
import {
  buildPhotoDiskPath,
  ensureDiagnosticPhotosDir,
  safeExtFromMime,
} from "@/lib/diagnostic-photos";
import fs from "fs/promises";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireApiSessionWithShift();
  if (!gate.ok) return gate.response;

  const { id: diagnosticId } = await params;
  if (!diagnosticId) return NextResponse.json({ error: "id не указан" }, { status: 400 });

  const form = await request.formData();
  const node = String(form.get("node") ?? "").trim();
  const caption = form.get("caption") ? String(form.get("caption")) : null;
  const file = form.get("file");

  if (!node || !(file instanceof Blob)) {
    return NextResponse.json({ error: "Нужны node и file" }, { status: 400 });
  }

  const position = await prisma.diagnosticPosition.findUnique({
    where: { diagnosticId_node: { diagnosticId, node } },
  });
  if (!position) {
    return NextResponse.json({ error: "Позиция не найдена" }, { status: 404 });
  }

  ensureDiagnosticPhotosDir(diagnosticId);
  const photoId = randomUUID();
  const mime = file.type || "image/jpeg";
  const ext = safeExtFromMime(mime);
  const diskPath = buildPhotoDiskPath(diagnosticId, photoId, ext);

  const buf = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(diskPath, buf);

  const photo = await prisma.diagnosticPhoto.create({
    data: {
      id: photoId,
      positionId: position.id,
      filePath: diskPath,
      caption: caption?.trim() || null,
    },
  });

  return NextResponse.json({
    id: photo.id,
    positionId: photo.positionId,
    caption: photo.caption,
  });
}
