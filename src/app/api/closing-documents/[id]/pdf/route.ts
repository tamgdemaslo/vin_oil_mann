import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { loadClosingDocument } from "@/lib/closing-documents";
import { renderPagePdf, requestOriginFromHeaders } from "@/lib/pdf-render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function renderKey(): string {
  return process.env.CLOSING_DOCUMENT_RENDER_KEY || process.env.SESSION_SECRET || "";
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const { id } = await params;
  const document = await loadClosingDocument(id);
  if (!document) return NextResponse.json({ error: "Документ не найден" }, { status: 404 });

  const origin = requestOriginFromHeaders(request.headers, request.nextUrl.origin);
  const url = new URL(`/shipment/${encodeURIComponent(document.shipmentId)}/closing`, origin);
  url.searchParams.set("documentId", id);
  url.searchParams.set("pdf", "1");
  if (renderKey()) url.searchParams.set("renderKey", renderKey());

  try {
    const pdf = await renderPagePdf(url.toString(), "[data-closing-document-ready='true']");
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${document.number}.pdf"`,
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
