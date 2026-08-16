import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    error: "Старые демонстрационные слоты отключены",
    code: "legacy_booking_disabled",
    bookingUrl: "/booking",
  }, { status: 410 });
}
