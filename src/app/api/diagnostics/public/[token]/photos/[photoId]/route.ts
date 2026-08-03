import fs from "fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { diagnosticMapPhotoMime } from "@/lib/diagnostic-map-service";
import { optimizeReportImage } from "@/lib/report-photo-optimization";

function responseBody(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string; photoId: string }> }
) {
  const { token, photoId } = await params;
  const photo = await prisma.diagnosticMapPhoto.findFirst({
    where: { id: photoId, item: { session: { publicToken: token } } },
    select: { data: true, filePath: true, contentType: true },
  });
  if (!photo) return NextResponse.json({ error: "Фото не найдено" }, { status: 404 });

  try {
    const bytes = photo.data?.byteLength ? Buffer.from(photo.data) : await fs.readFile(photo.filePath);
    const variant = request.nextUrl.searchParams.get("variant");
    if (variant === "print" || variant === "thumbnail") {
      const optimized = await optimizeReportImage(bytes, variant === "print" ? "diagnostic" : "thumbnail");
      return new NextResponse(responseBody(optimized.data), {
        headers: {
          "Content-Type": optimized.contentType,
          "Cache-Control": "public, max-age=86400",
          "X-TGM-Photo-Variant": variant,
        },
      });
    }
    return new NextResponse(responseBody(bytes), {
      headers: {
        "Content-Type": diagnosticMapPhotoMime(photo.filePath, photo.contentType),
        "Cache-Control": "public, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "Файл фото не найден" }, { status: 404 });
  }
}
