import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { Prisma } from "@prisma/client";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
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

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Неверное тело запроса" }, { status: 400 });
  }
  const { context } = branchAccess;
  if (productPayloadHasMarkingSettings(body) && !canManageWarehouseMarking(context.user)) {
    return NextResponse.json({ error: "Недостаточно прав для изменения настроек маркировки" }, { status: 403 });
  }

  try {
    const result = await runWithBranchApiContext(context, () =>
      updateLocalAdminProduct(id, body as Parameters<typeof updateLocalAdminProduct>[1], context.user, context.branchId!),
    );
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.notFound ? 404 : 400 });
    }
    return NextResponse.json(result.product);
  } catch (error) {
    const code = error instanceof Prisma.PrismaClientKnownRequestError ? error.code : undefined;
    console.error("[inventory-products] product update failed", { id, code, name: error instanceof Error ? error.name : undefined });
    if (code && ["P2024", "P2028", "P2034"].includes(code)) {
      return NextResponse.json({ error: "Склад сейчас занят. Подождите несколько секунд и повторите сохранение." }, { status: 503 });
    }
    if (code === "P2002") {
      return NextResponse.json({ error: "Товар с такими уникальными данными уже существует. Проверьте артикул и код." }, { status: 409 });
    }
    return NextResponse.json({ error: "Не удалось подтвердить сохранение. Проверьте карточку перед повтором." }, { status: 500 });
  }
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
    return NextResponse.json({ error: result.error }, { status: "notFound" in result && result.notFound ? 404 : 400 });
  }
  return NextResponse.json(result.product);
}
