#!/usr/bin/env node

import { PrismaClient } from "@prisma/client";
import { createJiti } from "jiti";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertLocalProductAttributeDatabase, loadLocalProductAttributeDatabaseUrl } from "./product-fluid-attribute-db.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const databaseUrl = loadLocalProductAttributeDatabaseUrl(root);
const database = assertLocalProductAttributeDatabase(databaseUrl);
const jiti = createJiti(import.meta.url, { alias: { "@": resolve(root, "src") } });
const values = await jiti.import("../src/lib/product-attribute-values.ts");
const profiles = await jiti.import("../src/lib/product-fluid-profile.ts");
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

const fieldNames = ["brand", "sae", "packageVolume", "acea", "apiSpec", "ilsac", "atf", "oem", "oemAtf"];

function dictionaryField(product, field) {
  const profile = profiles.resolveProductFluidAttributeProfile(product);
  if (field === "sae") return profile === "TRANSMISSION_FLUID" ? "transmissionSae" : "engineSae";
  if (field === "apiSpec") return profile === "TRANSMISSION_FLUID" ? "transmissionApi" : "engineApi";
  if (field === "oem") return "engineOem";
  if (field === "oemAtf") return "transmissionOem";
  return field;
}

function duplicateInside(raw) {
  const parts = String(raw ?? "").split(/[;\r\n]+/).map((value) => value.normalize("NFKC").trim().toLocaleUpperCase("ru-RU")).filter(Boolean);
  return new Set(parts).size !== parts.length;
}

function classify(product, field) {
  const raw = String(product[field] ?? "").trim();
  if (!raw) return ["empty"];
  const targetField = dictionaryField(product, field);
  const parsed = values.parseStoredAttributeValues(raw, targetField);
  const matches = parsed.map((value) => values.normalizeAttributeValue(targetField, value));
  const categories = [];
  if (matches.length > 1) categories.push("containsMultipleValues");
  const allKnown = matches.length > 0 && matches.every((match) => !["CUSTOM", "AMBIGUOUS"].includes(match.status));
  const canonicalSerialization = values.serializeAttributeValues(matches.map((match) => match.value), targetField);
  if (allKnown && canonicalSerialization === raw) categories.push("fullyCanonical");
  if (allKnown && canonicalSerialization !== raw) categories.push("canonicalAfterSafeNormalization");
  if (matches.some((match) => match.status === "CUSTOM")) categories.push("custom");
  if (matches.some((match) => match.status === "AMBIGUOUS")) categories.push("ambiguous");
  if (/\|/u.test(raw) || /;;/u.test(raw)) categories.push("malformed");
  if (/[АВСЕМНОРТУХЗавсемнортухз]/u.test(raw) && /[A-Za-z0-9]/u.test(raw)) categories.push("unicodeConfusable");
  if (duplicateInside(raw)) categories.push("exactDuplicateInsideValue");
  const profile = profiles.resolveProductFluidAttributeProfile(product);
  if (
    (profile === "ENGINE_OIL" && ((field === "atf" || field === "oemAtf") && raw))
    || (profile === "TRANSMISSION_FLUID" && (["acea", "ilsac", "oem"].includes(field) && raw))
  ) categories.push("domainMismatch");
  return categories.length ? categories : ["custom"];
}

function emptyCounters() {
  return Object.fromEntries(fieldNames.map((field) => [field, {
    empty: 0,
    fullyCanonical: 0,
    canonicalAfterSafeNormalization: 0,
    containsMultipleValues: 0,
    custom: 0,
    ambiguous: 0,
    malformed: 0,
    domainMismatch: 0,
    unicodeConfusable: 0,
    exactDuplicateInsideValue: 0,
  }]));
}

try {
  const { products, schemaScope } = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    const branchColumns = await tx.$queryRawUnsafe(`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'local_products' AND column_name = 'branch_id'
      ) AS present
    `);
    if (branchColumns[0]?.present) {
      return {
        schemaScope: "BRANCH_SCOPED",
        products: await tx.localProduct.findMany({
          select: {
            id: true, branchId: true, name: true, groupPath: true, entityType: true,
            brand: true, sae: true, packageVolume: true, acea: true, apiSpec: true,
            ilsac: true, atf: true, oem: true, oemAtf: true,
          },
          orderBy: [{ branchId: "asc" }, { groupPath: "asc" }, { id: "asc" }],
        }),
      };
    }
    return {
      schemaScope: "LEGACY_UNSCOPED",
      products: await tx.$queryRawUnsafe(`
        SELECT
          id,
          'legacy-unscoped'::text AS "branchId",
          name,
          group_path AS "groupPath",
          entity_type AS "entityType",
          brand,
          sae,
          package_volume AS "packageVolume",
          acea,
          api_spec AS "apiSpec",
          ilsac,
          atf,
          oem,
          oem_atf AS "oemAtf"
        FROM local_products
        ORDER BY group_path, id
      `),
    };
  });
  const report = {
    generatedAt: new Date().toISOString(),
    database,
    dictionaryVersion: values.productAttributeDictionaryMetadata.version,
    sourceComplete: values.productAttributeDictionaryMetadata.complete,
    schemaScope,
    totalProducts: products.length,
    totals: emptyCounters(),
    byBranchAndGroup: {},
  };
  for (const product of products) {
    const key = `${product.branchId}\u0000${product.groupPath || "Без группы"}`;
    report.byBranchAndGroup[key] ??= { branchId: product.branchId, groupPath: product.groupPath || "Без группы", products: 0, fields: emptyCounters() };
    report.byBranchAndGroup[key].products += 1;
    for (const field of fieldNames) {
      for (const category of classify(product, field)) {
        report.totals[field][category] += 1;
        report.byBranchAndGroup[key].fields[field][category] += 1;
      }
    }
  }
  report.byBranchAndGroup = Object.values(report.byBranchAndGroup);
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(`[audit:product-fluid-attributes] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
