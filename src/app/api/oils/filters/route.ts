import { NextResponse } from "next/server";
import { getClientOilFilters } from "@/lib/client-site-api";

export async function GET() {
  try {
    return NextResponse.json(await getClientOilFilters(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[oils/filters]", error);
    return NextResponse.json({ error: "Фильтры каталога временно недоступны." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
