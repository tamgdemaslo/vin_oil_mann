#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, alias: { "@": resolve(process.cwd(), "src") } });
const { splitProductCrossReferences, hasProductCrossReferences, productCrossReferenceCount } = await jiti.import("../src/lib/product-cross-references.ts");
const { evaluateMannArticleProductMatch, normalizeMannProductBrand, normalizePartArticle } = await jiti.import("../src/lib/mann-catalog.ts");
const {
  buildPartNumberCollisionIndex,
  isSafeCompactKey,
  normalizePartNumberForCrossMatch,
  parseOemParts,
} = await jiti.import("../src/lib/part-number-cross-reference.ts");
const { productIdentityKey, sameExactProductIdentity } = await jiti.import("../src/lib/product-identity.ts");

assert.deepEqual(splitProductCrossReferences(" 15208-65F0A; 1520865F0A ; ; OC 90 "), ["1520865F0A", "OC90"]);
assert.equal(productCrossReferenceCount(" ; , \n "), 0);
assert.equal(hasProductCrossReferences(" ; , \n "), false);
assert.equal(hasProductCrossReferences("OC 90"), true);

assert.deepEqual(
  evaluateMannArticleProductMatch({ article: "W 712/95", name: "Фильтр", brand: "MANN-FILTER" }, "W712/95"),
  { confidence: 100, reason: "Exact MANN product brand + article", matchType: "EXACT_PRODUCT_BRAND_ARTICLE" },
);
assert.deepEqual(
  evaluateMannArticleProductMatch({ code: "HU-719/7-X", name: "Фильтр", brand: "MANN FILTER" }, "HU 719/7 X"),
  { confidence: 99, reason: "Exact MANN product brand + legacy code", matchType: "EXACT_PRODUCT_BRAND_ARTICLE" },
);
assert.deepEqual(normalizePartArticle(" HU 719/7 X. "), { structural: "HU719/7X", compact: "HU7197X" });
assert.deepEqual(normalizePartArticle("HU 719 7 X"), { structural: "HU7197X", compact: "HU7197X" });
assert.equal(normalizeMannProductBrand("MANN-FILTER"), "MANN");
assert.equal(normalizeMannProductBrand("MANNOL"), undefined);
assert.equal(
  evaluateMannArticleProductMatch({ article: "W 712/95", name: "Аналог", brand: "MANNOL" }, "W712/95"),
  null,
  "own article of a different brand is not cross-reference evidence",
);
assert.equal(
  evaluateMannArticleProductMatch({ name: "Фильтр W6720" }, "W67/2"),
  null,
  "a MANN article must not match a longer name token by substring",
);

// 1–3. Exact own article, exact branded OEM and exact article-only OEM.
assert.equal(evaluateMannArticleProductMatch({ brand: "MANN", article: "HU 719/7 X" }, "HU719/7X")?.matchType, "EXACT_PRODUCT_BRAND_ARTICLE");
assert.equal(evaluateMannArticleProductMatch({ oemParts: "MANN: HU 719/7 X" }, "HU719/7X")?.matchType, "OEM_EXACT_BRAND_ARTICLE");
assert.equal(evaluateMannArticleProductMatch({ oemParts: "HU 719/7 X" }, "HU719/7X")?.matchType, "OEM_EXACT_ARTICLE");

// 4–5. All valid analogs survive; a MANN original and non-MANN analogs are peers.
const compatibleFixture = [
  { id: "mann", brand: "MANN", article: "HU 719/7 X", available: 0 },
  { id: "mahle", brand: "MAHLE", article: "OX 188D", oemParts: "MANN HU 719/7 X", available: 5 },
  { id: "filtron", brand: "FILTRON", article: "OE 650/1", oemParts: "HU 719/7 X", available: 0 },
  { id: "hengst", brand: "HENGST", article: "E19H D83", oemParts: "MANN-FILTER: HU 719/7 X", available: 2 },
];
const compatibleIds = compatibleFixture
  .filter((product) => evaluateMannArticleProductMatch(product, "HU 719/7 X"))
  .map((product) => product.id);
assert.deepEqual(compatibleIds, ["mann", "mahle", "filtron", "hengst"]);

// 6–8. Missing, empty and malformed OEM values do not produce matches.
assert.equal(evaluateMannArticleProductMatch({}, "W 712/95"), null);
assert.equal(evaluateMannArticleProductMatch({ oemParts: "" }, "W 712/95"), null);
assert.equal(evaluateMannArticleProductMatch({ oemParts: ";; служебный текст | ???" }, "W 712/95"), null);

