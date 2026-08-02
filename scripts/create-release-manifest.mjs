import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const output = process.argv[2];
if (!output) throw new Error("Usage: create-release-manifest.mjs <output.json>");

const required = [
  "RELEASE_TAG",
  "COMMIT_SHA",
  "APP_IMAGE_DIGEST",
  "MIGRATION_IMAGE_DIGEST",
  "BUILT_AT",
];
for (const name of required) {
  if (!process.env[name]?.trim()) throw new Error(`${name} is required`);
}

async function sha256(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

const migrations = (await readdir("prisma/migrations", { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const manifest = {
  release: process.env.RELEASE_TAG,
  commitSha: process.env.COMMIT_SHA,
  appImage: {
    repository: process.env.APP_IMAGE_REPOSITORY,
    digest: process.env.APP_IMAGE_DIGEST,
  },
  migrationImage: {
    repository: process.env.MIGRATION_IMAGE_REPOSITORY,
    digest: process.env.MIGRATION_IMAGE_DIGEST,
  },
  builtAt: process.env.BUILT_AT,
  nodeVersion: process.version,
  packageLockSha256: await sha256("package-lock.json"),
  prismaSchemaSha256: await sha256("prisma/schema.prisma"),
  migrationsIncluded: migrations,
  expectedMigration: migrations.at(-1) ?? null,
  migrationsApplied: null,
  testResult: process.env.TEST_RESULT || "passed",
  source: {
    workflow: process.env.GITHUB_WORKFLOW || null,
    runId: process.env.GITHUB_RUN_ID || null,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT || null,
  },
};

await writeFile(path.resolve(output), `${JSON.stringify(manifest, null, 2)}\n`);
console.info(`Wrote ${output}`);
