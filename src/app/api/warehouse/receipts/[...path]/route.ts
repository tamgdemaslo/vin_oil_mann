import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import {
  cancelLocalReceipt,
  checkReceiptRollbackSafety,
  createReceiptCorrection,
  listLocalStockDocuments,
  listReceiptAudit,
  postLocalReceipt,
  softDeleteDraftReceipt,
  unpostLocalReceipt,
  updateLocalStockDocument,
} from "@/lib/local-inventory-admin";
import { parsePriceLabelRequest, preparePriceLabels, recordPriceLabelsGenerated, type PriceLabelPreview } from "@/lib/price-labels";
import { PRICE_LABEL_ARTWORK_CSS } from "@/components/receipts/PriceLabelArtwork";
import { renderHtmlPdf } from "@/lib/pdf-render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ path?: string[] }> };

function escapeHtml(value: string) {
  return value.replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]!);
}

function priceLabelNameFontSize(name: string) {
  const calculated = Math.sqrt(9_000 / Math.max(name.length, 1));
  return `${Math.max(5.5, Math.min(10.4, calculated)).toFixed(2)}pt`;
}

function priceLabelPrice(priceCents: number) {
  const value = priceCents / 100;
  return `${value.toLocaleString("ru-RU", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  })} ₽`;
}

function priceLabelArtworkHtml(label: PriceLabelPreview["labels"][number], legalEntity: NonNullable<PriceLabelPreview["legalEntity"]>) {
  const article = label.article
    ? `<span class="price-label-artwork__article">Арт. ${escapeHtml(label.article)}</span>`
    : "<span></span>";
  return `<section class="price-label-artwork" style="--price-label-name-size: ${priceLabelNameFontSize(label.name)}" aria-label="Ценник ${escapeHtml(label.name)}">
    <header class="price-label-artwork__brand">ТАМ, ГДЕ МАСЛО<span>.</span></header>
    <div class="price-label-artwork__rule" aria-hidden="true"></div>
    <div class="price-label-artwork__main">
      <strong class="price-label-artwork__name">${escapeHtml(label.name)}</strong>
      <div class="price-label-artwork__price-row">${article}<strong class="price-label-artwork__price">${escapeHtml(priceLabelPrice(label.priceCents))}</strong></div>
    </div>
    <footer class="price-label-artwork__legal"><span>${escapeHtml(legalEntity.name)}</span><span>ИНН ${escapeHtml(legalEntity.inn)}</span></footer>
  </section>`;
}

async function jsonBody(request: NextRequest) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function errorStatus(result: { status?: number; notFound?: boolean } | object) {
  if (!("status" in result) && !("notFound" in result)) return 400;
  if (result.status) return result.status;
  if (result.notFound) return 404;
  return 400;
}

