import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireBranchApi } from "@/lib/branch-api";
import {
  canManageWarehouseMarking,
  getLocalAdminProduct,
  productPayloadHasMarkingSettings,
  updateLocalAdminProduct,
} from "@/lib/local-inventory-admin";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const branchAccess = await requireBranchApi({ requireActive: false });
  if (!branchAccess.ok) return branchAccess.response;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id не указан" }, { status: 400 });

  const product = await getLocalAdminProduct(id, branchAccess.context.branchId!);
  if (!product) return NextResponse.json({ error: "Товар не найден" }, { status: 404 });
  return NextResponse.json(product);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const branchAccess = await requireBranchApi();
  if (!branchAccess.ok) return branchAccess.response;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id не указан" }, { status: 400 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Неверное тело запроса" }, { status: 400 });
  }

  if (productPayloadHasMarkingSettings(body) && !canManageWarehouseMarking(session.user)) {
    return NextResponse.json({ error: "Недостаточно прав для изменения настроек маркировки" }, { status: 403 });
  }

  const result = await updateLocalAdminProduct(id, body as Parameters<typeof updateLocalAdminProduct>[1], session.user, branchAccess.context.branchId!);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.notFound ? 404 : 400 });
  }
  return NextResponse.json(result.product);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const branchAccess = await requireBranchApi();
  if (!branchAccess.ok) return branchAccess.response;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id не указан" }, { status: 400 });

  const result = await updateLocalAdminProduct(id, { archived: true }, session.user, branchAccess.context.branchId!);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.notFound ? 404 : 400 });
  }
  return NextResponse.json(result.product);
}
