import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireBranchApi } from "@/lib/branch-api";
import { updateLocalAdminProduct } from "@/lib/local-inventory-admin";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const branchAccess = await requireBranchApi();
  if (!branchAccess.ok) return branchAccess.response;
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id не указан" }, { status: 400 });

  let body: { supplierCounterpartyId?: string | null };
  try {
    body = await request.json() as { supplierCounterpartyId?: string | null };
  } catch {
    return NextResponse.json({ error: "Неверное тело запроса" }, { status: 400 });
  }
  if (!("supplierCounterpartyId" in body) || (body.supplierCounterpartyId !== null && typeof body.supplierCounterpartyId !== "string")) {
    return NextResponse.json({ error: "supplierCounterpartyId должен быть строкой или null" }, { status: 400 });
  }
  const result = await updateLocalAdminProduct(id, { supplierCounterpartyId: body.supplierCounterpartyId }, session.user, branchAccess.context.branchId!);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: "notFound" in result && result.notFound ? 404 : 400 });
  return NextResponse.json(result.product);
}
