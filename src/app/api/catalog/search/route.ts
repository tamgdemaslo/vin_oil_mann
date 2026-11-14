import { NextRequest, NextResponse } from "next/server";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { searchCatalog, type CatalogSearchParams } from "@/lib/catalog-search";

function readValues(request: NextRequest, key: string) {
  return request.nextUrl.searchParams
    .getAll(key)
    .map((value) => value.trim())
    .filter(Boolean);
}

export async function GET(request: NextRequest) {
  const startedAt = performance.now();
  const branch = await requireBranchApi({ allowAll: false, requireActive: true });
  const accessMs = performance.now() - startedAt;
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
    ilsac: readValues(request, "ilsac"),
    engineOem: readValues(request, "engineOem"),
    atf: readValues(request, "atf"),
    oemAtf: readValues(request, "oemAtf"),
    packageVolume: readValues(request, "packageVolume"),
    stock: sp.get("stock") ?? undefined,
    markingProblems: sp.get("markingProblems") === "1" || sp.get("markingProblems") === "true",
    articleMissing: sp.get("articleMissing") === "1" || sp.get("articleMissing") === "true",
    priceMissing: sp.get("priceMissing") === "1" || sp.get("priceMissing") === "true",
    qualityIssue: (sp.get("qualityIssue") ?? undefined) as CatalogSearchParams["qualityIssue"],
    publication: ["published", "hidden", "needs_attention"].includes(sp.get("publication") ?? "")
      ? sp.get("publication") as CatalogSearchParams["publication"]
      : "all",
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

  return runWithBranchApiContext(branch.context, async () => {
    const searchStartedAt = performance.now();
    const result = await searchCatalog(params);
    const searchMs = performance.now() - searchStartedAt;
    const response = sp.get("view") === "inventory" && params.context === "products"
      ? NextResponse.json({
          products: result.products,
          meta: result.meta,
          matchedOutsideFilters: result.matchedOutsideFilters,
        })
      : NextResponse.json(result);
    const totalMs = performance.now() - startedAt;
    response.headers.set("Server-Timing", `access;dur=${accessMs.toFixed(1)}, catalog;dur=${searchMs.toFixed(1)}, app;dur=${totalMs.toFixed(1)}`);
    if (totalMs >= 2_000) {
      console.warn("[catalog.search] slow response", {
        branchId: branch.context.branchId,
        context: params.context,
        hasQuery: Boolean(result.normalizedQuery),
        offset: result.meta.offset,
        count: result.products.length,
        accessMs: Math.round(accessMs),
        searchMs: Math.round(searchMs),
        totalMs: Math.round(totalMs),
      });
    }
    return response;
  });
}
