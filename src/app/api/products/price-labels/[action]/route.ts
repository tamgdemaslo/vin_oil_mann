import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import {
  parseProductPriceLabelRequest,
  prepareProductPriceLabels,
  recordProductPriceLabelsGenerated,
} from "@/lib/price-labels";
import { priceLabelPdfFilename, renderPriceLabelsPdf } from "@/lib/price-label-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ action: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const { action } = await params;
  if (action !== "preview" && action !== "pdf") return NextResponse.json({ error: "Неизвестное действие" }, { status: 404 });

  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access.response;
  const body = await request.json().catch(() => null);
  const parsed = parseProductPriceLabelRequest(body);
  if (!parsed) return NextResponse.json({ error: "Некорректные параметры печати ценников" }, { status: 400 });

  return runWithBranchApiContext(access.context, async () => {
    const preview = await prepareProductPriceLabels(access.context, parsed);
    if (action === "preview") return NextResponse.json(preview);
    if (!preview.ok) {
      return NextResponse.json(
        { ...preview, error: preview.validationErrors[0]?.message || "Невозможно сформировать ценники" },
        { status: 422 }
      );
    }
    try {
      if (!preview.legalEntity) throw new Error("Для печати не определена организация.");
      const pdf = await renderPriceLabelsPdf(preview.labels, preview.legalEntity);
      await recordProductPriceLabelsGenerated({ context: access.context, request: parsed, preview });
      const filename = priceLabelPdfFilename("products", new Date().toISOString().slice(0, 10));
      return new NextResponse(new Uint8Array(pdf), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${filename}"`,
          "Cache-Control": "no-store",
        },
      });
    } catch (error) {
      console.error("product price label PDF generation failed", error);
      return NextResponse.json({ error: "Не удалось сформировать PDF ценников. Попробуйте ещё раз." }, { status: 500 });
    }
  });
}
