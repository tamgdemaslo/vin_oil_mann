import { NextResponse } from "next/server";

const replacement = {
  error: {
    message: "Старая форма записи отключена. Используйте /booking и /api/public/booking.",
    code: "legacy_booking_disabled",
    bookingUrl: "/booking",
  },
};

export async function GET() {
  return NextResponse.json(replacement, { status: 410 });
}

export async function POST() {
  return NextResponse.json(replacement, { status: 410 });
}
