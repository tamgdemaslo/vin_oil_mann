import { NextRequest } from "next/server";
import { handleAnalyticsPreviewAction } from "../_shared";

export async function POST(request: NextRequest) {
  return handleAnalyticsPreviewAction(request, "procurement");
}
