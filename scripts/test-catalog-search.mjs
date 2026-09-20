#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, alias: { "@": resolve(process.cwd(), "src") } });
const { catalogCandidateTake, catalogItemMatchesQualityIssue, exactPartNumberMatchedFields, looksLikeCatalogPartNumber, normalizeCatalogQualityIssue } = await jiti.import("../src/lib/catalog-search.ts");

assert.equal(catalogCandidateTake(0, 50), undefined);
assert.equal(catalogCandidateTake(1, 50), 1500);
assert.equal(catalogCandidateTake(3, 100), 2000);
assert.equal(normalizeCatalogQualityIssue("negative_stock"), "negative_stock");
assert.equal(normalizeCatalogQualityIssue("unknown"), "all");

const qualityFixture = {
  name: "Товар  с пробелом",
  article: "",
  code: "",
  externalCode: "",
  barcodeEan13: "",
  barcodeEan8: "",
  barcodeCode128: "",
  brand: "",
  groupPath: "Фильтры",
  supplierName: "",
  salePrice: 0,
  priceNeedsSetup: true,
  totalQuantity: -1,
  totalAvailable: -1,
  oemPartsCount: 0,
  storageAssignments: [],
};
assert.equal(catalogItemMatchesQualityIssue(qualityFixture, "missing_oem"), true);
assert.equal(catalogItemMatchesQualityIssue(qualityFixture, "missing_brand"), true);
assert.equal(catalogItemMatchesQualityIssue(qualityFixture, "missing_group"), false);
assert.equal(catalogItemMatchesQualityIssue(qualityFixture, "missing_identifier"), true);
assert.equal(catalogItemMatchesQualityIssue(qualityFixture, "missing_supplier"), true);
assert.equal(catalogItemMatchesQualityIssue(qualityFixture, "missing_price"), true);
assert.equal(catalogItemMatchesQualityIssue(qualityFixture, "negative_stock"), true);
assert.equal(catalogItemMatchesQualityIssue(qualityFixture, "missing_cell", "store-1"), true);
assert.equal(catalogItemMatchesQualityIssue(qualityFixture, "name_review"), true);

const productsClientSource = readFileSync(resolve(process.cwd(), "src/app/inventory/products/ProductsClient.tsx"), "utf8");
assert.match(productsClientSource, /const nextOffset = meta\.offset \+ meta\.limit/u, "load more must use the server page offset");
assert.match(productsClientSource, /addEventListener\("scroll", scheduleCheck, true\)/u, "nested scroll containers must trigger the load-more fallback");

assert.equal(looksLikeCatalogPartNumber("HU 925/4 X"), true);
assert.equal(looksLikeCatalogPartNumber("11427512300"), true);
assert.equal(looksLikeCatalogPartNumber("масляный фильтр"), false);
assert.equal(looksLikeCatalogPartNumber("масло 5W-40"), false);
assert.equal(looksLikeCatalogPartNumber("5W-40"), false);

const exactFixture = {
  article: "HU 7025 Z",
  code: null,
  externalCode: null,
  barcodeEan13: null,
  barcodeEan8: null,
  barcodeCode128: null,
  rosskoPartNumber: null,
  oem: null,
  oemAtf: null,
  oemParts: "MANN HU 925/4 X; MAHLE OX 188D",
};
assert.deepEqual(exactPartNumberMatchedFields(exactFixture, "HU-925/4-X").map((field) => field.field), ["oemParts"]);
assert.equal(exactPartNumberMatchedFields(exactFixture, "HU 925/4").length, 0);
assert.equal(exactPartNumberMatchedFields(exactFixture, "HU 925 4X", { allowCompact: true })[0]?.match, "compact");
assert.equal(exactPartNumberMatchedFields(exactFixture, "HU 7025 Z")[0]?.field, "article");

console.log("Catalog search pagination and strict identifier contract — passed");
