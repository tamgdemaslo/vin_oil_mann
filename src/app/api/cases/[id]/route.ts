import { NextResponse } from "next/server";
import { getClientSiteData } from "@/lib/client-site-api";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const workCase = (getClientSiteData().CASES ?? []).find((item) => item.id === id);
  if (!workCase) return NextResponse.json({ error: "Кейс не найден." }, { status: 404 });
  return NextResponse.json(workCase);
}
