import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  cashExpenseOrderToCashout,
  listCashExpenseOrders,
  type CashExpenseOrderSource,
  type CashExpenseOrderStatus,
  type CashExpensePaymentType,
} from "@/lib/cash-expense-orders";

export const dynamic = "force-dynamic";

function parseLimit(value: string | null) {
  return Math.min(100, Math.max(1, parseInt(value ?? "50", 10) || 50));
}

function parseOffset(value: string | null) {
  return Math.max(0, parseInt(value ?? "0", 10) || 0);
}

function parseStatus(value: string | null): CashExpenseOrderStatus | "all" {
  return value === "draft" || value === "posted" || value === "cancelled" ? value : "all";
}

function parseSource(value: string | null): CashExpenseOrderSource | "all" {
  return value === "local" || value === "moysklad_import" || value === "sync" ? value : "all";
}

function parsePaymentType(value: string | null): CashExpensePaymentType | "all" {
  return value === "cash" || value === "card" ? value : "all";
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  }

  try {
    const search = request.nextUrl.searchParams.get("search") ?? "";
    const limit = parseLimit(request.nextUrl.searchParams.get("limit"));
    const offset = parseOffset(request.nextUrl.searchParams.get("offset"));
    const status = parseStatus(request.nextUrl.searchParams.get("status"));
    const source = parseSource(request.nextUrl.searchParams.get("source"));
    const paymentType = parsePaymentType(request.nextUrl.searchParams.get("paymentType"));

    const result = await listCashExpenseOrders({
      search,
      limit,
      offset,
      status,
      source,
      paymentType,
    });

    return NextResponse.json({
      meta: {
        size: result.total,
        limit,
        offset,
        source: "local",
      },
      cashouts: result.rows.map(cashExpenseOrderToCashout),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось загрузить расходные ордера";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
