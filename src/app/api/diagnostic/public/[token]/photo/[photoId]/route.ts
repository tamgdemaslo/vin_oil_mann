import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import { prisma } from "@/lib/db";
import { mimeFromDiagnosticPhotoPath } from "@/lib/diagnostic-photos";
import { optimizeReportImage } from "@/lib/report-photo-optimization";

function responseBody(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

export async function GET(
  request: NextRequest,
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
    const variant = request.nextUrl.searchParams.get("variant");
    if (variant === "print" || variant === "thumbnail") {
      const optimized = await optimizeReportImage(buf, "thumbnail");
      return new NextResponse(responseBody(optimized.data), {
        headers: {
          "Content-Type": optimized.contentType,
          "Cache-Control": "public, max-age=86400",
          "X-TGM-Photo-Variant": "print",
          "X-TGM-Original-Size": String(optimized.originalSizeBytes),
          "X-TGM-Optimized-Size": String(optimized.sizeBytes),
        },
      });
    }

    return new NextResponse(responseBody(buf), {
      headers: {
        "Content-Type": mimeFromDiagnosticPhotoPath(photo.filePath),
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    return NextResponse.json({ error: "Файл недоступен" }, { status: 404 });
  }
}
