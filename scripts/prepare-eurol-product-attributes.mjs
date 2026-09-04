#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { createJiti } from "jiti";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertLocalProductAttributeDatabase, loadLocalProductAttributeDatabaseUrl } from "./product-fluid-attribute-db.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = resolve(root, optionValue("manifest") ?? "data/product-attributes/vendors/eurol-2024-07.json");
const reportPath = optionValue("report-json") ? resolve(root, optionValue("report-json")) : null;
const databaseUrl = loadLocalProductAttributeDatabaseUrl(root);
const database = assertLocalProductAttributeDatabase(databaseUrl);
const jiti = createJiti(import.meta.url, { alias: { "@": resolve(root, "src") } });
const attributeValues = await jiti.import("../src/lib/product-attribute-values.ts");
const fluidProfiles = await jiti.import("../src/lib/product-fluid-profile.ts");
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

const storageFieldToDictionary = {
  brand: "brand",
  packageVolume: "packageVolume",
  acea: "acea",
  ilsac: "ilsac",
  atf: "atf",
  oem: "engineOem",
  oemAtf: "transmissionOem",
};

function optionValue(name) {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) || null;
}

function normalizeIdentity(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("ru-RU")
    .replace(/[‐‑‒–—―−]/gu, "-")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function matchesManifestProduct(product, manifestProduct) {
  const identity = normalizeIdentity(product.name);
  const all = manifestProduct.match?.allNameFragments ?? [];
  const none = manifestProduct.match?.noneNameFragments ?? [];
  return all.every((fragment) => identity.includes(normalizeIdentity(fragment)))
    && none.every((fragment) => !identity.includes(normalizeIdentity(fragment)));
}

function packageVolumeFromName(name) {
  const normalized = String(name ?? "").normalize("NFKC").replace(/[.,]$/u, "");
  if (/(?:^|[^\p{L}\p{N}])100\s*мл(?=$|[^\p{L}\p{N}])/iu.test(normalized)) return "100 мл";
  const liters = normalized.match(/(?:^|[^\p{L}\p{N}])(0[.,]5|1|4|5)\s*(?:л|l)(?=$|[^\p{L}\p{N}])/iu);
  if (!liters) return null;
  return `${liters[1].replace(".", ",")} л`;
}

function dictionaryField(profile, storageField) {
  if (storageField === "sae") return profile === "ENGINE_OIL" ? "engineSae" : "transmissionSae";
  if (storageField === "apiSpec") return profile === "ENGINE_OIL" ? "engineApi" : "transmissionApi";
  return storageFieldToDictionary[storageField];
}

function normalizeTargetValue(profile, storageField, rawValue) {
  const field = dictionaryField(profile, storageField);
  if (!field) throw new Error(`Неизвестное поле ${storageField}`);
  const inputs = Array.isArray(rawValue) ? rawValue : rawValue == null ? [] : [rawValue];
  const matches = inputs.map((value) => attributeValues.normalizeAttributeValue(field, value));
  return {
    value: attributeValues.serializeAttributeValues(matches.map((match) => match.value), field) || null,
    evidence: matches,
  };
}

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

async function loadEurolProducts() {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    if (await branchColumnPresent(tx)) {
      return {
        schemaScope: "BRANCH_SCOPED",
        products: await tx.localProduct.findMany({
          where: { name: { contains: "Eurol", mode: "insensitive" }, archived: false },
          select: {
            id: true,
            branchId: true,
            name: true,
            groupPath: true,
            entityType: true,
            brand: true,
            sae: true,
            packageVolume: true,
            acea: true,
            apiSpec: true,
            ilsac: true,
            atf: true,
            oem: true,
            oemAtf: true,
          },
          orderBy: [{ branchId: "asc" }, { name: "asc" }],
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
        WHERE archived = false AND name ILIKE '%Eurol%'
        ORDER BY name, id
      `),
    };
  });
}

function targetForProduct(product, manifestProduct) {
  const profile = manifestProduct.profile;
  const packageVolume = packageVolumeFromName(product.name);
  const sourceValues = { ...manifestProduct.values, packageVolume };
  const fields = profile === "ENGINE_OIL"
    ? ["brand", "sae", "packageVolume", "acea", "apiSpec", "ilsac", "oem"]
    : ["brand", "sae", "packageVolume", "apiSpec", "atf", "oemAtf"];
  const target = {};
  const evidence = {};
  for (const field of fields) {
    const normalized = normalizeTargetValue(profile, field, sourceValues[field]);
    target[field] = normalized.value;
    evidence[field] = normalized.evidence;
  }
  return { target, evidence };
}

function sameValue(left, right) {
  return String(left ?? "") === String(right ?? "");
}

function compactEvidence(evidence) {
  return Object.fromEntries(Object.entries(evidence).map(([field, matches]) => [field, matches.map((match) => ({
    input: match.input,
    value: match.value,
    status: match.status,
    method: match.method,
    candidates: match.candidates,
    warnings: match.warnings,
  }))]));
}

try {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const { products, schemaScope } = await loadEurolProducts();
  const matched = [];
  const unmatched = [];
  const ambiguous = [];

  for (const product of products) {
    const candidates = manifest.products.filter((entry) => matchesManifestProduct(product, entry));
    if (candidates.length === 0) {
      unmatched.push({ productId: product.id, branchId: product.branchId, productName: product.name, reason: "NO_EXACT_FAMILY_MATCH" });
      continue;
    }
    if (candidates.length > 1) {
      ambiguous.push({
        productId: product.id,
        branchId: product.branchId,
        productName: product.name,
        reason: "MULTIPLE_FAMILY_MATCHES",
        candidates: candidates.map((entry) => entry.key),
      });
      continue;
    }

    const manifestProduct = candidates[0];
    const resolvedProfile = fluidProfiles.resolveProductFluidAttributeProfile(product);
    const { target, evidence } = targetForProduct(product, manifestProduct);
    const changes = Object.entries(target)
      .filter(([field, after]) => !sameValue(product[field], after))
      .map(([field, after]) => ({ field, before: product[field] ?? null, after }));
    const evidenceList = Object.values(evidence).flat();
    const evidenceWarnings = evidenceList.filter((item) => item.status === "CUSTOM" || item.status === "AMBIGUOUS");
    matched.push({
      productId: product.id,
      branchId: product.branchId,
      productName: product.name,
      familyKey: manifestProduct.key,
      catalogName: manifestProduct.catalogName,
      catalogCode: manifestProduct.catalogCode,
      printedPages: manifestProduct.printedPages,
      expectedProfile: manifestProduct.profile,
      resolvedProfile,
      profileMatches: resolvedProfile === manifestProduct.profile,
      target,
      changes,
      evidence: compactEvidence(evidence),
      customEvidenceCount: evidenceWarnings.filter((item) => item.status === "CUSTOM").length,
      ambiguousEvidenceCount: evidenceWarnings.filter((item) => item.status === "AMBIGUOUS").length,
      applyEligible: resolvedProfile === manifestProduct.profile && evidenceWarnings.every((item) => item.status !== "AMBIGUOUS"),
    });
  }

  const familyMatchCounts = Object.fromEntries(manifest.products.map((entry) => [
    entry.key,
    matched.filter((product) => product.familyKey === entry.key).length,
  ]));
  const report = {
    mode: "DRY_RUN",
    database,
    schemaScope,
    manifest: path.relative(root, manifestPath),
    source: manifest.metadata,
    dictionaryVersion: attributeValues.productAttributeDictionaryMetadata.version,
    inventoryEurolCount: products.length,
    matchedProductCount: matched.length,
    unmatchedProductCount: unmatched.length,
    ambiguousProductCount: ambiguous.length,
    changedProductCount: matched.filter((product) => product.changes.length > 0).length,
    fieldChangeCount: matched.reduce((sum, product) => sum + product.changes.length, 0),
    applyEligibleProductCount: matched.filter((product) => product.applyEligible).length,
    familyMatchCounts,
    unmatched,
    ambiguous,
    matched,
  };

  if (reportPath) {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(JSON.stringify({
    mode: report.mode,
    database: report.database,
    schemaScope: report.schemaScope,
    inventoryEurolCount: report.inventoryEurolCount,
    matchedProductCount: report.matchedProductCount,
    unmatchedProductCount: report.unmatchedProductCount,
    ambiguousProductCount: report.ambiguousProductCount,
    changedProductCount: report.changedProductCount,
    fieldChangeCount: report.fieldChangeCount,
    applyEligibleProductCount: report.applyEligibleProductCount,
    reportPath,
  }, null, 2));
} catch (error) {
  console.error(`[prepare:eurol-product-attributes] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
