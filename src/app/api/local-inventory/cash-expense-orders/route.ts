import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { cashExpenseOrderToCashout, listCashExpenseOrders, type CashExpenseOrderSource, type CashExpenseOrderStatus, type CashExpensePaymentType } from "@/lib/cash-expense-orders";

const limit = (value: string | null) => Math.min(100, Math.max(1, parseInt(value ?? "50", 10) || 50));
const offset = (value: string | null) => Math.max(0, parseInt(value ?? "0", 10) || 0);
const status = (value: string | null): CashExpenseOrderStatus | "all" => value === "draft" || value === "posted" || value === "cancelled" ? value : "all";
const source = (value: string | null): CashExpenseOrderSource | "all" => value === "local" || value === "sync" || value === "payroll" ? value : "all";
const paymentType = (value: string | null): CashExpensePaymentType | "all" => value === "cash" || value === "card" ? value : "all";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  if (!(await getSession())) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const result = await listCashExpenseOrders({ search: request.nextUrl.searchParams.get("search") ?? "", limit: limit(request.nextUrl.searchParams.get("limit")), offset: offset(request.nextUrl.searchParams.get("offset")), status: status(request.nextUrl.searchParams.get("status")), source: source(request.nextUrl.searchParams.get("source")), paymentType: paymentType(request.nextUrl.searchParams.get("paymentType")) });
  return NextResponse.json({ meta: { size: result.total }, cashouts: result.rows.map(cashExpenseOrderToCashout) });
}
