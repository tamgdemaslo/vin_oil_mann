import { NextRequest, NextResponse } from "next/server";
import { autoCloseShifts } from "@/lib/shifts";

const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const secret = request.nextUrl.searchParams.get("secret");
  if (CRON_SECRET && auth !== `Bearer ${CRON_SECRET}` && secret !== CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { closed } = await autoCloseShifts();
  return NextResponse.json({ ok: true, closed });
}
