import fs from "node:fs";
import { spawnSync } from "node:child_process";

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

if (process.env.RAILWAY_SELECTEL_RECONCILIATION_STATUS !== "VERIFIED") {
  failures.push("Railway -> Selectel reconciliation is not VERIFIED");
}
for (const [name, envName] of [
  ["Railway reconciliation evidence", "BRANCH_RECONCILIATION_EVIDENCE"],
  ["production-copy rehearsal evidence", "BRANCH_REHEARSAL_EVIDENCE"],
  ["post-migration verification evidence", "BRANCH_POST_MIGRATION_EVIDENCE"],
  ["legacy file manifest", "BRANCH_LEGACY_FILE_MANIFEST"],
  ["legacy file rehearsal evidence", "BRANCH_FILE_REHEARSAL_EVIDENCE"],
  ["rollback restore evidence", "BRANCH_ROLLBACK_REHEARSAL_EVIDENCE"],
  ["measured RTO/RPO evidence", "BRANCH_RTO_RPO_EVIDENCE"],
  ["performance comparison evidence", "BRANCH_PERFORMANCE_EVIDENCE"],
]) {
  const file = process.env[envName]?.trim();
  if (!file || !fs.existsSync(file)) failures.push(`${name}: ${envName} does not point to an evidence file`);
}
if (process.env.PRODUCTION_MAINTENANCE_WINDOW_CONFIRMED !== "true") {
  failures.push("production maintenance window is not explicitly confirmed by the owner");
}

if (failures.length) {
  console.error(`\nNO-GO (${failures.length} blockers)`);
  failures.forEach((failure, index) => console.error(`${index + 1}. ${failure}`));
  process.exit(1);
}

console.log("\nGO: code/build audits, PostgreSQL matrix, Selectel preflight, reconciliation, rehearsal, rollback, file, RTO/RPO and performance evidence checks passed.");
