import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { searchReceiptProducts } from "@/lib/local-inventory-admin";

export async function GET(request: NextRequest) {
  if (!(await getSession())) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const branch = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!branch.ok) return branch.response;

  const search = (request.nextUrl.searchParams.get("search") ?? "").trim();
  if (search.length < 2) return NextResponse.json({ products: [] });
  if (search.length > 256) return NextResponse.json({ error: "Сократите поисковый запрос до 256 символов" }, { status: 400 });
  const limit = request.nextUrl.searchParams.get("limit") === "12" ? 12 : 30;
  const products = await runWithBranchApiContext(branch.context, () =>
    searchReceiptProducts(branch.context.branchId!, search, limit),
  );
  return NextResponse.json({ products });
}
