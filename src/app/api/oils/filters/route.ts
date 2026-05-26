import { NextResponse } from "next/server";
import { getClientOilFilters } from "@/lib/client-site-api";

export async function GET() {
  return NextResponse.json(await getClientOilFilters());
}
