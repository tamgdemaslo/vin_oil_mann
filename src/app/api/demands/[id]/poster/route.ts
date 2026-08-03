import { NextRequest, NextResponse } from "next/server";

/** Раньше печать открывалась по API; теперь страница Server Component — перенаправляем на неё (старые закладки и ссылки). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "id не указан" }, { status: 400 });
  }
  const dest = new URL(request.url);
  dest.pathname = `/shipment/${encodeURIComponent(id)}/poster`;
  return NextResponse.redirect(dest);
}
