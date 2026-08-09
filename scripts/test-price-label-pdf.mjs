#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import createJiti from "jiti";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifactArg = process.argv.find((argument) => argument.startsWith("--artifact="));
const runtimeRoot = artifactArg ? resolve(projectRoot, artifactArg.slice("--artifact=".length)) : projectRoot;

assert.ok(existsSync(runtimeRoot), `Runtime root не найден: ${runtimeRoot}`);
process.chdir(runtimeRoot);

const jiti = createJiti(import.meta.url, { interopDefault: true });
const require = createRequire(import.meta.url);
const fs = require("node:fs");
const originalReadFileSync = fs.readFileSync;
fs.readFileSync = function readFileSyncWithoutHelvetica(...args) {
  if (String(args[0]).endsWith("Helvetica.afm")) {
    throw new Error("Standalone runtime must not require PDFKit Helvetica.afm");
  }
  return originalReadFileSync.apply(this, args);
};

try {
  const { getPriceLabelFonts, priceLabelPdfFilename, renderPriceLabelsPdf } = await jiti.import(resolve(projectRoot, "src/lib/price-label-pdf.ts"));
  const fonts = await getPriceLabelFonts();
  assert.ok(Buffer.isBuffer(fonts.regular) && fonts.regular.length > 0, "Regular font asset не загружен");
  assert.ok(Buffer.isBuffer(fonts.bold) && fonts.bold.length > 0, "Bold font asset не загружен");
  const filename = priceLabelPdfFilename("ПР-20260809-001", "2026-08-09");
  assert.equal(filename, "price-labels-20260809-001-2026-08-09.pdf", "Имя PDF должно быть ASCII-совместимым");
  assert.doesNotThrow(() => new Headers({ "Content-Disposition": `inline; filename="${filename}"` }));

  const pdf = await renderPriceLabelsPdf(
    [{
      productId: "price-label-test-product",
      receiptItemIds: ["price-label-test-position"],
      name: "Фильтр масляный MANN HU 719/7 X",
      article: "HU 719/7 X",
      priceCents: 149000,
      receivedQuantity: 1,
      copies: 1,
    }],
    { id: "price-label-test-organization", name: "ИП Елисеенко Илья Сергеевич", inn: "123456789012" }
  );

  assert.equal(pdf.subarray(0, 5).toString("ascii"), "%PDF-", "PDF с кириллицей не сформирован");
  assert.ok(pdf.length > 1_000, "Сформированный PDF слишком мал");
  console.log(`Price-label PDF font check passed (${artifactArg ? "standalone artifact" : "source"}); regular=${fonts.regular.length}; bold=${fonts.bold.length}; pdf=${pdf.length}`);
} finally {
  fs.readFileSync = originalReadFileSync;
}
