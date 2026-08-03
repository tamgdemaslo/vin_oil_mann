import { NextResponse } from "next/server";
import { getClientAppointmentSlots } from "@/lib/client-site-api";

export async function GET() {
  const items = getClientAppointmentSlots();
  return NextResponse.json({ items, total: items.length });
}
