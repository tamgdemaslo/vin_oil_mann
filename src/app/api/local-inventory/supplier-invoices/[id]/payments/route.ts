import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { correctSupplierCashPayment, createLocalSupplierInvoicePayment } from "@/lib/local-inventory-admin";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Неверное тело запроса" }, { status: 400 });
  }

  return runWithBranchApiContext(access.context, async () => {
    const { id } = await params;
    const result = await createLocalSupplierInvoicePayment(
      id,
      body as Parameters<typeof createLocalSupplierInvoicePayment>[1],
      session.user
    );
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, cashShiftClosed: "cashShiftClosed" in result ? result.cashShiftClosed : false },
        { status: "notFound" in result && result.notFound ? 404 : 400 }
      );
    }
    return NextResponse.json(result.invoice);
  });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access.response;
  if (!["owner", "admin"].includes(access.context.user.role)) {
    return NextResponse.json({ error: "Недостаточно прав для изменения оплаты." }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  if (typeof body?.paymentId !== "string" || typeof body?.paymentType !== "string") {
    return NextResponse.json({ error: "Укажите оплату и новый способ оплаты." }, { status: 400 });
  }
  return runWithBranchApiContext(access.context, async () => {
    try {
      const { id } = await params;
      return NextResponse.json(await correctSupplierCashPayment(id, body.paymentId, body.paymentType, access.context.user));
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось исправить оплату." }, { status: 400 });
    }
  });
}
