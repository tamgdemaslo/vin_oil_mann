#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, alias: { "@": resolve(process.cwd(), "src") } });
const { splitProductCrossReferences, hasProductCrossReferences, productCrossReferenceCount } = await jiti.import("../src/lib/product-cross-references.ts");

assert.deepEqual(splitProductCrossReferences(" 15208-65F0A; 1520865F0A ; ; OC 90 "), ["1520865F0A", "OC90"]);
assert.equal(productCrossReferenceCount(" ; , \n "), 0);
assert.equal(hasProductCrossReferences(" ; , \n "), false);
assert.equal(hasProductCrossReferences("OC 90"), true);

const [catalog, catalogRoute, batches, batchRoute, previewRoute, panel, productsClient, schema] = await Promise.all([
  readFile("src/lib/catalog-search.ts", "utf8"),
  readFile("src/app/api/catalog/search/route.ts", "utf8"),
  readFile("src/lib/product-oem-batches.ts", "utf8"),
  readFile("src/app/api/products/oem-batches/route.ts", "utf8"),
  readFile("src/app/api/products/oem-batches/preview/route.ts", "utf8"),
  readFile("src/components/products/ProductOemBatchPanel.tsx", "utf8"),
  readFile("src/app/inventory/products/ProductsClient.tsx", "utf8"),
  readFile("prisma/schema.prisma", "utf8"),
]);

assert.match(catalog, /splitProductCrossReferences\(product\.oemParts\)/);
assert.match(catalog, /filters\.oemParts === "filled" && item\.oemPartsCount === 0/);
assert.match(catalog, /filters\.oemParts === "missing" && item\.oemPartsCount > 0/);
assert.match(catalog, /resolveCatalogProductSelection/);
assert.match(catalog, /oemBatchItems:\s*\{\s*some:/);
assert.match(catalogRoute, /oemParts/);
assert.match(catalogRoute, /oemEnrichmentResult/);

assert.match(batches, /resolveCatalogProductSelection\(input\.selection/);
assert.match(batches, /where:\s*\{\s*branchId,\s*id:\s*\{\s*in:\s*productIds/);
assert.match(batches, /PRODUCT_OEM_BATCH_RETRYABLE_ITEM_STATUSES = \["FAILED", "ERROR"\]/);
assert.match(batches, /MISSING_SOURCE_DATA/);
assert.match(batchRoute, /selection:\s*body\?\.selection/);
assert.doesNotMatch(batchRoute, /branchId:\s*body/);
assert.match(previewRoute, /requireBranchApi/);
assert.match(previewRoute, /previewProductOemBatch/);

assert.match(productsClient, /OEM Parts/);
assert.match(productsClient, /value="missing"|value:\s*"missing"/);
assert.match(productsClient, /Выбрать все \{/);
assert.match(productsClient, /Заполнить OEM Parts из ROSSKO/);
assert.match(productsClient, /selection:\s*allFilteredProductsSelected \? buildCatalogSelectionSnapshot\(\)/);
assert.match(productsClient, /normalizedOemParts\.length\} OEM/);
assert.match(productsClient, /OEM Parts не заполнены/);
assert.match(panel, /Из списка без OEM Parts обработано/);
assert.match(panel, /Показать оставшиеся/);
assert.match(panel, /Повторить ошибки/);

assert.doesNotMatch(schema, /oemEnrichmentResult|oem_enrichment_result/);

console.log("Product OEM catalog bulk enrichment contract — passed");
