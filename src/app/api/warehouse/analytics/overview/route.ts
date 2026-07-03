import { NextRequest } from "next/server";
import { handleAnalyticsOverview } from "../_shared";

export async function GET(request: NextRequest) {
  return handleAnalyticsOverview(request);
}
