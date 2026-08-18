import { NextRequest, NextResponse } from "next/server";
import { requireApiSessionWithCashShift } from "@/lib/api-session-cash-shift";
import { createDiagnosticCrmTask } from "@/lib/diagnostic-map-service";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiSessionWithCashShift();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  try {
    const deal = await createDiagnosticCrmTask(id, String(body.itemCode ?? ""), auth.session.user);
    return NextResponse.json({ ok: true, dealId: deal.id });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось создать CRM-задачу" }, { status: 400 });
  }
}