// 9–11. Whitespace/dash normalization is safe; slash remains structural.
assert.equal(normalizePartNumberForCrossMatch("  WK –820/1  ").canonical, "WK820/1");
assert.equal(evaluateMannArticleProductMatch({ oemParts: "WK–820/1" }, "WK-820/1")?.matchType, "OEM_EXACT_ARTICLE");
assert.notEqual(normalizePartNumberForCrossMatch("C27161").canonical, normalizePartNumberForCrossMatch("C2716/1").canonical);

// 12–14. Destructive compact collision is blocked; a unique compact key is allowed.
const collisionIndex = buildPartNumberCollisionIndex(["C27161", "C2716/1"]);
assert.equal(isSafeCompactKey(collisionIndex, "C27161"), false);
assert.equal(evaluateMannArticleProductMatch({ oemParts: "C2716/1" }, "C27161", { safeCompactKeys: new Set() }), null);
const safeIndex = buildPartNumberCollisionIndex(["HU 719/7 X"]);
assert.equal(isSafeCompactKey(safeIndex, "HU7197X"), true);
assert.equal(
  evaluateMannArticleProductMatch({ oemParts: "HU7197X" }, "HU 719/7 X", { safeCompactKeys: new Set(["HU7197X"]) })?.matchType,
  "OEM_SAFE_COMPACT",
);

// 15. Substrings never become technical compatibility.
assert.equal(evaluateMannArticleProductMatch({ oemParts: "W 712/950" }, "W 712/95"), null);

// 16–17. Formatting duplicates share product identity; slash-distinct SKUs do not.
const skuBase = { brand: "MANN-FILTER", article: "W 712/95", uomName: "шт", packageVolume: "", volume: "", weight: "" };
assert.equal(sameExactProductIdentity(skuBase, { ...skuBase, brand: "MANN FILTER", article: "W-712/95" }), true);
assert.equal(sameExactProductIdentity({ ...skuBase, article: "C27161" }, { ...skuBase, article: "C2716/1" }), false);
assert.notEqual(productIdentityKey({ ...skuBase, article: "C27161" }), productIdentityKey({ ...skuBase, article: "C2716/1" }));

// 20. Stock may change ranking, never membership in the compatible set.
const rankedIds = compatibleFixture.slice().sort((left, right) => right.available - left.available).map((product) => product.id).sort();
assert.deepEqual(rankedIds, compatibleIds.slice().sort());

assert.deepEqual(
  parseOemParts("MANN HU 719/7 X; MAHLE OX 188D; FILTRON OE 650/1").map(({ brand, canonical }) => [brand, canonical]),
  [["MANN", "HU719/7X"], ["MAHLE", "OX188D"], ["FILTRON", "OE650/1"]],
);

const [catalog, catalogRoute, batches, batchRoute, previewRoute, panel, productsClient, schema, mannCatalog, rosskoImport, localInventory, productCopy, productImport] = await Promise.all([
  readFile("src/lib/catalog-search.ts", "utf8"),
  readFile("src/app/api/catalog/search/route.ts", "utf8"),
  readFile("src/lib/product-oem-batches.ts", "utf8"),
  readFile("src/app/api/products/oem-batches/route.ts", "utf8"),
  readFile("src/app/api/products/oem-batches/preview/route.ts", "utf8"),
  readFile("src/components/products/ProductOemBatchPanel.tsx", "utf8"),
  readFile("src/app/inventory/products/ProductsClient.tsx", "utf8"),
  readFile("prisma/schema.prisma", "utf8"),
  readFile("src/lib/mann-catalog.ts", "utf8"),
  readFile("src/lib/rossko-product-import.ts", "utf8"),
  readFile("src/lib/local-inventory-admin.ts", "utf8"),
  readFile("src/lib/product-copy-between-branches.ts", "utf8"),
  readFile("src/lib/product-import-export.ts", "utf8"),
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
assert.match(mannCatalog, /prisma\.productMannLink\.findMany/);
assert.match(mannCatalog, /ProductMannLink:/);
// 18–19. Runtime retrieval is branch-scoped and excludes archived products.
assert.match(mannCatalog, /WHERE branch_id = \$\{branchId\}/);
assert.match(mannCatalog, /archived = false/);
assert.match(mannCatalog, /compatibleProducts: localMatches/);
assert.doesNotMatch(mannCatalog, /name_normalized.*LIKE|COALESCE\(name/);

// Creation/import paths use structural product identity instead of compact article as sole proof.
assert.match(rosskoImport, /normalizeRosskoProductIdentityArticle/);
assert.match(localInventory, /sameExactProductIdentity/);
assert.match(productCopy, /sameExactProductIdentity/);
assert.match(productImport, /sameExactProductIdentity/);

console.log("Product OEM catalog, collision safety and 20-point matcher contract — passed");
