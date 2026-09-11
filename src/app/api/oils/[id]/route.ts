import { NextResponse } from "next/server";
import { getClientOilById } from "@/lib/client-site-api";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const oil = await getClientOilById(id);
    if (!oil) return NextResponse.json({ error: "Масло не найдено." }, { status: 404, headers: { "Cache-Control": "no-store" } });
    return NextResponse.json(oil, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[oils/id]", error);
    return NextResponse.json({ error: "Карточка масла временно недоступна." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
