import { NextRequest, NextResponse } from "next/server";
import {
  ClientApiError,
  createClientAppointment,
  listClientAppointments,
} from "@/lib/client-site-api";

export async function GET() {
  const items = listClientAppointments();
  return NextResponse.json({ items, total: items.length });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  try {
    return NextResponse.json(createClientAppointment(body ?? {}), { status: 201 });
  } catch (error) {
    if (error instanceof ClientApiError) {
      return NextResponse.json({ error: { message: error.message } }, { status: error.status });
    }
    return NextResponse.json({ error: { message: "Не получилось создать запись." } }, { status: 500 });
  }
}
