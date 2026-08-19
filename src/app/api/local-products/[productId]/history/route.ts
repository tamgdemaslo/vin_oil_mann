import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import {
  getProductDocumentHistory,
  PRODUCT_HISTORY_FILTERS,
  type ProductHistoryFilter,
} from "@/lib/product-document-history";

function readDate(value: string | null, endOfDay = false): Date | null {
  if (!value) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`)
    : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  if (!(await getSession())) {
    return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  }
  const branchAccess = await requireBranchApi({ allowAll: true, requireActive: false });
  if (!branchAccess.ok) return branchAccess.response;

  const { productId } = await params;
  if (!productId?.trim()) return NextResponse.json({ error: "productId не указан" }, { status: 400 });

  const search = request.nextUrl.searchParams;
  const typeValue = search.get("type")?.trim() || "all";
  if (!PRODUCT_HISTORY_FILTERS.includes(typeValue as ProductHistoryFilter)) {
    return NextResponse.json({ error: "Неизвестный фильтр истории" }, { status: 400 });
  }
  const dateFromValue = search.get("dateFrom");
  const dateToValue = search.get("dateTo");
  const dateFrom = readDate(dateFromValue);
  const dateTo = readDate(dateToValue, true);
  if (dateFromValue && !dateFrom) return NextResponse.json({ error: "Некорректный dateFrom" }, { status: 400 });
  if (dateToValue && !dateTo) return NextResponse.json({ error: "Некорректный dateTo" }, { status: 400 });
  if (dateFrom && dateTo && dateFrom > dateTo) {
    return NextResponse.json({ error: "dateFrom не может быть позже dateTo" }, { status: 400 });
  }

  const rawLimit = Number(search.get("limit") || 30);
  const limit = Number.isFinite(rawLimit) ? Math.min(50, Math.max(1, Math.trunc(rawLimit))) : 30;
  const context = branchAccess.context;
  const result = await runWithBranchApiContext(context, () => getProductDocumentHistory({
    productId,
    branchContext: {
      mode: context.mode,
      branchId: context.branchId,
      allowedBranchIds: context.mode === "all"
        ? context.branches.map((branch) => branch.id)
        : context.branchId ? [context.branchId] : [],
    },
    filters: {
      type: typeValue as ProductHistoryFilter,
      dateFrom,
      dateTo,
      storeId: search.get("storeId"),
      query: search.get("q"),
    },
    cursor: search.get("cursor"),
    limit,
  }));

  if (!result) return NextResponse.json({ error: "Товар не найден" }, { status: 404 });
  return NextResponse.json(result, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
