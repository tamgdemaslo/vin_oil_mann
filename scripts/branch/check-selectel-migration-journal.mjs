import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const fail = (message) => {
  console.error(`Selectel migration journal NO-GO: ${message}`);
  process.exit(1);
};

if (process.env.APP_ENV !== "branch-migration-rehearsal") fail("APP_ENV must equal branch-migration-rehearsal");
if (process.env.DEPLOYMENT_PROVIDER !== "selectel-rehearsal") fail("DEPLOYMENT_PROVIDER must equal selectel-rehearsal");
const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
if (!databaseUrl) fail("DATABASE_URL is required");
if (/railway|rlwy\.net/i.test(databaseUrl)) fail("legacy Railway databases are forbidden");

const phaseArg = process.argv.find((arg) => arg.startsWith("--phase=")) ?? "--phase=pre-resolve";
const phase = phaseArg.slice("--phase=".length);
if (!new Set(["pre-resolve", "post-deploy"]).has(phase)) fail(`unsupported phase: ${phase}`);

const migrationRoot = path.resolve("prisma/migrations");
const repository = fs.readdirSync(migrationRoot)
  .sort()
  .flatMap((name) => {
    const migrationPath = path.join(migrationRoot, name, "migration.sql");
    if (!fs.existsSync(migrationPath)) return [];
    return [{
      name,
      checksum: crypto.createHash("sha256").update(fs.readFileSync(migrationPath)).digest("hex"),
    }];
  });

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
try {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT migration_name AS name, checksum, finished_at AS "finishedAt",
           rolled_back_at AS "rolledBackAt", applied_steps_count AS "appliedSteps"
      FROM _prisma_migrations
     ORDER BY started_at, id
  `);
  const active = rows.filter((row) => row.finishedAt !== null && row.rolledBackAt === null);
  const rolledBack = rows.filter((row) => row.rolledBackAt !== null);
  const unfinished = rows.filter((row) => row.finishedAt === null && row.rolledBackAt === null);
  const activeByName = new Map(active.map((row) => [row.name, row]));

  for (const row of active) {
    const expected = repository.find((migration) => migration.name === row.name);
    if (!expected) fail(`active journal migration is absent from repository: ${row.name}`);
    if (expected.checksum !== row.checksum) fail(`checksum mismatch: ${row.name}`);
  }

  if (phase === "pre-resolve") {
    if (rows.length !== 57 || active.length !== 50 || rolledBack.length !== 6 || unfinished.length !== 1) {
      fail(`expected 57 total / 50 active / 6 rolled back / 1 unfinished, got ${rows.length}/${active.length}/${rolledBack.length}/${unfinished.length}`);
    }
    const [failed] = unfinished;
    const expected = repository.find((migration) => migration.name === "20260728120000_branch_architecture_foundation");
    const auditedFailedChecksum = "14de5716128ff19ba5acf6df3f9f25902179b3d0f05d23b1d8137cab45051d8b";
    if (!expected || failed.name !== expected.name || failed.checksum !== auditedFailedChecksum || failed.appliedSteps !== 0) {
      fail("unfinished foundation row does not match the audited original zero-step attempt");
    }
    if (expected.checksum === auditedFailedChecksum) {
      fail("repository foundation still contains the invalid local_demands unique constraint");
    }
  } else {
    if (unfinished.length !== 0) fail(`post-deploy journal still has ${unfinished.length} unfinished rows`);
    if (active.length !== repository.length) fail(`expected ${repository.length} active migrations, got ${active.length}`);
    for (const expected of repository) {
      const row = activeByName.get(expected.name);
      if (!row) fail(`repository migration is not active: ${expected.name}`);
      if (row.checksum !== expected.checksum) fail(`checksum mismatch: ${expected.name}`);
    }
    if (rolledBack.length !== 7) fail(`expected 7 historical/resolved rollback rows, got ${rolledBack.length}`);
  }

  console.log(JSON.stringify({
    status: "PASS",
    phase,
    repositoryMigrations: repository.length,
    journalRows: rows.length,
    active: active.length,
    rolledBack: rolledBack.length,
    unfinished: unfinished.length,
    checksumsMatch: true,
  }, null, 2));
} finally {
  await prisma.$disconnect();
}
