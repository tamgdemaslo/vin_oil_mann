import fs from "fs/promises";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { diagnosticMapPhotoMime } from "@/lib/diagnostic-map-service";
import { optimizeReportImage, type ReportPhotoVariant } from "@/lib/report-photo-optimization";

const VEHICLE_PHOTO_VARIANTS = new Set<ReportPhotoVariant>(["reportHero", "printHero", "thumbnail"]);

function vehiclePhotoVariant(value: string | null): ReportPhotoVariant {
  if (value === "print") return "printHero";
  return VEHICLE_PHOTO_VARIANTS.has(value as ReportPhotoVariant) ? (value as ReportPhotoVariant) : "reportHero";
}

async function readVehiclePhotoBuffer(photo: { data: Uint8Array | null; filePath: string }): Promise<Buffer> {
  if (photo.data && photo.data.byteLength > 0) return Buffer.from(photo.data);
  return fs.readFile(photo.filePath);
}

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const requestedVariant = new URL(request.url).searchParams.get("variant") || "reportHero";
  const variant = vehiclePhotoVariant(requestedVariant);
  const session = await prisma.diagnosticMapSession.findUnique({
    where: { publicToken: token },
    select: {
      id: true,
      vehiclePhoto: {
        select: {
          id: true,
          data: true,
          filePath: true,
          contentType: true,
          sizeBytes: true,
          updatedAt: true,
        },
      },
    },
  });

  const photo = session?.vehiclePhoto;
  if (!photo) return NextResponse.json({ error: "Фото автомобиля не найдено" }, { status: 404 });
  const contentType = diagnosticMapPhotoMime(photo.filePath, photo.contentType);

  try {
    const original = await readVehiclePhotoBuffer(photo);
    const optimized = await optimizeReportImage(original, variant);
    console.info("[diagnostic-vehicle-photo] public image optimized", {
      reportToken: token,
      diagnosticId: session.id,
      vehiclePhotoId: photo.id,
      requestedVariant,
      variant,
      originalSizeBytes: photo.sizeBytes ?? original.byteLength,
      optimizedSizeBytes: optimized.sizeBytes,
      width: optimized.width,
      height: optimized.height,
    });
    return new NextResponse(new Uint8Array(optimized.data), {
      headers: {
        "Content-Type": optimized.contentType,
        "Cache-Control": "public, max-age=86400",
        "X-TGM-Photo-Variant": requestedVariant === "print" ? "print" : variant,
        "X-TGM-Photo-Original-Size": String(photo.sizeBytes ?? original.byteLength),
        "X-TGM-Photo-Size": String(optimized.sizeBytes),
      },
    });
  } catch (error) {
    console.warn("[diagnostic-vehicle-photo] public image optimization failed", {
      reportToken: token,
      diagnosticId: session.id,
      vehiclePhotoId: photo.id,
      variant,
      contentType,
      sizeBytes: photo.sizeBytes ?? null,
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Файл фото автомобиля недоступен" }, { status: 404 });
  }
}
