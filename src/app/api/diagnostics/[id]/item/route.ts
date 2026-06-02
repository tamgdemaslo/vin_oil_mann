import { NextRequest, NextResponse } from "next/server";
import { requireApiSessionWithShift } from "@/lib/api-session-shift";
import { updateDiagnosticMapItem } from "@/lib/diagnostic-map-service";

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiSessionWithShift();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  let body: Parameters<typeof updateDiagnosticMapItem>[1];
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Неверное тело запроса" }, { status: 400 });
  }

  try {
    const item = await updateDiagnosticMapItem(id, body);
    return NextResponse.json({ item });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось сохранить пункт" }, { status: 400 });
  }
}
