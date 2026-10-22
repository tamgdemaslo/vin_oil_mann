import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireBranchApi } from "@/lib/branch-api";
import { prisma } from "@/lib/db";
import { findRosskoArticleDuplicate, lockRosskoArticleCreation, rosskoDuplicateResponse } from "@/lib/rossko-product-duplicate";
import {
  canManageWarehouseMarking,
  createLocalAdminProduct,
  listLocalAdminProducts,
  productPayloadHasMarkingSettings,
} from "@/lib/local-inventory-admin";

function readFilterValues(request: NextRequest, key: string) {
  return request.nextUrl.searchParams
    .getAll(key)
    .map((value) => value.trim())
    .filter(Boolean);
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const branchAccess = await requireBranchApi();
  if (!branchAccess.ok) return branchAccess.response;

  const search = request.nextUrl.searchParams.get("search") ?? "";
  const limit = Math.min(100, parseInt(request.nextUrl.searchParams.get("limit") ?? "30", 10) || 30);
  const offset = Math.max(0, parseInt(request.nextUrl.searchParams.get("offset") ?? "0", 10) || 0);
  const includeArchived = request.nextUrl.searchParams.get("archived") === "1";
  const sort = request.nextUrl.searchParams.get("sort") ?? "";
  const direction = request.nextUrl.searchParams.get("direction") ?? "";
  const brand = readFilterValues(request, "brand");
  const sae = readFilterValues(request, "sae");
  const supplier = readFilterValues(request, "supplier");
  const group = readFilterValues(request, "group");
  const entityType = readFilterValues(request, "entityType");
  const apiSpec = readFilterValues(request, "apiSpec");
  const acea = readFilterValues(request, "acea");
  const ilsac = readFilterValues(request, "ilsac");
  const engineOem = readFilterValues(request, "engineOem");
  const atf = readFilterValues(request, "atf");
  const oemAtf = readFilterValues(request, "oemAtf");
  const packageVolume = readFilterValues(request, "packageVolume");
  const stock = request.nextUrl.searchParams.get("stock") ?? "";
  const storeId = request.nextUrl.searchParams.get("storeId") ?? "";
  const storageCell = request.nextUrl.searchParams.get("storageCell") ?? "";
  const markingProblems =
    request.nextUrl.searchParams.get("markingProblems") === "1" ||
    request.nextUrl.searchParams.get("markingProblems") === "true";

  return NextResponse.json(await listLocalAdminProducts({
    branchId: branchAccess.context.branchId!,
    search,
    limit,
    offset,
    includeArchived,
    sort,
    direction,
    brand,
    sae,
    supplier,
    group,
    entityType,
    apiSpec,
    acea,
    ilsac,
    engineOem,
    atf,
    oemAtf,
    packageVolume,
    stock,
    storeId,
    storageCell,
    markingProblems,
  }));
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const branchAccess = await requireBranchApi();
  if (!branchAccess.ok) return branchAccess.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Неверное тело запроса" }, { status: 400 });
  }

  if (productPayloadHasMarkingSettings(body) && !canManageWarehouseMarking(session.user)) {
    return NextResponse.json({ error: "Недостаточно прав для изменения настроек маркировки" }, { status: 403 });
  }

  const input = body as Parameters<typeof createLocalAdminProduct>[0];
  const branchId = branchAccess.context.branchId!;
  const result = input.rosskoPartNumber?.trim() && input.entityType !== "service"
    ? await prisma.$transaction(async (tx) => {
        const article = input.article?.trim() || input.rosskoPartNumber!.trim();
        const brand = input.brand?.trim() || input.rosskoBrand?.trim() || "";
        await lockRosskoArticleCreation(tx, branchId, article);
        const duplicate = await findRosskoArticleDuplicate(tx, { branchId, article, brand });
        if (duplicate) return rosskoDuplicateResponse(duplicate);
        return createLocalAdminProduct(input, session.user, branchId, { transaction: tx });
      }, { timeout: 20_000 })
    : await createLocalAdminProduct(input, session.user, branchId);
  if (!result.ok) return NextResponse.json(result, { status: "existingProduct" in result ? 409 : 400 });
  return NextResponse.json(result.product);
}
