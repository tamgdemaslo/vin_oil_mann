#!/usr/bin/env node
/** Validate a generated MANN package; add --apply only to replace the DB data. */

import "dotenv/config";
import { readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const directoryArg = args.find((value) => !value.startsWith("--"));

if (!directoryArg) {
  console.error("Usage: node scripts/import-mann-pdf-catalog.mjs <catalog-dir> [--apply]");
  process.exit(2);
}

const directory = resolve(directoryArg);
const applicationsPath = resolve(directory, "mann_pdf_applications.csv");
const filtersPath = resolve(directory, "mann_pdf_filters_long.csv");
const summaryPath = resolve(directory, "mann_pdf_catalog_summary.json");
const [applicationsCsv, filtersCsv, summaryJson] = await Promise.all([
  readFile(applicationsPath, "utf8"),
  readFile(filtersPath, "utf8"),
  readFile(summaryPath, "utf8"),
]);

const input = {
  applicationsCsv,
  filtersCsv,
  summaryJson,
  applicationsFileName: basename(applicationsPath),
  filtersFileName: basename(filtersPath),
  replaceExisting: true,
};
const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url, { alias: { "@": resolve(workspaceRoot, "src") } });
const { dryRunMannImport, importMannCatalog } = await jiti.import("../src/lib/mann-catalog.ts");
const dryRun = await dryRunMannImport(input);
console.info(JSON.stringify({ action: "validated", ...dryRun }, null, 2));

if (dryRun.warnings.length > 0) {
  console.error("The catalogue was not imported because its control checks failed.");
  process.exit(1);
}
if (!apply) process.exit(0);

const result = await importMannCatalog(input);
console.info(JSON.stringify({ action: "imported", ...result }, null, 2));
