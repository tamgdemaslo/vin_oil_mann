import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { closeShiftByOwner } from "@/lib/shifts";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Необходимо войти" }, { status: 401 });
  }
  if (session.user.role !== "owner") {
    return NextResponse.json({ error: "Только владелец может закрыть смену вручную" }, { status: 403 });
  }
  const { id } = await params;
  const result = await closeShiftByOwner(id, session.user.login);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
