import fs from "fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { requireApiSessionWithCashShift } from "@/lib/api-session-cash-shift";
import {
  deleteDiagnosticMapVehiclePhoto,
  diagnosticMapPhotoMime,
  getDiagnosticMapSession,
  getDiagnosticMapVehiclePhoto,
  saveDiagnosticMapVehiclePhoto,
} from "@/lib/diagnostic-map-service";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiSessionWithCashShift();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const photo = await getDiagnosticMapVehiclePhoto(id);
  if (!photo) return NextResponse.json({ error: "Фото автомобиля не найдено" }, { status: 404 });
  if (photo.data && photo.data.byteLength > 0) {
    return new NextResponse(Buffer.from(photo.data), {
      headers: {
        "Content-Type": diagnosticMapPhotoMime(photo.filePath, photo.contentType),
        "Cache-Control": "private, max-age=300",
      },
    });
  }
  try {
    const buf = await fs.readFile(photo.filePath);
    return new NextResponse(buf, {
      headers: {
        "Content-Type": diagnosticMapPhotoMime(photo.filePath, photo.contentType),
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch {
    return NextResponse.json({ error: "Файл фото автомобиля не найден" }, { status: 404 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiSessionWithCashShift();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const form = await request.formData();
  const caption = String(form.get("caption") ?? "");
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Фото не передано" }, { status: 400 });

  try {
    const photo = await saveDiagnosticMapVehiclePhoto(id, file, caption, auth.session.user.login);
    const diagnostic = await getDiagnosticMapSession(id);
    return NextResponse.json({
      photo: {
        id: photo.id,
        caption: photo.caption ?? "",
        url: `/api/diagnostics/${id}/vehicle-photo`,
        thumbnailUrl: `/api/diagnostics/${id}/vehicle-photo`,
        updatedAt: photo.updatedAt.toISOString(),
      },
      diagnostic,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось сохранить фото автомобиля" }, { status: 400 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiSessionWithCashShift();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const ok = await deleteDiagnosticMapVehiclePhoto(id);
  const diagnostic = await getDiagnosticMapSession(id);
  if (!ok) return NextResponse.json({ error: "Фото автомобиля не найдено", diagnostic }, { status: 404 });
  return NextResponse.json({ ok: true, diagnostic });
}
