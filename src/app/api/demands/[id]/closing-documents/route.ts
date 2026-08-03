import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { buildClosingDocumentPayload, issueClosingDocument, type ClosingDocumentType } from "@/lib/closing-documents";

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
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const { id } = await params;
  const type = parseType(request.nextUrl.searchParams.get("type"));
  const payload = await buildClosingDocumentPayload(id, { type });
  if (!payload) return NextResponse.json({ error: "Отгрузка не найдена" }, { status: 404 });
  return NextResponse.json(payload);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const { id } = await params;

  let body: Body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const allowIncomplete = Boolean(body.allowIncomplete && session.user.role === "owner");
  const result = await issueClosingDocument(
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
    session.user,
    { allowIncomplete, newRevision: body.newRevision !== false }
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error, validation: result.validation }, { status: result.validation ? 422 : 403 });
  }

  return NextResponse.json({ ok: true, document: result.document });
}
