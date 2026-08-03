import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  createLocalSupplierInvoiceForReceipt,
  listLocalSupplierInvoices,
} from "@/lib/local-inventory-admin";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  const search = request.nextUrl.searchParams.get("search") ?? "";
  const status = request.nextUrl.searchParams.get("status") ?? "";
  const supplier = request.nextUrl.searchParams.get("supplier") ?? "";
  const dateFrom = request.nextUrl.searchParams.get("dateFrom") ?? "";
  const dateTo = request.nextUrl.searchParams.get("dateTo") ?? "";
  const minAmountRaw = request.nextUrl.searchParams.get("minAmount") ?? "";
  const maxAmountRaw = request.nextUrl.searchParams.get("maxAmount") ?? "";
  const document = request.nextUrl.searchParams.get("document") ?? "";
  const withoutReceipt = request.nextUrl.searchParams.get("withoutReceipt") === "1";
  const overdueOnly = request.nextUrl.searchParams.get("overdueOnly") === "1";
  const source = request.nextUrl.searchParams.get("source") ?? "";
  const sortBy = request.nextUrl.searchParams.get("sortBy") ?? "";
  const sortDir = request.nextUrl.searchParams.get("sortDir") ?? "";
  const limit = Math.min(100, parseInt(request.nextUrl.searchParams.get("limit") ?? "50", 10) || 50);
  const offset = Math.max(0, parseInt(request.nextUrl.searchParams.get("offset") ?? "0", 10) || 0);

  return NextResponse.json(await listLocalSupplierInvoices({
    search,
    status,
    supplier,
    dateFrom,
    dateTo,
    minAmount: minAmountRaw ? Number(minAmountRaw) : undefined,
    maxAmount: maxAmountRaw ? Number(maxAmountRaw) : undefined,
    document,
    withoutReceipt,
    overdueOnly,
    source,
    sortBy,
    sortDir,
    limit,
    offset,
  }));
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Неверное тело запроса" }, { status: 400 });
  }

  const result = await createLocalSupplierInvoiceForReceipt(
    body as Parameters<typeof createLocalSupplierInvoiceForReceipt>[0],
    session.user
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.notFound ? 404 : 400 });
  }
  return NextResponse.json(result.invoice);
}
