import fs from "node:fs";
import { spawnSync } from "node:child_process";

function hasPassingEvidenceStatus(file) {
  const content = fs.readFileSync(file, "utf8");
  try {
    const evidence = JSON.parse(content);
    const status = String(evidence.status ?? "").toUpperCase();
    if (/NO[_ -]?GO|NOT[_ -]?(RUN|BUILT)|UNKNOWN|FAIL/.test(status)) return false;
    return /PASS|VERIFIED|COMPLETE/.test(status);
  } catch {
    const heading = content.slice(0, 2_000);
    if (/\bNO[- ]?GO\b|\bNOT RUN\b|\bNOT BUILT\b|\bUNKNOWN\b|\bFAIL(?:ED)?\b/i.test(heading)) return false;
    return /\bPASS\b|\bVERIFIED\b|\bCOMPLETE\b/i.test(heading);
  }
}

const checks = [
  ["Prisma validate", "npx", ["prisma", "validate"]],
  ["Prisma generate", "npx", ["prisma", "generate"]],
  ["TypeScript", "npx", ["tsc", "--noEmit"]],
  ["Production build", "npm", ["run", "build"]],
  ["Branch isolation", "npm", ["run", "test:branch-isolation"]],
  ["Model audit", "npm", ["run", "audit:branch-models"]],
  ["Raw SQL audit", "npm", ["run", "audit:branch-raw-sql"]],
  ["Unique audit", "npm", ["run", "audit:branch-unique"]],
  ["Composite FK audit", "npm", ["run", "audit:branch-relations"]],
  ["Integration audit", "npm", ["run", "audit:branch-integrations"]],
  ["File route audit", "npm", ["run", "audit:branch-files"]],
  ["Export audit", "npm", ["run", "audit:branch-exports"]],
  ["Public report audit", "npm", ["run", "audit:branch-public-routes"]],
];

const failures = [];
for (const [name, command, args] of checks) {
  const result = spawnSync(command, args, { cwd: process.cwd(), env: process.env, encoding: "utf8" });
  if (result.status === 0) {
    console.log(`PASS ${name}`);
  } else {
    const detail = (result.stderr || result.stdout || "unknown failure").trim().split("\n").slice(-8).join("\n");
    failures.push(`${name}: ${detail}`);
    console.error(`FAIL ${name}`);
  }
}

if (process.env.BRANCH_SECURITY_DATABASE_URL) {
  const result = spawnSync("npm", ["run", "test:branch-security-db"], { cwd: process.cwd(), env: process.env, encoding: "utf8" });
  if (result.status === 0) console.log("PASS PostgreSQL security matrix");
  else failures.push(`PostgreSQL security matrix: ${(result.stderr || result.stdout || "failed").trim().split("\n").slice(-8).join("\n")}`);
} else {
  failures.push("PostgreSQL security matrix: BRANCH_SECURITY_DATABASE_URL is unavailable; matrix was not executed");
  console.error("FAIL PostgreSQL security matrix (test DB unavailable)");
}

const preflight = spawnSync("npm", ["run", "migration:branch:preflight"], { cwd: process.cwd(), env: process.env, encoding: "utf8" });
if (preflight.status === 0) console.log("PASS Selectel rehearsal preflight");
else {
  failures.push(`Selectel rehearsal preflight: ${(preflight.stderr || preflight.stdout || "failed").trim().split("\n").slice(-12).join("\n")}`);
  console.error("FAIL Selectel rehearsal preflight");
}

if (process.env.LEGACY_PLATFORM_ARCHIVE_STATUS !== "RAILWAY_DECOMMISSIONED_ARCHIVED") {
  failures.push("legacy platform archive status is not RAILWAY_DECOMMISSIONED_ARCHIVED");
}
for (const [name, envName] of [
  ["legacy platform archive evidence", "BRANCH_LEGACY_PLATFORM_ARCHIVE_EVIDENCE"],
  ["production-copy rehearsal evidence", "BRANCH_REHEARSAL_EVIDENCE"],
  ["post-migration verification evidence", "BRANCH_POST_MIGRATION_EVIDENCE"],
  ["legacy file manifest", "BRANCH_LEGACY_FILE_MANIFEST"],
  ["legacy file rehearsal evidence", "BRANCH_FILE_REHEARSAL_EVIDENCE"],
  ["rollback restore evidence", "BRANCH_ROLLBACK_REHEARSAL_EVIDENCE"],
  ["measured RTO/RPO evidence", "BRANCH_RTO_RPO_EVIDENCE"],
  ["performance comparison evidence", "BRANCH_PERFORMANCE_EVIDENCE"],
]) {
  const file = process.env[envName]?.trim();
  if (!file || !fs.existsSync(file)) {
    failures.push(`${name}: ${envName} does not point to an evidence file`);
    continue;
  }
  if (envName === "BRANCH_LEGACY_PLATFORM_ARCHIVE_EVIDENCE") {
    try {
      const evidence = JSON.parse(fs.readFileSync(file, "utf8"));
      if (evidence.status !== "RAILWAY_DECOMMISSIONED_ARCHIVED") failures.push(`${name}: status is invalid`);
      if (evidence.canonicalProduction?.provider !== "Selectel") failures.push(`${name}: Selectel is not canonical production`);
      if (evidence.legacyPlatform?.importPolicy !== "ARCHIVE_ONLY_DO_NOT_IMPORT") failures.push(`${name}: import policy is invalid`);
      if (evidence.legacyPlatform?.decommissioned !== true) failures.push(`${name}: decommissioning is not confirmed`);
      if (evidence.backup?.verified !== true) failures.push(`${name}: backup verification is not confirmed`);
      if (evidence.legacyPlatform?.project?.projectDeleted !== true) failures.push(`${name}: project deletion is not confirmed`);
      if (evidence.github?.verified !== true || evidence.github?.railwayReferencesRemaining !== 0) failures.push(`${name}: GitHub cleanup is not confirmed`);
      if (evidence.selectelCleanup?.railwayEnvironmentKeysRemaining !== 0) failures.push(`${name}: Railway environment keys remain on Selectel`);
      if (evidence.localCleanup?.railwayProjectLink !== false || evidence.localCleanup?.railwayCliSession !== false) failures.push(`${name}: local Railway link/session remains`);
    } catch (error) {
      failures.push(`${name}: invalid JSON (${error instanceof Error ? error.message : String(error)})`);
    }
  } else if (!hasPassingEvidenceStatus(file)) {
    failures.push(`${name}: evidence does not contain a passing status`);
  }
}
for (const legacyPath of ["railway.json", "railway.toml", "railpack.json", "nixpacks.toml", ".railwayignore", ".railway"]) {
  if (fs.existsSync(legacyPath)) failures.push(`active legacy platform path remains: ${legacyPath}`);
}
if (process.env.PRODUCTION_MAINTENANCE_WINDOW_CONFIRMED !== "true") {
  failures.push("production maintenance window is not explicitly confirmed by the owner");
}

if (failures.length) {
  console.error(`\nNO-GO (${failures.length} blockers)`);
  failures.forEach((failure, index) => console.error(`${index + 1}. ${failure}`));
  process.exit(1);
}

console.log("\nGO: code/build audits, PostgreSQL matrix, Selectel preflight, legacy archive, rehearsal, rollback, file, RTO/RPO and performance evidence checks passed.");
