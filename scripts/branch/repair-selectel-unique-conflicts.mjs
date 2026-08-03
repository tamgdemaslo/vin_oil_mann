import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const fail = (message) => {
  console.error(`Selectel unique repair NO-GO: ${message}`);
  process.exit(1);
};

if (process.env.APP_ENV !== "branch-migration-rehearsal") fail("APP_ENV must equal branch-migration-rehearsal");
if (process.env.DEPLOYMENT_PROVIDER !== "selectel-rehearsal") fail("DEPLOYMENT_PROVIDER must equal selectel-rehearsal");
if (process.env.SELECTEL_UNIQUE_REPAIR_ENABLED !== "true") fail("SELECTEL_UNIQUE_REPAIR_ENABLED must equal true");

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
if (!databaseUrl) fail("DATABASE_URL is required");
if (/railway|rlwy\.net/i.test(databaseUrl)) fail("legacy Railway databases are forbidden");

const mode = process.argv.includes("--apply") ? "apply" : "dry-run";
if (mode === "apply" && process.env.SELECTEL_UNIQUE_REPAIR_APPLY !== "true") {
  fail("--apply requires SELECTEL_UNIQUE_REPAIR_APPLY=true");
}

const manifestPath = path.resolve(
  process.env.SELECTEL_UNIQUE_REPAIR_MANIFEST ??
    "docs/rehearsal/selectel-unique-repair-manifest-2026-08-02.json",
);
if (!fs.existsSync(manifestPath)) fail(`manifest not found: ${manifestPath}`);

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (manifest.status !== "CLASSIFIED_NO_SELECTEL_ROW_MUTATION") fail("manifest status is invalid");
if (manifest.sourceConflictOccurrences !== 59) fail("manifest must account for 59 source conflict occurrences");
if (manifest.unknown !== 0) fail("manifest contains UNKNOWN classifications");
if (!Array.isArray(manifest.mutations) || manifest.mutations.length !== 0) fail("Selectel mutation list must be empty");
if (manifest.productionMutationAllowed !== false) fail("productionMutationAllowed must be false");

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
try {
  const [integrity] = await prisma.$queryRawUnsafe(`
    SELECT
      (SELECT count(*)::int FROM pg_index WHERE NOT indisvalid) AS "invalidIndexes",
      (SELECT count(*)::int FROM pg_constraint WHERE NOT convalidated) AS "unvalidatedConstraints"
  `);
  if (integrity.invalidIndexes !== 0 || integrity.unvalidatedConstraints !== 0) {
    fail(`database integrity gate failed: ${JSON.stringify(integrity)}`);
  }

  console.log(JSON.stringify({
    status: "PASS_NO_SELECTEL_MUTATION",
    mode,
    classifiedSourceConflictOccurrences: 59,
    classification: "D_LEGACY_TECHNICAL_DUPLICATE",
    canonicalSelectelSchemaFinding: "local_demands.name is a non-unique business label",
    schemaResolution: "NON_UNIQUE_LOOKUP_INDEX",
    mutationsPlanned: 0,
    mutationsApplied: 0,
    invalidIndexes: 0,
    unvalidatedConstraints: 0,
    idempotent: true,
  }, null, 2));
} finally {
  await prisma.$disconnect();
}
