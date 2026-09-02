#!/usr/bin/env node

import { PrismaClient } from "@prisma/client";
import { createJiti } from "jiti";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertLocalProductAttributeDatabase, loadLocalProductAttributeDatabaseUrl } from "./product-fluid-attribute-db.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apply = process.argv.includes("--apply");
const confirmed = process.argv.includes("--confirm=APPLY_PRODUCT_FLUID_ATTRIBUTES");
if (apply && !confirmed) throw new Error("Для записи требуется отдельное подтверждение: --apply --confirm=APPLY_PRODUCT_FLUID_ATTRIBUTES");
const databaseUrl = loadLocalProductAttributeDatabaseUrl(root);
const database = assertLocalProductAttributeDatabase(databaseUrl);
const jiti = createJiti(import.meta.url, { alias: { "@": resolve(root, "src") } });
const values = await jiti.import("../src/lib/product-attribute-values.ts");
const catalog = await jiti.import("../src/lib/catalog-search.ts");
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const fields = ["brand", "sae", "packageVolume", "acea", "apiSpec", "ilsac", "atf", "oem", "oemAtf", "aceaExtra"];

const productSelect = {
  id: true, branchId: true, name: true, groupPath: true, entityType: true,
  brand: true, sae: true, packageVolume: true, acea: true, apiSpec: true,
  ilsac: true, atf: true, oem: true, oemAtf: true, aceaExtra: true,
  article: true, code: true, externalCode: true, uomName: true, barcodeEan13: true,
  barcodeEan8: true, barcodeCode128: true, description: true, tnvedCode: true,
  rosskoPartNumber: true, rosskoBrand: true, rosskoMin: true, supplierAttribute: true,
  oemParts: true, cell: true, mannCharacteristicName: true, currencyName: true,
};

async function branchColumnPresent(client) {
  const rows = await client.$queryRawUnsafe(`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'local_products' AND column_name = 'branch_id'
    ) AS present
  `);
  return Boolean(rows[0]?.present);
}

async function loadProducts() {
  if (apply) {
    if (!await branchColumnPresent(prisma)) {
      throw new Error("--apply запрещён для legacy-копии без branch_id; сначала восстановите актуальную схему");
    }
    return {
      schemaScope: "BRANCH_SCOPED",
      products: await prisma.localProduct.findMany({
        select: productSelect,
        orderBy: [{ branchId: "asc" }, { id: "asc" }],
      }),
    };
  }
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    if (await branchColumnPresent(tx)) {
      return {
        schemaScope: "BRANCH_SCOPED",
        products: await tx.localProduct.findMany({
          select: productSelect,
          orderBy: [{ branchId: "asc" }, { id: "asc" }],
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
          oem_atf AS "oemAtf",
          acea_extra AS "aceaExtra"
        FROM local_products
        ORDER BY group_path, id
      `),
    };
  });
}

try {
  const { products, schemaScope } = await loadProducts();
  const changes = [];
  for (const product of products) {
    const normalized = values.normalizeProductAttributePayload(product);
    const eligibleFields = new Set(normalized.profile === "ENGINE_OIL"
      ? ["brand", "sae", "packageVolume", "acea", "apiSpec", "ilsac", "oem", "aceaExtra"]
      : normalized.profile === "TRANSMISSION_FLUID"
        ? ["brand", "sae", "packageVolume", "apiSpec", "atf", "oemAtf"]
        : ["brand"]);
    const patch = {};
    for (const field of fields) {
      if (!eligibleFields.has(field)) continue;
      const before = product[field] ?? null;
      const after = normalized.values[field] ?? null;
      if (String(before ?? "") === String(after ?? "")) continue;
      const matches = normalized.matches[field] ?? [];
      const requiresReview = matches.some((match) => match.status === "AMBIGUOUS" || match.status === "CUSTOM");
      const warnings = [
        ...matches.flatMap((match) => match.warnings),
        ...(matches.some((match) => match.status === "CUSTOM") ? ["Содержит пользовательское значение; автоматическая запись запрещена"] : []),
      ];
      changes.push({
        productId: product.id,
        productName: product.name,
        branchId: product.branchId,
        groupPath: product.groupPath,
        field,
        before,
        after,
        matchMethod: matches.map((match) => match.method).join(", ") || "TRIM_ONLY",
        confidence: requiresReview ? "NONE" : matches.every((match) => match.confidence === "HIGH") ? "HIGH" : "MEDIUM",
        warnings,
        applyEligible: !requiresReview,
      });
      if (!requiresReview) patch[field] = after;
    }
    if (apply && Object.keys(patch).length) {
      const searchText = catalog.buildCatalogSearchText({ ...product, ...patch });
      await prisma.$transaction(async (tx) => {
        await tx.localProduct.update({ where: { id: product.id }, data: { ...patch, searchText } });
        await tx.changeLog.create({
          data: {
            branchId: product.branchId,
            entityType: "LocalProduct.attributes",
            entityId: product.id,
            action: "update",
            oldValue: Object.fromEntries(Object.keys(patch).map((field) => [field, product[field] ?? null])),
            newValue: { source: "normalize:product-fluid-attributes", fields: patch, dictionaryVersion: values.productAttributeDictionaryMetadata.version },
            performedByLogin: "owner-confirmed-normalization",
          },
        });
      });
    }
  }
  console.log(JSON.stringify({
    mode: apply ? "APPLY" : "DRY_RUN",
    database,
    dictionaryVersion: values.productAttributeDictionaryMetadata.version,
    sourceComplete: values.productAttributeDictionaryMetadata.complete,
    schemaScope,
    productCount: products.length,
    changeCount: changes.length,
    changes,
  }, null, 2));
} catch (error) {
  console.error(`[normalize:product-fluid-attributes] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
