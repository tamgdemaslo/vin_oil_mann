import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { canExportWarehouseAnalytics, canViewWarehouseAnalytics } from "@/lib/warehouse-analytics-access";
import {
  buildWarehouseAnalyticsCsv,
  getWarehouseAnalyticsTable,
  getWarehouseProductAnalytics,
  warehouseAnalyticsParamsFromSearchParams,
  type WarehouseAnalyticsTable,
} from "@/lib/warehouse-product-analytics";

export async function requireWarehouseAnalyticsView() {
  const session = await getSession();
  if (!session) return { response: NextResponse.json({ error: "Необходима авторизация" }, { status: 401 }) };
  if (!(await canViewWarehouseAnalytics(session.user))) {
    return { response: NextResponse.json({ error: "Недостаточно прав для аналитики склада" }, { status: 403 }) };
  }
  return { session };
}

export async function handleAnalyticsOverview(request: NextRequest) {
  const access = await requireWarehouseAnalyticsView();
  if ("response" in access) return access.response;
  const params = warehouseAnalyticsParamsFromSearchParams(request.nextUrl.searchParams);
  return NextResponse.json(await getWarehouseProductAnalytics(params));
}

export async function handleAnalyticsTable(request: NextRequest, table: WarehouseAnalyticsTable) {
  const access = await requireWarehouseAnalyticsView();
  if ("response" in access) return access.response;
  const params = warehouseAnalyticsParamsFromSearchParams(request.nextUrl.searchParams);
  const data = await getWarehouseProductAnalytics(params);
  return NextResponse.json(getWarehouseAnalyticsTable(data, table, params));
}

export async function handleAnalyticsProduct(request: NextRequest, productId: string) {
  const access = await requireWarehouseAnalyticsView();
  if ("response" in access) return access.response;
  const params = { ...warehouseAnalyticsParamsFromSearchParams(request.nextUrl.searchParams), productId };
  const data = await getWarehouseProductAnalytics(params);
  const product =
    data.topProducts.find((row) => row.productId === productId) ??
    data.margins.find((row) => row.productId === productId) ??
    data.deadStock.find((row) => row.productId === productId) ??
    data.neverSold.find((row) => row.productId === productId) ??
    data.stockouts.find((row) => row.productId === productId) ??
    data.abcXyz.rows.find((row) => row.productId === productId) ??
    null;
  if (!product) return NextResponse.json({ error: "Товар не найден" }, { status: 404 });
  return NextResponse.json({ period: data.period, calculatedAt: data.calculatedAt, product });
}

export async function handleAnalyticsExport(request: NextRequest) {
  const access = await requireWarehouseAnalyticsView();
  if ("response" in access) return access.response;
  if (!(await canExportWarehouseAnalytics(access.session.user))) {
    return NextResponse.json({ error: "Недостаточно прав для экспорта аналитики" }, { status: 403 });
  }

  const searchParams = request.nextUrl.searchParams;
  let table = (searchParams.get("table") ?? "top-products") as WarehouseAnalyticsTable;
  let params = warehouseAnalyticsParamsFromSearchParams(searchParams);
  if (request.method === "POST") {
    try {
      const body = (await request.json()) as { table?: WarehouseAnalyticsTable; filters?: Record<string, string> };
      table = body.table ?? table;
      const bodyParams = new URLSearchParams(body.filters ?? {});
      params = { ...params, ...warehouseAnalyticsParamsFromSearchParams(bodyParams) };
    } catch {
      return NextResponse.json({ error: "Неверное тело запроса" }, { status: 400 });
    }
  }

  const data = await getWarehouseProductAnalytics(params);
  const csv = buildWarehouseAnalyticsCsv(data, table);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="warehouse-${table}-${data.period.dateFrom}-${data.period.dateTo}.csv"`,
    },
  });
}

export async function handleAnalyticsPreviewAction(request: NextRequest, action: "min-stock" | "procurement") {
  const access = await requireWarehouseAnalyticsView();
  if ("response" in access) return access.response;
  const params = warehouseAnalyticsParamsFromSearchParams(request.nextUrl.searchParams);
  const data = await getWarehouseProductAnalytics(params);
  const body = await request.json().catch(() => ({} as { productIds?: string[] }));
  const ids = Array.isArray(body.productIds) ? new Set(body.productIds.map(String)) : null;
  const rows = (action === "min-stock" ? data.replenishment : data.stockouts)
    .filter((row) => !ids || ids.has(row.productId))
    .slice(0, 100);

  return NextResponse.json({
    ok: true,
    mode: "preview",
    action,
    message:
      action === "min-stock"
        ? "Автоматическое изменение минимальных остатков не выполнено. Вернули preview для подтверждения будущего массового действия."
        : "Закупочный документ не создан автоматически. Вернули preview позиций для добавления в закупку.",
    rows,
  });
}
