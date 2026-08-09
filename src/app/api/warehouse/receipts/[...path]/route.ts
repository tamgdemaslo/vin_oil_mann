import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { readableBranchIds, requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
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
import { parsePriceLabelRequest, preparePriceLabels, recordPriceLabelsGenerated } from "@/lib/price-labels";
import { priceLabelPdfFilename, renderPriceLabelsPdf } from "@/lib/price-label-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ path?: string[] }> };

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

async function receiptFromList(id: string, branchIds: string[]) {
  const list = await listLocalStockDocuments({ type: "receipt", limit: 100, branchIds });
  return list.documents.find((document) => document.id === id) ?? null;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const access = await requireBranchApi({ requireActive: false });
  if (!access.ok) return access.response;

  return runWithBranchApiContext(access.context, async () => {
    const { path = [] } = await params;
    const [id, action, subaction] = path;
    if (!id) return NextResponse.json({ error: "id не указан" }, { status: 400 });

    if (action === "audit") {
      const result = await listReceiptAudit(id, session.user);
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: errorStatus(result) });
      return NextResponse.json({ audit: result.audit });
    }
    if (action || subaction) return NextResponse.json({ error: "Неизвестное действие" }, { status: 404 });

    const receipt = await receiptFromList(id, readableBranchIds(access.context));
    if (!receipt) return NextResponse.json({ error: "Приёмка не найдена" }, { status: 404 });
    return NextResponse.json({ receipt });
  });
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access.response;

  return runWithBranchApiContext(access.context, async () => {
    const { path = [] } = await params;
    const [id, action, subaction] = path;
    if (!id || action || subaction) return NextResponse.json({ error: "Некорректный адрес приёмки" }, { status: 400 });

    const body = await jsonBody(request);
    const result = await updateLocalStockDocument(id, { ...(body as object), type: "receipt" }, session.user);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: errorStatus(result) });
    return NextResponse.json(result.document);
  });
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access.response;

  return runWithBranchApiContext(access.context, async () => {
    const { path = [] } = await params;
    const [id, action] = path;
    if (!id || action) return NextResponse.json({ error: "Некорректный адрес приёмки" }, { status: 400 });

    const body = await jsonBody(request);
    const result = await softDeleteDraftReceipt(id, body as { invoiceAction?: string }, session.user);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: errorStatus(result) });
    return NextResponse.json({ message: result.message });
  });
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
        if (!preview.legalEntity) throw new Error("Для печати не определена организация.");
        const pdf = await renderPriceLabelsPdf(preview.labels, preview.legalEntity);
        await recordPriceLabelsGenerated({ receiptId: id, context: access.context, request: parsed, preview });
        const date = new Date().toISOString().slice(0, 10);
        const filename = priceLabelPdfFilename(preview.receiptNumber, date);
        return new NextResponse(new Uint8Array(pdf), {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `inline; filename="${filename}"`,
            "Cache-Control": "no-store",
          },
        });
      } catch (error) {
        console.error("price label PDF generation failed", error);
        return NextResponse.json({ error: "Не удалось сформировать PDF ценников. Попробуйте ещё раз." }, { status: 500 });
      }
    });
  }

  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access.response;

  return runWithBranchApiContext(access.context, async () => {
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
  });
}
