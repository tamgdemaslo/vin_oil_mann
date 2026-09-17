#!/usr/bin/env node

import assert from "node:assert/strict";
import { resolve } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, alias: { "@": resolve(process.cwd(), "src") } });
const { catalogCandidateTake, exactPartNumberMatchedFields, looksLikeCatalogPartNumber } = await jiti.import("../src/lib/catalog-search.ts");

assert.equal(catalogCandidateTake(0, 50), undefined);
assert.equal(catalogCandidateTake(1, 50), 1500);
assert.equal(catalogCandidateTake(3, 100), 2000);

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
