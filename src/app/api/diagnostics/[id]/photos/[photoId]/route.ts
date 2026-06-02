import fs from "fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { requireApiSessionWithShift } from "@/lib/api-session-shift";
import {
  deleteDiagnosticMapPhoto,
  diagnosticMapPhotoMime,
  getDiagnosticMapPhoto,
  updateDiagnosticMapPhoto,
} from "@/lib/diagnostic-map-service";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string; photoId: string }> }) {
  const { id, photoId } = await params;
  const photo = await getDiagnosticMapPhoto(id, photoId);
  if (!photo) return NextResponse.json({ error: "Фото не найдено" }, { status: 404 });
  try {
    const buf = await fs.readFile(photo.filePath);
    return new NextResponse(buf, { headers: { "Content-Type": diagnosticMapPhotoMime(photo.filePath), "Cache-Control": "private, max-age=300" } });
  } catch {
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
