import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { prisma } from "@/lib/db";

const REQUIRED_RUNTIME_CONFIG = ["DATABASE_URL", "APP_ORIGIN"] as const;

function configured(name: string) {
  return Boolean(process.env[name]?.trim());
}

function processStartedAt() {
  return new Date(Date.now() - process.uptime() * 1_000).toISOString();
}

export function getSystemRelease() {
  return {
    release: process.env.APP_RELEASE?.trim() || "development",
    commitSha: process.env.APP_COMMIT_SHA?.trim() || "unknown",
    imageDigest: process.env.APP_IMAGE_DIGEST?.trim() || "unknown",
    builtAt: process.env.APP_BUILT_AT?.trim() || "unknown",
    startedAt: processStartedAt(),
    nodeVersion: process.version,
  };
}

async function checkDatabase() {
  await prisma.$queryRaw`SELECT 1`;
}

async function checkMigrationCompatibility() {
  const expected = process.env.APP_EXPECTED_MIGRATION?.trim();
  if (!expected) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("APP_EXPECTED_MIGRATION is not configured");
    }
    return;
  }

  const rows = await prisma.$queryRaw<Array<{ migrationName: string }>>`
    SELECT migration_name AS "migrationName"
    FROM "_prisma_migrations"
    WHERE migration_name = ${expected}
      AND finished_at IS NOT NULL
      AND rolled_back_at IS NULL
    LIMIT 1
  `;
  if (rows.length !== 1) throw new Error("Expected database migration is not applied");
}

async function checkAppData() {
  const appDataDir = process.env.APP_DATA_DIR?.trim();
  if (!appDataDir) {
    if (process.env.NODE_ENV === "production") throw new Error("APP_DATA_DIR is not configured");
    return;
  }
  await access(appDataDir, constants.R_OK | constants.W_OK);
}

export type ReadinessCheck = {
  status: "ok" | "error";
  durationMs: number;
  error?: string;
};

async function timedCheck(run: () => Promise<void>): Promise<ReadinessCheck> {
  const startedAt = performance.now();
  const timeoutMs = Math.max(500, Number(process.env.READINESS_CHECK_TIMEOUT_MS) || 3_000);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      run(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("check timed out")), timeoutMs);
      }),
    ]);
    return { status: "ok", durationMs: Math.round(performance.now() - startedAt) };
  } catch (error) {
    return {
      status: "error",
      durationMs: Math.round(performance.now() - startedAt),
      error:
        process.env.NODE_ENV === "production"
          ? "check failed"
          : error instanceof Error
            ? error.message
            : "check failed",
    };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function getReadiness() {
  const missingConfig = REQUIRED_RUNTIME_CONFIG.filter((name) => !configured(name));
  const checks = {
    config: missingConfig.length
      ? { status: "error" as const, durationMs: 0, error: `Missing: ${missingConfig.join(", ")}` }
      : { status: "ok" as const, durationMs: 0 },
    database: await timedCheck(checkDatabase),
    migrations: await timedCheck(checkMigrationCompatibility),
    appData: await timedCheck(checkAppData),
  };
  const ready = Object.values(checks).every((check) => check.status === "ok");
  return { ready, checks };
}
