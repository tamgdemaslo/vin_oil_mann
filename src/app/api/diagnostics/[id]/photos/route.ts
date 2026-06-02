import { NextRequest, NextResponse } from "next/server";
import { requireApiSessionWithShift } from "@/lib/api-session-shift";
import { saveDiagnosticMapPhoto } from "@/lib/diagnostic-map-service";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiSessionWithShift();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const form = await request.formData();
  const itemCode = String(form.get("itemCode") ?? "");
  const caption = String(form.get("caption") ?? "");
  const file = form.get("file");
  if (!itemCode) return NextResponse.json({ error: "itemCode не указан" }, { status: 400 });
  if (!(file instanceof File)) return NextResponse.json({ error: "Фото не передано" }, { status: 400 });

  try {
    const photo = await saveDiagnosticMapPhoto(id, itemCode, file, caption);
    return NextResponse.json({ photo: { id: photo.id, caption: photo.caption, url: `/api/diagnostics/${id}/photos/${photo.id}` } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось сохранить фото" }, { status: 400 });
  }
}
