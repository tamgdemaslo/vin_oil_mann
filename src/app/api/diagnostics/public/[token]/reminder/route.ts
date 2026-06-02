import { NextRequest, NextResponse } from "next/server";
import { savePublicDiagnosticReminder } from "@/lib/diagnostic-map-service";

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const body = await request.json().catch(() => ({}));
  try {
    const row = await savePublicDiagnosticReminder(token, Boolean(body.clientWantsReminder ?? true));
    return NextResponse.json({ ok: true, clientWantsReminder: row.clientWantsReminder });
  } catch {
    return NextResponse.json({ error: "Диагностика не найдена" }, { status: 404 });
  }
}
