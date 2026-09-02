import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { searchCatalog, type CatalogSearchParams } from "@/lib/catalog-search";

function readValues(request: NextRequest, key: string) {
  return request.nextUrl.searchParams
    .getAll(key)
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const branch = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!branch.ok) return branch.response;

  const sp = request.nextUrl.searchParams;
  const params: CatalogSearchParams = {
    q: sp.get("q") ?? sp.get("search") ?? "",
    context: sp.get("context") === "shipment" ? "shipment" : "products",
    warehouseId: sp.get("warehouseId") ?? undefined,
    storeId: sp.get("storeId") ?? undefined,
    storeName: sp.get("storeName") ?? undefined,
    storageCell: sp.get("storageCell") ?? undefined,
    type: sp.get("type") === "service" || sp.get("type") === "product" || sp.get("type") === "all" ? (sp.get("type") as CatalogSearchParams["type"]) : undefined,
    entityType: sp.get("entityType") ?? undefined,
    categoryId: sp.get("categoryId") ?? undefined,
    brandId: sp.get("brandId") ?? undefined,
    brand: readValues(request, "brand"),
    sae: readValues(request, "sae"),
    supplier: readValues(request, "supplier"),
    group: readValues(request, "group"),
    apiSpec: readValues(request, "apiSpec"),
    acea: readValues(request, "acea"),
    packageVolume: readValues(request, "packageVolume"),
    stock: sp.get("stock") ?? undefined,
    markingProblems: sp.get("markingProblems") === "1" || sp.get("markingProblems") === "true",
    priceMissing: sp.get("priceMissing") === "1" || sp.get("priceMissing") === "true",
    oemParts: sp.get("oemParts") === "filled" || sp.get("oemParts") === "missing"
      ? sp.get("oemParts") as CatalogSearchParams["oemParts"]
      : "all",
    oemBatchId: sp.get("oemBatchId") ?? undefined,
    oemEnrichmentResult: ["remaining", "error", "no_results", "missing_source"].includes(sp.get("oemEnrichmentResult") ?? "")
      ? sp.get("oemEnrichmentResult") as CatalogSearchParams["oemEnrichmentResult"]
      : undefined,
    origin: ["MANUAL", "BRANCH_COPY", "IMPORT", "SYNC"].includes(sp.get("origin") ?? "")
      ? sp.get("origin") ?? undefined
      : undefined,
    copyBatchId: sp.get("copyBatchId") ?? undefined,
    inStock: sp.get("inStock") === "1" || sp.get("inStock") === "true",
    includeArchived: sp.get("archived") === "1" || sp.get("includeArchived") === "1",
    limit: Math.min(100, parseInt(sp.get("limit") ?? "30", 10) || 30),
    offset: Math.max(0, parseInt(sp.get("offset") ?? "0", 10) || 0),
    cursor: sp.get("cursor") ?? undefined,
    sort: sp.get("sort") ?? undefined,
    direction: sp.get("direction") ?? undefined,
    oem: sp.get("oem") ?? undefined,
    mannName: sp.get("mannName") ?? undefined,
    params: sp.get("params") ?? undefined,
    strictNameOem: sp.get("strictNameOem") === "1" || sp.get("strictNameOem") === "true",
  };

  return runWithBranchApiContext(branch.context, async () => NextResponse.json(await searchCatalog(params)));
}
