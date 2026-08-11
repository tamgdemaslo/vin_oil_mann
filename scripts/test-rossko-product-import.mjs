#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, alias: { "@": resolve(process.cwd(), "src") } });
const {
  extractRosskoOrderLines,
  inferRosskoFilterType,
  normalizeRosskoArticle,
  normalizeRosskoBrand,
  recommendedRosskoRetailCents,
} = await jiti.import("../src/lib/rossko-product-import.ts");
const { buildRosskoOemQuery } = await jiti.import("../src/lib/product-oem-rossko.ts");

assert.equal(normalizeRosskoBrand("  Mann-Filter "), "MANNFILTER");
assert.equal(normalizeRosskoBrand("Ёлка"), normalizeRosskoBrand("елка"));
assert.equal(normalizeRosskoArticle("W 811/80"), normalizeRosskoArticle("w811-80"));
assert.equal(normalizeRosskoArticle("OC—90"), normalizeRosskoArticle("OC 90"));
assert.equal(buildRosskoOemQuery({ article: "W 811/80", oem: "1520865F0A" }), "W 811/80");

assert.equal(recommendedRosskoRetailCents(60_000), 100_000);
assert.equal(recommendedRosskoRetailCents(100_000), 140_000);
assert.equal(recommendedRosskoRetailCents(100_001), 150_002);
assert.equal(recommendedRosskoRetailCents(150_000), 225_000);
assert.equal(recommendedRosskoRetailCents(null), null);

const orderPayload = {
  Orders: {
    Order: [{
      id: 123456,
      Parts: {
        Part: [
          { brand: "MANN-FILTER", partnumber: "W81180", name: "Фильтр масляный", count: 2, price: "612,40", delivery: "11.08", stock: "01" },
          { brand: "Filtron", partnumber: "AP 139/2", name: "Фильтр воздушный", count: 1, price: 842.5, category: "Воздушные фильтры" },
        ],
      },
    }],
  },
};
const lines = extractRosskoOrderLines(orderPayload, "123456");
assert.equal(lines.length, 2);
assert.deepEqual(
  lines.map(({ brand, article, quantity, purchasePriceCents }) => ({ brand, article, quantity, purchasePriceCents })),
  [
    { brand: "MANN-FILTER", article: "W81180", quantity: 2, purchasePriceCents: 61_240 },
    { brand: "Filtron", article: "AP 139/2", quantity: 1, purchasePriceCents: 84_250 },
  ],
);
assert.equal(new Set(lines.map((line) => line.rowId)).size, 2);
assert.equal(extractRosskoOrderLines(orderPayload, "123456")[0]?.rowId, lines[0]?.rowId);

assert.deepEqual(inferRosskoFilterType("Фильтр салона угольный"), { type: "cabin", confidence: "high" });
assert.deepEqual(inferRosskoFilterType("Air filter panel"), { type: "air", confidence: "high" });
assert.deepEqual(inferRosskoFilterType("Diesel fuel filter"), { type: "fuel", confidence: "high" });
assert.deepEqual(inferRosskoFilterType("Фильтр масляный"), { type: "oil", confidence: "high" });
assert.deepEqual(inferRosskoFilterType("Комплект деталей"), { type: "other", confidence: "low" });

const [service, inventoryService, oemService, batchService, executeRoute, previewRoute, manualOemRoute, dialog, supplierPicker, schema] = await Promise.all([
  readFile("src/lib/rossko-product-import.ts", "utf8"),
  readFile("src/lib/local-inventory-admin.ts", "utf8"),
  readFile("src/lib/product-oem-rossko.ts", "utf8"),
  readFile("src/lib/product-oem-batches.ts", "utf8"),
  readFile("src/app/api/products/rossko/import/execute/route.ts", "utf8"),
  readFile("src/app/api/products/rossko/import/preview/route.ts", "utf8"),
  readFile("src/app/api/products/rossko/oem-preview/route.ts", "utf8"),
  readFile("src/components/products/RosskoProductImportDialog.tsx", "utf8"),
  readFile("src/components/products/ProductSupplierPicker.tsx", "utf8"),
  readFile("prisma/schema.prisma", "utf8"),
]);
assert.doesNotMatch(service, /rosskoSearch/);
assert.doesNotMatch(service, /const payload[\s\S]*?oemParts:\s*/);
assert.doesNotMatch(service, /GreenLight|Грин Лайт/);
assert.match(service, /supplierCounterpartyId:\s*supplier\?\.id/);
assert.match(service, /id:\s*\{\s*in:\s*supplierIds\s*\}/);
assert.match(service, /supplierCounterpartyIdentityWhere/);
assert.match(inventoryService, /companyType:\s*\{\s*equals:\s*"supplier"/);
assert.match(inventoryService, /counterpartyTypeName:\s*\{\s*contains:\s*"поставщик"/);
assert.match(inventoryService, /resolveProductSupplierCounterparty[\s\S]*supplierCounterpartyIdentityWhere/);
assert.match(service, /minimumBalance:\s*0/);
assert.match(service, /origin:\s*"IMPORT"/);
assert.match(service, /PRODUCTS_IMPORTED_FROM_ROSSKO_ORDER/);
assert.match(service, /branch_id\s*=\s*\$\{branchId\}/);
assert.match(service, /const ROSSKO_IMPORT_CONCURRENCY\s*=\s*1/);
assert.match(service, /mapWithConcurrency\(selected,\s*ROSSKO_IMPORT_CONCURRENCY/);
assert.match(service, /pg_advisory_xact_lock[\s\S]*?::text\s+AS\s+locked/);
assert.doesNotMatch(service, /stockBalance\.(?:create|update|upsert)/i);
assert.doesNotMatch(service, /inventory(?:Document|Movement|Receipt)\.(?:create|update|upsert)/i);
assert.match(executeRoute, /requireBranchApi/);
assert.match(previewRoute, /requireBranchApi/);
assert.match(oemService, /fillProductOemFromRossko/);
assert.match(oemService, /mergeProductCrossReferences/);
assert.match(oemService, /SKIPPED_ALREADY_FILLED/);
assert.match(manualOemRoute, /searchRosskoOemCandidates/);
assert.match(batchService, /fillProductOemFromRossko/);
assert.match(batchService, /processedItems/);
assert.match(batchService, /NO_RESULTS/);
assert.match(batchService, /ERROR/);
assert.match(batchService, /PRODUCT_OEM_BATCH_RETRYABLE_ITEM_STATUSES/);
assert.match(batchService, /create:\s*productIds\.map\(\(productId\)\s*=>\s*\(\{\s*productId\s*\}\)\)/);
assert.doesNotMatch(batchService, /create:\s*productIds\.map\(\(productId\)\s*=>\s*\(\{[^}]*branchId:/);
assert.match(dialog, /После импорта/);
assert.match(dialog, /supplierCounterpartyId/);
assert.match(dialog, /Заполнить OEM для/);
assert.match(supplierPicker, /\/api\/suppliers\?/);
assert.match(supplierPicker, /\/api\/suppliers\/quick-create/);
assert.match(schema, /model ProductOemBatch/);
assert.match(schema, /model ProductOemBatchItem/);

console.log("ROSSKO order product import contract — passed");
