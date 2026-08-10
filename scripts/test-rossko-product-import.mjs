#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, alias: { "@": resolve(process.cwd(), "src") } });
const {
  extractRosskoOemNumbers,
  extractRosskoOrderLines,
  inferRosskoFilterType,
  normalizeLegalEntityName,
  normalizeRosskoArticle,
  normalizeRosskoBrand,
  preferredRosskoArticle,
  recommendedRosskoRetailCents,
} = await jiti.import("../src/lib/rossko-product-import.ts");

assert.equal(normalizeRosskoBrand("  Mann-Filter "), "MANNFILTER");
assert.equal(normalizeRosskoBrand("Ёлка"), normalizeRosskoBrand("елка"));
assert.equal(normalizeRosskoArticle("W 811/80"), normalizeRosskoArticle("w811-80"));
assert.equal(normalizeRosskoArticle("OC—90"), normalizeRosskoArticle("OC 90"));
assert.equal(normalizeLegalEntityName("ООО «Грин Лайт»"), normalizeLegalEntityName('ООО "ГРИНЛАЙТ"'));

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

const searchPayload = {
  SearchResults: {
    Parts: [
      { brand: "MANN-FILTER", partnumber: "W 811/80", oem: ["15208-65F0A", "1520865F0A"], crossNumbers: { number: ["90915-YZZE1", "15208-65F0A"] } },
      { brand: "OTHER", partnumber: "W 811/80", oem: ["SHOULD-NOT-MATCH"] },
    ],
  },
};
assert.equal(preferredRosskoArticle(searchPayload, "MANN-FILTER", "W81180"), "W 811/80");
assert.deepEqual(extractRosskoOemNumbers(searchPayload, "MANN-FILTER", "W81180"), ["1520865F0A", "90915YZZE1"]);

assert.deepEqual(inferRosskoFilterType("Фильтр салона угольный"), { type: "cabin", confidence: "high" });
assert.deepEqual(inferRosskoFilterType("Air filter panel"), { type: "air", confidence: "high" });
assert.deepEqual(inferRosskoFilterType("Diesel fuel filter"), { type: "fuel", confidence: "high" });
assert.deepEqual(inferRosskoFilterType("Фильтр масляный"), { type: "oil", confidence: "high" });
assert.deepEqual(inferRosskoFilterType("Комплект деталей"), { type: "other", confidence: "low" });

const [service, executeRoute, previewRoute] = await Promise.all([
  readFile("src/lib/rossko-product-import.ts", "utf8"),
  readFile("src/app/api/products/rossko/import/execute/route.ts", "utf8"),
  readFile("src/app/api/products/rossko/import/preview/route.ts", "utf8"),
]);
assert.match(service, /supplierCounterpartyId:\s*supplier\.id/);
assert.match(service, /minimumBalance:\s*0/);
assert.match(service, /origin:\s*"IMPORT"/);
assert.match(service, /PRODUCTS_IMPORTED_FROM_ROSSKO_ORDER/);
assert.match(service, /branch_id\s*=\s*\$\{branchId\}/);
assert.doesNotMatch(service, /stockBalance\.(?:create|update|upsert)/i);
assert.doesNotMatch(service, /inventory(?:Document|Movement|Receipt)\.(?:create|update|upsert)/i);
assert.match(executeRoute, /requireBranchApi/);
assert.match(previewRoute, /requireBranchApi/);

console.log("ROSSKO order product import contract — passed");
