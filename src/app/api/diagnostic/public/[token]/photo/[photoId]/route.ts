import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import { prisma } from "@/lib/db";
import { mimeFromDiagnosticPhotoPath } from "@/lib/diagnostic-photos";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string; photoId: string }> }
) {
  const { token, photoId } = await params;

  const diag = await prisma.diagnostic.findUnique({
    where: { clientReportToken: token },
    select: { id: true },
  });
  if (!diag) return NextResponse.json({ error: "Не найдено" }, { status: 404 });

  const photo = await prisma.diagnosticPhoto.findFirst({
    where: { id: photoId, position: { diagnosticId: diag.id } },
  });
  if (!photo) return NextResponse.json({ error: "Не найдено" }, { status: 404 });

  try {
    const buf = await fs.readFile(photo.filePath);
    return new NextResponse(buf, {
      headers: {
        "Content-Type": mimeFromDiagnosticPhotoPath(photo.filePath),
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    return NextResponse.json({ error: "Файл недоступен" }, { status: 404 });
  }
}
