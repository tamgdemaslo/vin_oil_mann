import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listCashExpenseItems } from "@/lib/cash-expense-orders";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  if (!(await getSession())) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const rows = await listCashExpenseItems({ search: request.nextUrl.searchParams.get("search") ?? "", limit: Math.min(1000, parseInt(request.nextUrl.searchParams.get("limit") ?? "200", 10) || 200) });
  return NextResponse.json({ expenseItems: rows.map((row) => ({ id: row.id, name: row.name, meta: { href: `local://cash-expense-item/${row.id}`, type: "expenseitem", mediaType: "application/json" } })) });
}
