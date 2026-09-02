#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url, { alias: { "@": resolve(root, "src") } });
const values = await jiti.import("../src/lib/product-attribute-values.ts");
const oil = await jiti.import("../src/lib/oil-normalizer.ts");
const profiles = await jiti.import("../src/lib/product-fluid-profile.ts");

const fixtureRoot = fs.mkdtempSync(resolve(os.tmpdir(), "product-attributes-"));
const fixtureSource = resolve(fixtureRoot, "source");
const fixtureOutput = resolve(fixtureRoot, "generated.json");
const fixtureReport = resolve(fixtureRoot, "report.json");
const fixtureMarkdown = resolve(fixtureRoot, "report.md");
fs.mkdirSync(fixtureSource);
const fixtureXml = {
  "brands.xml": ["BrandValues", "Brand", ["Bardahl", "bardahl", "Liqui &amp; Moly", ""]],
  "engine-sae.xml": ["SAEValues", "SAE", ["5w30", "5W-40"]],
  "package-volumes.xml": ["VolumeValues", "Volume", ["4 L", "4,5 л"]],
  "acea.xml": ["ACEAValues", "ACEA", ["С3", "A3/B4"]],
  "engine-api.xml": ["APIValues", "API", ["SN", "SN/CF", "GF-6", "GL-4/GL-5", "TEST A", "TEST-A"]],
  "engine-oem.xml": ["OEMOilValues", "OEMOil", ["ILSAC GF-6A", "BMW Longlife-04", "MB 229.51", "VW 504.00/507.00"]],
  "transmission-sae.xml": ["SAEValues", "SAE", ["75w90"]],
  "atf.xml": ["ATFValues", "ATF", ["Dexron III", "Dexron VI", "Type WS"]],
  "transmission-api.xml": ["APIValues", "API", ["GL-4", "GL-4/GL-5"]],
  "transmission-oem.xml": ["OEMOilValues", "OEMOil", ["Aisin JWS 3309", "MB 236.14", "ZF TE-ML 11"]],
};

const writeFixture = (fileName, rootTag, itemTag, items) => {
  const body = items.map((item) => `<${itemTag}>${item}</${itemTag}>`).join("");
  fs.writeFileSync(resolve(fixtureSource, fileName), `<?xml version="1.0" encoding="UTF-8"?><${rootTag}>${body}</${rootTag}>\n`);
};

const generatorArguments = [
  resolve(root, "scripts/generate-product-attribute-dictionaries.mjs"),
  `--source-dir=${fixtureSource}`,
  `--output=${fixtureOutput}`,
  `--report-json=${fixtureReport}`,
  `--report-md=${fixtureMarkdown}`,
];

try {
  for (const [fileName, [rootTag, itemTag, items]] of Object.entries(fixtureXml)) writeFixture(fileName, rootTag, itemTag, items);
  const firstGeneration = spawnSync(process.execPath, generatorArguments, { encoding: "utf8" });
  assert.equal(firstGeneration.status, 0, firstGeneration.stderr);
  const firstSerialized = fs.readFileSync(fixtureOutput, "utf8");
  const fixtureGenerated = JSON.parse(firstSerialized);
  assert.equal(fixtureGenerated.metadata.complete, true, "all ten fixture XML files are required and parsed");
  assert.equal(fixtureGenerated.metadata.sourceFiles.length, 10);
  assert.ok(fixtureGenerated.metadata.sourceFiles.every((source) => /^[a-f0-9]{64}$/.test(source.sha256)), "source hashes are recorded");
  assert.deepEqual(fixtureGenerated.dictionaries.brand, ["Bardahl", "Liqui & Moly"], "entities decode, empty values disappear, exact identity duplicates deduplicate");
  assert.ok(fixtureGenerated.dictionaries.acea.includes("C3"), "field-specific confusable normalization applies");
  assert.ok(fixtureGenerated.dictionaries.transmissionApi.includes("GL-4/GL-5"), "slash remains atomic during reclassification");
  assert.ok(!fixtureGenerated.dictionaries.engineApi.includes("GF-6"), "GF leaves engine API in a complete source set");
  assert.equal(fixtureGenerated.collisions.engineApi.length, 1, "distinct canonical values sharing an aggressive key are reported as a collision");

  const secondGeneration = spawnSync(process.execPath, generatorArguments, { encoding: "utf8" });
  assert.equal(secondGeneration.status, 0, secondGeneration.stderr);
  assert.equal(fs.readFileSync(fixtureOutput, "utf8"), firstSerialized, "generated output is deterministic for unchanged source");

  writeFixture("brands.xml", "WrongBrandValues", "Brand", ["Bardahl"]);
  const invalidRoot = spawnSync(process.execPath, generatorArguments, { encoding: "utf8" });
  assert.notEqual(invalidRoot.status, 0, "an invalid root blocks generation");
  assert.match(invalidRoot.stderr, /expected root <BrandValues>/);
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}

assert.equal(values.productAttributeDictionaryMetadata.complete, true, "production dictionary uses all required sources");
assert.equal(values.productAttributeDictionaryMetadata.sourceFiles.length, 10, "all ten source hashes are recorded");
assert.equal(values.getProductAttributeDictionary("ilsac").length, 11, "11 ILSAC values are derived from OEM/API sources");
assert.ok(values.getProductAttributeDictionary("acea").includes("A4"), "Cyrillic ACEA lookalike becomes canonical Latin A4");
assert.ok(!values.getProductAttributeDictionary("acea").includes("А4"), "Cyrillic A4 is not emitted as a second option");
assert.ok(!values.getProductAttributeDictionary("engineApi").includes("GF-4"), "GF values leave engine API");
assert.ok(!values.getProductAttributeDictionary("engineApi").includes("GL-4"), "GL values leave engine API");
assert.ok(values.getProductAttributeDictionary("transmissionApi").includes("GL-4"), "GL values enter transmission API");

