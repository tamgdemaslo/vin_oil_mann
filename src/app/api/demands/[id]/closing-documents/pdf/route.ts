import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { renderPagePdf, requestOriginFromHeaders } from "@/lib/pdf-render";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function renderKey(): string {
  return process.env.CLOSING_DOCUMENT_RENDER_KEY || process.env.SESSION_SECRET || "";
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const { id } = await params;
  const demand = await prisma.localDemand.findFirst({ where: { id }, select: { id: true } });
  if (!demand) return NextResponse.json({ error: "Отгрузка не найдена" }, { status: 404 });
  const type = request.nextUrl.searchParams.get("type") || "closing_work_order";
  const bundle = request.nextUrl.searchParams.get("bundle") === "1";
  const origin = requestOriginFromHeaders(request.headers, request.nextUrl.origin);
  const url = new URL(`/shipment/${encodeURIComponent(id)}/closing`, origin);
  for (const [key, value] of request.nextUrl.searchParams.entries()) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("type", type);
  if (bundle) url.searchParams.set("bundle", "1");
  url.searchParams.set("pdf", "1");
  if (renderKey()) url.searchParams.set("renderKey", renderKey());

  try {
    const pdf = await renderPagePdf(url.toString(), "[data-closing-document-ready='true']");
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="closing-${id}-${bundle ? "bundle" : type}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Не удалось сформировать PDF закрывающего документа", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
