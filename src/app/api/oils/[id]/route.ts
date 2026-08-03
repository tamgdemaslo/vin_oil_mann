import { NextResponse } from "next/server";
import { getClientOilById } from "@/lib/client-site-api";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const oil = await getClientOilById(id);
  if (!oil) return NextResponse.json({ error: "Масло не найдено." }, { status: 404 });
  return NextResponse.json(oil);
}
