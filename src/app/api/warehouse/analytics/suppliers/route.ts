import { NextRequest } from "next/server";
import { handleAnalyticsTable } from "../_shared";

export async function GET(request: NextRequest) {
  return handleAnalyticsTable(request, "suppliers");
}
