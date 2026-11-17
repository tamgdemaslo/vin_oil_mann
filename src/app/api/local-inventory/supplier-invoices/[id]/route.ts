import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { deleteLocalSupplierInvoice, editLocalSupplierInvoice, updateLocalSupplierInvoiceStatus } from "@/lib/local-inventory-admin";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access.response;

  let body: { status?: string; number?: string; invoiceDate?: string; dueDate?: string; comment?: string } | null;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Неверное тело запроса" }, { status: 400 });
  }

  return runWithBranchApiContext(access.context, async () => {
    const { id } = await params;
    if (typeof body?.status !== "string") {
      if (!["owner", "admin"].includes(access.context.user.role)) {
        return NextResponse.json({ error: "Недостаточно прав для редактирования счёта." }, { status: 403 });
      }
      if (!body || typeof body.number !== "string" || typeof body.invoiceDate !== "string" ||
          typeof body.dueDate !== "string" || typeof body.comment !== "string") {
        return NextResponse.json({ error: "Укажите реквизиты счёта." }, { status: 400 });
      }
      try {
        return NextResponse.json(await editLocalSupplierInvoice(id, {
          number: body.number, invoiceDate: body.invoiceDate, dueDate: body.dueDate, comment: body.comment,
        }));
      } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось сохранить счёт." }, { status: 400 });
      }
    }
    const result = await updateLocalSupplierInvoiceStatus(id, body.status, session.user);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: "notFound" in result && result.notFound ? 404 : 400 });
    }
    return NextResponse.json(result.invoice);
  });
}


export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access.response;
  if (!["owner", "admin"].includes(access.context.user.role)) {
    return NextResponse.json({ error: "Недостаточно прав для удаления счёта." }, { status: 403 });
  }
  return runWithBranchApiContext(access.context, async () => {
    try {
      const { id } = await params;
      await deleteLocalSupplierInvoice(id, access.context.user);
      return new NextResponse(null, { status: 204 });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось удалить счёт." }, { status: 400 });
    }
  });
}
