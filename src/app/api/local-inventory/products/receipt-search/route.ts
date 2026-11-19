import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { searchReceiptProducts, type ReceiptSearchTiming } from "@/lib/local-inventory-admin";

export async function GET(request: NextRequest) {
  const started = performance.now();
  const timing: ReceiptSearchTiming = {};
  const limit = request.nextUrl.searchParams.get("limit") === "12" ? 12 : 30;
  let resultCount: number | undefined;
  const requestId = crypto.randomUUID();

  function finish(response: NextResponse) {
    const totalMs = Math.round(performance.now() - started);
    response.headers.set("X-Receipt-Search-Request-Id", requestId);
    console.info("[receipt-search]", JSON.stringify({
      requestId, status: response.status, limit, resultCount, totalMs, ...timing,
    }));
    return response;
  }

  try {
    if (!(await getSession())) return finish(NextResponse.json({ error: "Необходима авторизация" }, { status: 401 }));
    const branch = await requireBranchApi({ allowAll: false, requireActive: true });
    if (!branch.ok) return finish(branch.response);

    const search = (request.nextUrl.searchParams.get("search") ?? "").trim();
    if (search.length < 2) return finish(NextResponse.json({ products: [] }));
    if (search.length > 256) {
      return finish(NextResponse.json({ error: "Сократите поисковый запрос до 256 символов" }, { status: 400 }));
    }
    const products = await runWithBranchApiContext(branch.context, () =>
      searchReceiptProducts(branch.context.branchId!, search, limit, timing),
    );
    resultCount = products.length;
    return finish(NextResponse.json({ products }));
  } catch {
    return finish(NextResponse.json({ error: "Не удалось загрузить товары. Повторите поиск." }, { status: 500 }));
  }
}
