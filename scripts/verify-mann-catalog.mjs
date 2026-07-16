#!/usr/bin/env node
/** Print post-import evidence for the MANN vehicle selector. */

import "dotenv/config";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url, { alias: { "@": resolve(workspaceRoot, "src") } });
const { getMannCatalogStats, listMannModels, listMannVariants, listMannFilters } = await jiti.import("../src/lib/mann-catalog.ts");
const [stats, toyotaModels, fordModels, mondeoVariants, rav4Variants] = await Promise.all([
  getMannCatalogStats(),
  listMannModels("TOYOTA"),
  listMannModels("FORD"),
  listMannVariants({ make: "FORD", model: "Mondeo V" }),
  listMannVariants({ make: "TOYOTA", model: "RAV4 III" }),
]);
const mondeoCng = mondeoVariants.find((variant) => variant.engineCode === "C25HDEX" && variant.vehicleText === "2.5(CNG)");
const mondeoFilters = mondeoCng
  ? await listMannFilters({ make: "FORD", model: "Mondeo V", variantId: mondeoCng.variantId })
  : [];
const cabinForAllEngines = mondeoFilters.find((filter) => filter.filterType === "cabin" && filter.mannArticleNormalized === "CUK28001");
if (!cabinForAllEngines) {
  throw new Error("Expected common cabin filter CUK 28 001 for Ford Mondeo V 2.5(CNG)");
}
const rav4Vvti = rav4Variants.find((variant) => variant.engineCode === "3ZR-FAE" && variant.vehicleText === "2.0VVT-i");
const rav4Filters = rav4Vvti
  ? await listMannFilters({ make: "TOYOTA", model: "RAV4 III", variantId: rav4Vvti.variantId })
  : [];
const expectedRav4Cabin = new Set(["CU1919", "CUK1919", "FP1919"]);
const missingRav4Cabin = [...expectedRav4Cabin].filter((article) => !rav4Filters.some((filter) => filter.mannArticleNormalized === article));
if (missingRav4Cabin.length > 0) {
  throw new Error(`Missing RAV4 III common cabin filters: ${missingRav4Cabin.join(", ")}`);
}

const has = (model) => /RAV|MONDEO|MUSTANG|PUMA/i.test(model.model);
console.info(JSON.stringify({
  stats,
  toyota: toyotaModels.filter(has),
  ford: fordModels.filter(has),
  mondeoV25Cng: mondeoFilters,
  rav4Iii20Vvti: rav4Filters,
}, null, 2));