assert.equal(values.normalizeBrand("bardahl").value, "Bardahl");
assert.equal(values.normalizeBrand("liqui   moly").value, "Liqui Moly");
assert.equal(values.normalizeBrand("Неизвестный бренд").status, "CUSTOM");
assert.equal(values.normalizeBrand("Mobil 1").status, "CUSTOM", "a similar brand is never merged by substring");

assert.deepEqual(values.normalizeEngineSae("5 w 30"), {
  input: "5 w 30", value: "5W-30", status: "SAFE_NORMALIZED", method: "EXACT_NORMALIZED", confidence: "HIGH", candidates: ["5W-30"], warnings: [],
});
assert.equal(values.normalizeAttributeValue("acea", "С3").value, "C3");
assert.equal(values.normalizeAttributeValue("ilsac", "ILSAC GF 6A").value, "GF-6A");
assert.equal(values.normalizeAttributeValue("ilsac", "GF6-A").value, "GF-6A");
assert.equal(values.normalizePackageVolume("4 L").value, "4 л");
assert.equal(values.normalizeTransmissionSae("75w90").value, "75W-90");
assert.equal(values.normalizeAttributeValue("engineOem", "BMW LL-04").value, "BMW Longlife-04");
assert.equal(values.normalizeAttributeValue("engineOem", "mb22951").value, "MB 229.51");
assert.equal(values.normalizeAttributeValue("transmissionOem", "mb23614").value, "MB 236.14");

assert.deepEqual(values.parseStoredAttributeValues("C3; A3/B4", "acea"), ["C3", "A3/B4"]);
assert.deepEqual(values.parseStoredAttributeValues("C3, A3/B4", "acea"), ["C3", "A3/B4"]);
assert.deepEqual(values.parseStoredAttributeValues("SN/CF", "engineApi"), ["SN/CF"]);
assert.deepEqual(values.parseStoredAttributeValues("GL-4/GL-5", "transmissionApi"), ["GL-4/GL-5"]);
assert.deepEqual(values.parseStoredAttributeValues("VW 504.00/507.00", "engineOem"), ["VW 504.00/507.00"]);
assert.deepEqual(values.parseStoredAttributeValues("BMW LL-04 VW 504.00/507.00", "engineOem"), ["BMW Longlife-04", "VW 504.00/507.00"]);
assert.equal(values.serializeAttributeValues(["C3", "A3/B4", "C3"], "acea"), "C3; A3/B4");
assert.equal(values.normalizeAttributeValue("engineApi", "SN").value, "SN", "SN never first-contains matches SN+ or SN/CF");
assert.equal(values.normalizeAttributeValue("engineApi", "Новый стандарт 123").status, "CUSTOM");
assert.equal(values.normalizeAttributeValue("atf", "Dexron III").value, "Dexron III");
assert.equal(values.normalizeAttributeValue("atf", "Dexron VI").value, "Dexron VI");
assert.equal(values.normalizeAttributeValue("atf", "Собственный ATF 123").status, "CUSTOM");
assert.equal(values.serializeAttributeValues(["Dexron III", "Mercon V"], "atf"), "Dexron III; Mercon V");
assert.deepEqual(values.getProductAttributeDictionary("ilsac").filter((value) => /^GF-6/u.test(value)), ["GF-6", "GF-6A", "GF-6B"]);
assert.ok(!values.getProductAttributeDictionary("engineOem").some((value) => /^ILSAC\s/u.test(value)), "ILSAC is excluded from engine OEM options");
assert.ok(values.searchProductAttributeOptions("transmissionOem", "zf 11", 10).some((option) => option.value === "ZF TE-ML 11"));
assert.equal(values.searchProductAttributeOptions("engineOem", "", 40).length, 40, "the first options page stays bounded");
assert.equal(
  values.searchProductAttributeOptions("engineOem", "", values.getProductAttributeDictionary("engineOem").length).length,
  values.getProductAttributeDictionary("engineOem").length,
  "the options API can page through the complete OEM dictionary",
);

const dirtyPayload = values.normalizeProductAttributePayload({ groupPath: "Моторное масло", entityType: "product", brand: "bardahl" });
assert.equal(dirtyPayload.values.brand, "Bardahl");
assert.equal(dirtyPayload.values.apiSpec, undefined, "an untouched attribute is omitted instead of being rewritten");

assert.deepEqual(oil.normalizeSAE("Mobil Super 5w30"), ["5W-30"]);
assert.deepEqual(oil.normalizeACEA("ACEA A3/B4"), ["A3/B4"]);
assert.deepEqual(oil.normalizeAPI("API SN/CF"), ["SN/CF"]);
assert.deepEqual(oil.normalizeOEM("VW 504.00/507.00"), ["VW 504.00/507.00"]);
assert.deepEqual(oil.normalizeILSAC("ILSAC GF-6A"), ["GF-6A"]);

assert.equal(profiles.resolveProductFluidAttributeProfile({ groupPath: "Масла / Моторные масла", entityType: "product" }), "ENGINE_OIL");
assert.equal(profiles.resolveProductFluidAttributeProfile({ groupPath: "Масла / АКПП и CVT", entityType: "product" }), "TRANSMISSION_FLUID");
assert.equal(profiles.resolveProductFluidAttributeProfile({ groupPath: "Масляные фильтры", entityType: "product" }), "OTHER");
assert.equal(profiles.resolveProductFluidAttributeProfile({ groupPath: "Моторное масло", entityType: "service" }), "OTHER");

console.log("product attribute dictionaries: ok");
