import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { canAccessClientCases } from "@/lib/crm-access";
import { parseRosskoOrderNumber } from "@/lib/client-case-parts";
import { setCrmOrderSource } from "@/lib/crm-rossko-orders";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  if (!canAccessClientCases(session.user.role)) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const branch = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!branch.ok) return branch.response;
  const { id } = await params;
  const body = await request.json().catch(() => null);

  return runWithBranchApiContext(branch.context, async () => {
    try {
      if (body?.source === "rossko") {
        const orderNumber = parseRosskoOrderNumber(body.orderNumber);
        if (!orderNumber) return NextResponse.json({ error: "Введите номер заказа ROSSKO цифрами" }, { status: 400 });
        const result = await setCrmOrderSource(id, { source: "rossko", orderNumber }, session.user.login);
        return result ? NextResponse.json({ error: result.error }, { status: result.status }) : NextResponse.json({ ok: true });
      }
      if (body?.source === "manual") {
        const supplier = typeof body.supplier === "string" ? body.supplier.trim() : "";
        if (!supplier || supplier.length > 200) {
          return NextResponse.json({ error: "Укажите название поставщика до 200 символов" }, { status: 400 });
        }
        const expectedAt = typeof body.expectedAt === "string" && body.expectedAt ? new Date(body.expectedAt) : null;
        if (expectedAt && !Number.isFinite(expectedAt.getTime())) {
          return NextResponse.json({ error: "Проверьте ожидаемую дату поставки" }, { status: 400 });
        }
        const result = await setCrmOrderSource(id, { source: "manual", supplier, expectedAt }, session.user.login);
        return result ? NextResponse.json({ error: result.error }, { status: result.status }) : NextResponse.json({ ok: true });
      }
      return NextResponse.json({ error: "Выберите источник заказа" }, { status: 400 });
    } catch (error) {
      console.error("[crm order source]", error);
      return NextResponse.json({ error: "Не удалось сохранить источник заказа" }, { status: 500 });
    }
  });
}
