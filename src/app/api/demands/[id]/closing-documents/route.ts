import { NextRequest, NextResponse } from "next/server";
import { requireBranchApi } from "@/lib/branch-api";
import { buildClosingDocumentPayload, issueClosingDocument, type ClosingDocumentType } from "@/lib/closing-documents";
import { resolveShipmentPrintAccess, runWithDocumentPrintAccess } from "@/lib/document-print-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  type?: ClosingDocumentType;
  documentDate?: string;
  completionDate?: string;
  acceptanceText?: string;
  customerRemarks?: string;
  allowIncomplete?: boolean;
  newRevision?: boolean;
  transfer?: Record<string, string>;
  upd?: Record<string, string>;
  sellerSignatory?: Record<string, string>;
  customerSignatory?: Record<string, string>;
};

function parseType(value: string | null | undefined): ClosingDocumentType {
  return value === "work_act" || value === "upd_print" || value === "closing_work_order" ? value : "closing_work_order";
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const branchAccess = await requireBranchApi({ allowAll: true, requireActive: false });
  if (!branchAccess.ok) return branchAccess.response;
  const { id } = await params;
  const printAccess = await resolveShipmentPrintAccess(branchAccess.context, id);
  if (!printAccess) return NextResponse.json({ error: "Отгрузка не найдена или недоступна" }, { status: 404 });
  const type = parseType(request.nextUrl.searchParams.get("type"));
  const payload = await runWithDocumentPrintAccess(printAccess, () => buildClosingDocumentPayload(id, { type }));
  if (!payload) return NextResponse.json({ error: "Отгрузка не найдена" }, { status: 404 });
  return NextResponse.json(payload);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const branchAccess = await requireBranchApi({ allowAll: true, requireActive: false });
  if (!branchAccess.ok) return branchAccess.response;
  const { id } = await params;
  const printAccess = await resolveShipmentPrintAccess(branchAccess.context, id);
  if (!printAccess) return NextResponse.json({ error: "Отгрузка не найдена или недоступна" }, { status: 404 });

  let body: Body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const allowIncomplete = Boolean(body.allowIncomplete && branchAccess.context.user.role === "owner");
  const result = await runWithDocumentPrintAccess(printAccess, () => issueClosingDocument(
    id,
    {
      type: parseType(body.type),
      documentDate: body.documentDate,
      completionDate: body.completionDate,
      acceptanceText: body.acceptanceText,
      customerRemarks: body.customerRemarks,
      transfer: body.transfer,
      upd: body.upd,
      sellerSignatory: body.sellerSignatory,
      customerSignatory: body.customerSignatory,
    },
    branchAccess.context.user,
    { allowIncomplete, newRevision: body.newRevision !== false }
  ));

  if (!result.ok) {
    return NextResponse.json({ error: result.error, validation: result.validation }, { status: result.validation ? 422 : 403 });
  }

  return NextResponse.json({ ok: true, document: result.document });
}