function priceLabelsPdfHtml(preview: PriceLabelPreview, origin: string) {
  if (!preview.legalEntity) throw new Error("Price labels require a legal entity");
  const pages = preview.labels.flatMap((label) => Array.from({ length: label.copies }, () => label));
  const markup = `<main id="price-labels-print-mount" data-price-labels-ready="true">${pages.map((label) => `<div class="price-label-print-page">${priceLabelArtworkHtml(label, preview.legalEntity!)}</div>`).join("")}</main>`;
  const fontBase = origin.replace(/\/$/, "");
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Ценники</title><style>
    @font-face { font-family: Inter; font-style: normal; font-weight: 100 900; font-display: block; src: url("${fontBase}/fonts/diagnostic/02-UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa0ZL7W0Q5n-wU.woff2") format("woff2"); unicode-range: U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116; }
    @font-face { font-family: Inter; font-style: normal; font-weight: 100 900; font-display: block; src: url("${fontBase}/fonts/diagnostic/07-UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7W0Q5nw.woff2") format("woff2"); unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+2000-206F, U+20AC, U+20BD, U+2116; }
    ${PRICE_LABEL_ARTWORK_CSS}
    @page { size: 50mm 30mm; margin: 0; }
    html, body { margin: 0; padding: 0; background: #fff; }
    #price-labels-print-mount { display: block; width: 50mm; }
    .price-label-print-page { width: 50mm; height: 30mm; break-after: page; page-break-after: always; overflow: hidden; }
    .price-label-print-page:last-child { break-after: auto; page-break-after: auto; }
  </style></head><body>${markup}</body></html>`;
}

async function receiptFromList(id: string) {
  const list = await listLocalStockDocuments({ type: "receipt", limit: 100 });
  return list.documents.find((document) => document.id === id) ?? null;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  const { path = [] } = await params;
  const [id, action, subaction] = path;
  if (!id) return NextResponse.json({ error: "id не указан" }, { status: 400 });

  if (action === "audit") {
    const result = await listReceiptAudit(id, session.user);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: errorStatus(result) });
    return NextResponse.json({ audit: result.audit });
  }
  if (action || subaction) return NextResponse.json({ error: "Неизвестное действие" }, { status: 404 });

  const receipt = await receiptFromList(id);
  if (!receipt) return NextResponse.json({ error: "Приёмка не найдена" }, { status: 404 });
  return NextResponse.json({ receipt });
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  const { path = [] } = await params;
  const [id, action, subaction] = path;
  if (!id || action || subaction) return NextResponse.json({ error: "Некорректный адрес приёмки" }, { status: 400 });

  const body = await jsonBody(request);
  const result = await updateLocalStockDocument(id, { ...(body as object), type: "receipt" }, session.user);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: errorStatus(result) });
  return NextResponse.json(result.document);
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  const { path = [] } = await params;
  const [id, action] = path;
  if (!id || action) return NextResponse.json({ error: "Некорректный адрес приёмки" }, { status: 400 });

  const body = await jsonBody(request);
  const result = await softDeleteDraftReceipt(id, body as { invoiceAction?: string }, session.user);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: errorStatus(result) });
  return NextResponse.json({ message: result.message });
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  const { path = [] } = await params;
  const [id, action, subaction] = path;
  if (!id || !action) return NextResponse.json({ error: "Действие не указано" }, { status: 400 });
  const body = await jsonBody(request);

  if (action === "price-labels") {
    if (subaction !== "preview" && subaction !== "pdf") {
      return NextResponse.json({ error: "Неизвестное действие" }, { status: 404 });
    }
    const access = await requireBranchApi({ allowAll: false, requireActive: true });
    if (!access.ok) return access.response;
    const parsed = parsePriceLabelRequest(body);
    if (!parsed) return NextResponse.json({ error: "Некорректные параметры печати ценников" }, { status: 400 });

    return runWithBranchApiContext(access.context, async () => {
      const preview = await preparePriceLabels(access.context, id, parsed);
      if (subaction === "preview") return NextResponse.json(preview);
      if (!preview.ok) {
        return NextResponse.json(
          { ...preview, error: preview.validationErrors[0]?.message || "Невозможно сформировать ценники" },
          { status: 422 }
        );
      }
      try {
        const pdf = await renderHtmlPdf(
          priceLabelsPdfHtml(preview, request.nextUrl.origin),
          "[data-price-labels-ready='true']"
        );
        await recordPriceLabelsGenerated({ receiptId: id, context: access.context, request: parsed, preview });
        const date = new Date().toISOString().slice(0, 10);
        const safeReceiptNumber = (preview.receiptNumber || "receipt").replace(/[^A-Za-zА-Яа-яЁё0-9._-]+/g, "-").slice(0, 80);
        return new NextResponse(new Uint8Array(pdf), {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `inline; filename="price-labels-${safeReceiptNumber}-${date}.pdf"`,
            "Cache-Control": "no-store",
          },
        });
      } catch (error) {
        console.error("price label PDF generation failed", error);
        return NextResponse.json({ error: "Не удалось сформировать PDF ценников. Попробуйте ещё раз." }, { status: 500 });
      }
    });
  }

  if (subaction) return NextResponse.json({ error: "Неизвестное действие" }, { status: 404 });

  if (action === "post") {
    const result = await postLocalReceipt(id, session.user);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: errorStatus(result) });
    return NextResponse.json(result);
  }
  if (action === "check-unpost") {
    const result = await checkReceiptRollbackSafety(id, "unpost", session.user);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: errorStatus(result) });
    return NextResponse.json(result);
  }
  if (action === "unpost") {
    const result = await unpostLocalReceipt(id, session.user);
    if (!result.ok) return NextResponse.json(result, { status: errorStatus(result) });
    return NextResponse.json(result);
  }
  if (action === "check-cancel") {
    const result = await checkReceiptRollbackSafety(id, "cancel", session.user);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: errorStatus(result) });
    return NextResponse.json(result);
  }
  if (action === "cancel") {
    const result = await cancelLocalReceipt(id, session.user);
    if (!result.ok) return NextResponse.json(result, { status: errorStatus(result) });
    return NextResponse.json(result);
  }
  if (action === "correction") {
    const result = await createReceiptCorrection(id, body as { reason?: string }, session.user);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: errorStatus(result) });
    return NextResponse.json(result);
  }

  return NextResponse.json({ error: "Неизвестное действие" }, { status: 404 });
}
