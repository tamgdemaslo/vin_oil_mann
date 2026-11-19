import { SAVE_BRANCH_HEADER, SAVE_OPERATION_HEADER, saveTraceId } from "@/lib/save-trace";
import { withSaveTrace } from "@/lib/save-trace-server";
import { lockSaveReceipt } from "@/lib/save-receipt";
import type { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireBranchApi } from "@/lib/branch-api";
import { prisma } from "@/lib/db";
import { findRosskoArticleDuplicate, lockRosskoArticleCreation, rosskoDuplicateResponse } from "@/lib/rossko-product-duplicate";
import {
  canManageWarehouseMarking,
  createLocalAdminProduct,
  getLocalAdminProduct,
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
  return withSaveTrace(request, async (log) => {
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

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Неверное тело запроса" }, { status: 400 });
    }
    const actor = session.user;
    if (productPayloadHasMarkingSettings(body) && !canManageWarehouseMarking(actor)) {
      return NextResponse.json({ error: "Недостаточно прав для изменения настроек маркировки" }, { status: 403 });
    }
    const input = body as Parameters<typeof createLocalAdminProduct>[0];
    const branchId = branchAccess.context.branchId!;
    const expectedBranch = request.headers.get(SAVE_BRANCH_HEADER);
    if (expectedBranch && expectedBranch !== branchId) {
      return NextResponse.json({ error: "Филиал изменился. Проверьте результат в исходном филиале." }, { status: 409 });
    }
    log("authorized");
    const operationId = saveTraceId(request.headers.get(SAVE_OPERATION_HEADER));
    const rossko = input.rosskoPartNumber?.trim() && input.entityType !== "service";
    async function create(tx: Prisma.TransactionClient) {
      if (rossko) {
        const article = input.article?.trim() || input.rosskoPartNumber!.trim();
        const brand = input.brand?.trim() || input.rosskoBrand?.trim() || "";
        await lockRosskoArticleCreation(tx, branchId, article);
        const duplicate = await findRosskoArticleDuplicate(tx, { branchId, article, brand });
        if (duplicate) return rosskoDuplicateResponse(duplicate);
      }
      return createLocalAdminProduct(input, actor, branchId, { transaction: tx });
    }
    let reused = false;
    const result = operationId
      ? await prisma.$transaction(async (tx) => {
          const { id, receipt } = await lockSaveReceipt(tx, ["product", branchId, branchAccess.context.userId], operationId);
          if (receipt?.entityId) {
            reused = true;
            return { ok: true as const, existingId: receipt.entityId };
          }
          const created = await create(tx);
          if (created.ok) await tx.branchAuditLog.create({ data: {
            id, branchId, action: "product.create_receipt", entityType: "local_product", entityId: created.product.id,
          } });
          return created;
        }, { timeout: 20_000 })
      : rossko ? await prisma.$transaction(create, { timeout: 20_000 })
      : await createLocalAdminProduct(input, actor, branchId);
    if (!result.ok) return NextResponse.json(result, { status: "existingProduct" in result ? 409 : 400 });
    log(reused ? "reused" : "committed");
    if ("existingId" in result) {
      const product = await getLocalAdminProduct(result.existingId, branchId);
      return product ? NextResponse.json(product) : NextResponse.json({ error: "Операция уже выполнена. Карточка недоступна." }, { status: 409 });
    }
    return NextResponse.json(result.product);
  });
}
