import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireBranchApi } from "@/lib/branch-api";
import { getLocalAdminCounterparty, updateLocalAdminCounterparty } from "@/lib/local-inventory-admin";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const branchAccess = await requireBranchApi({ requireActive: false });
  if (!branchAccess.ok) return branchAccess.response;
  const { id } = await params;
  const result = await getLocalAdminCounterparty(id, branchAccess.context.branchId!);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 404 });
  return NextResponse.json(result.counterparty);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const branchAccess = await requireBranchApi();
  if (!branchAccess.ok) return branchAccess.response;
  const { id } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Неверное тело запроса" }, { status: 400 });
  }
  const result = await updateLocalAdminCounterparty(id, body as Parameters<typeof updateLocalAdminCounterparty>[1], branchAccess.context.branchId!);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.notFound ? 404 : 400 });
  return NextResponse.json(result.counterparty);
}
