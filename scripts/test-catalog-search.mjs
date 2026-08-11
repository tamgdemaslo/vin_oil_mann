#!/usr/bin/env node

import assert from "node:assert/strict";
import { resolve } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, alias: { "@": resolve(process.cwd(), "src") } });
const { catalogCandidateTake } = await jiti.import("../src/lib/catalog-search.ts");

assert.equal(catalogCandidateTake(0, 50), undefined);
assert.equal(catalogCandidateTake(1, 50), 1500);
assert.equal(catalogCandidateTake(3, 100), 2000);

console.log("Catalog search pagination contract — passed");
