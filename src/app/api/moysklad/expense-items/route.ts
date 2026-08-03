import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listCashExpenseItems } from "@/lib/cash-expense-orders";

export const dynamic = "force-dynamic";

function expenseItemMeta(id: string) {
  return { href: `local://cash-expense-item/${id}`, type: "expenseitem", mediaType: "application/json" };
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  }

  try {
    const search = request.nextUrl.searchParams.get("search") ?? "";
    const limit = Math.min(1000, parseInt(request.nextUrl.searchParams.get("limit") ?? "200", 10) || 200);
    const items = await listCashExpenseItems({ search, limit });
    return NextResponse.json({
      expenseItems: items.map((item) => ({
        id: item.id,
        name: item.name,
        meta: item.moyskladHref
          ? { href: item.moyskladHref, type: "expenseitem", mediaType: "application/json" }
          : expenseItemMeta(item.id),
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ошибка загрузки статей расхода";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
