import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  void request;
  return NextResponse.json(
    { ok: false, accepted: false, error: "Branch-addressed Telegram webhook URL is required" },
    { status: 410 }
  );
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    channel: "telegram",
    webhook: "branch_path_required",
    endpoint: "/api/messenger/webhook/telegram/{branchId}",
  });
}
