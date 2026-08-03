import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getCurrentShift } from "@/lib/shifts";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Необходимо войти" }, { status: 401 });
  }
  const shift = await getCurrentShift(session.user.login);
  return NextResponse.json(shift ?? null);
}
