import fs from "fs/promises";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { diagnosticMapPhotoMime } from "@/lib/diagnostic-map-service";

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await prisma.diagnosticMapSession.findUnique({
    where: { publicToken: token },
    select: {
      vehiclePhoto: {
        select: {
          data: true,
          filePath: true,
          contentType: true,
        },
      },
    },
  });

  const photo = session?.vehiclePhoto;
  if (!photo) return NextResponse.json({ error: "Фото автомобиля не найдено" }, { status: 404 });

  const headers = {
    "Content-Type": diagnosticMapPhotoMime(photo.filePath, photo.contentType),
    "Cache-Control": "public, max-age=86400",
  };

  if (photo.data && photo.data.byteLength > 0) {
    return new NextResponse(Buffer.from(photo.data), { headers });
  }

  try {
    const buf = await fs.readFile(photo.filePath);
    return new NextResponse(buf, { headers });
  } catch {
    return NextResponse.json({ error: "Файл фото автомобиля недоступен" }, { status: 404 });
  }
}
