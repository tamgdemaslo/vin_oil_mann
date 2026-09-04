#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import { createJiti } from "jiti";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = resolve(root, "data/product-attributes/vendors/eurol-2024-07.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const jiti = createJiti(import.meta.url, { alias: { "@": resolve(root, "src") } });
const values = await jiti.import("../src/lib/product-attribute-values.ts");

assert.equal(manifest.metadata.vendor, "Eurol");
assert.match(manifest.metadata.sourceSha256, /^[a-f0-9]{64}$/u);
assert.equal(manifest.products.length, 20);
assert.equal(new Set(manifest.products.map((product) => product.key)).size, manifest.products.length);
assert.equal(new Set(manifest.products.map((product) => product.catalogCode)).size, manifest.products.length);

const fieldMap = {
  brand: "brand",
  acea: "acea",
  ilsac: "ilsac",
  atf: "atf",
  oem: "engineOem",
  oemAtf: "transmissionOem",
};
const ambiguous = [];
for (const product of manifest.products) {
  assert.ok(["ENGINE_OIL", "TRANSMISSION_FLUID"].includes(product.profile), product.key);
  assert.ok(product.match.allNameFragments.length >= 2, product.key);
  assert.ok(product.printedPages.length >= 1, product.key);
  assert.ok(product.values.brand, product.key);
  for (const [storageField, raw] of Object.entries(product.values)) {
    const dictionaryField = storageField === "sae"
      ? product.profile === "ENGINE_OIL" ? "engineSae" : "transmissionSae"
      : storageField === "apiSpec"
        ? product.profile === "ENGINE_OIL" ? "engineApi" : "transmissionApi"
        : fieldMap[storageField];
    assert.ok(dictionaryField, `${product.key}: unsupported field ${storageField}`);
    const inputs = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
    for (const input of inputs) {
      const match = values.normalizeAttributeValue(dictionaryField, input);
      if (match.status === "AMBIGUOUS") ambiguous.push({ product: product.key, field: storageField, input, candidates: match.candidates });
    }
  }
}

assert.deepEqual(ambiguous, []);
console.log(`eurol product attributes: ok (${manifest.products.length} families)`);
