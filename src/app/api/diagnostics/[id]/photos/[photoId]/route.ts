import fs from "fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { requireApiSessionWithShift } from "@/lib/api-session-shift";
import {
  deleteDiagnosticMapPhoto,
  diagnosticMapPhotoMime,
  getDiagnosticMapPhoto,
  updateDiagnosticMapPhoto,
} from "@/lib/diagnostic-map-service";
import { optimizeReportImage } from "@/lib/report-photo-optimization";

function requestedPhotoVariant(request: NextRequest) {
  const variant = request.nextUrl.searchParams.get("variant");
  return variant === "print" || variant === "thumbnail" ? variant : null;
}

async function readPhotoBytes(photo: { data: Uint8Array | Buffer | null; filePath: string }) {
  if (photo.data && photo.data.byteLength > 0) return Buffer.from(photo.data);
  return fs.readFile(photo.filePath);
}

function responseBody(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; photoId: string }> }) {
  const auth = await requireApiSessionWithShift();
  if (!auth.ok) return auth.response;
  const { id, photoId } = await params;
  const photo = await getDiagnosticMapPhoto(id, photoId);
  if (!photo) return NextResponse.json({ error: "Фото не найдено" }, { status: 404 });

  try {
    const buf = await readPhotoBytes(photo);
    const requestedVariant = requestedPhotoVariant(request);
    if (requestedVariant) {
      const optimized = await optimizeReportImage(buf, requestedVariant === "print" ? "diagnostic" : "thumbnail");
      return new NextResponse(responseBody(optimized.data), {
        headers: {
          "Content-Type": optimized.contentType,
          "Cache-Control": "private, max-age=3600",
          "X-TGM-Photo-Variant": requestedVariant,
          "X-TGM-Original-Size": String(optimized.originalSizeBytes),
          "X-TGM-Optimized-Size": String(optimized.sizeBytes),
        },
      });
    }

    return new NextResponse(responseBody(buf), {
      headers: {
        "Content-Type": diagnosticMapPhotoMime(photo.filePath, photo.contentType),
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (error) {
    console.warn("[diagnostic-photo] failed to read or optimize photo", {
      sessionId: id,
      photoId,
      variant: request.nextUrl.searchParams.get("variant"),
      error,
    });
    return NextResponse.json({ error: "Файл фото не найден" }, { status: 404 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; photoId: string }> }) {
  const auth = await requireApiSessionWithShift();
  if (!auth.ok) return auth.response;
  const { id, photoId } = await params;
  const body = await request.json().catch(() => ({}));
  const photo = await updateDiagnosticMapPhoto(id, photoId, String(body.caption ?? ""));
  if (!photo) return NextResponse.json({ error: "Фото не найдено" }, { status: 404 });
  return NextResponse.json({ photo: { id: photo.id, caption: photo.caption } });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string; photoId: string }> }) {
  const auth = await requireApiSessionWithShift();
  if (!auth.ok) return auth.response;
  const { id, photoId } = await params;
  const ok = await deleteDiagnosticMapPhoto(id, photoId);
  if (!ok) return NextResponse.json({ error: "Фото не найдено" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
