import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  void request;
  return NextResponse.json(
    { error: "Branch-addressed T-Bank webhook URL is required" },
    { status: 410 }
  );
}
