import { NextRequest } from "next/server";
import { handleAnalyticsExport } from "../_shared";

export async function GET(request: NextRequest) {
  return handleAnalyticsExport(request);
}

export async function POST(request: NextRequest) {
  return handleAnalyticsExport(request);
}
