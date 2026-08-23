#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { createJiti } from "jiti";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputArgument = process.argv.find((argument) => argument.startsWith("--output="));
const outputPath = resolve(workspaceRoot, outputArgument?.slice("--output=".length) || "benchmarks/fluid-capacity-golden-v2.json");
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) throw new Error("DATABASE_URL is required");
const parsedDatabaseUrl = new URL(databaseUrl);
if (!["127.0.0.1", "localhost", "::1"].includes(parsedDatabaseUrl.hostname)) {
  throw new Error("Golden fixture generation is restricted to an explicitly local PostgreSQL snapshot");
}

const jiti = createJiti(import.meta.url, { alias: { "@": resolve(workspaceRoot, "src") } });
const { FLUID_CAPACITY_PARSER_VERSION, parseFluidCapacities } = await jiti.import(
  "../src/lib/fluid-capacity-parser.ts",
);
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableExpected(result) {
  return {
    capacities: result.capacities.map((capacity) => ({
      kind: capacity.kind,
      minLiters: capacity.minLiters,
      maxLiters: capacity.maxLiters,
      nominalLiters: capacity.nominalLiters,
      toleranceLiters: capacity.toleranceLiters,
      context: capacity.context,
      confidence: capacity.confidence,
      raw: capacity.raw,
      qualifier: capacity.qualifier,
      serviceContext: capacity.serviceContext,
      filterContext: capacity.filterContext,
    })),
    rejected: result.rejected.map(({ code, raw }) => ({ code, raw })),
    suspicious: result.suspicious.map(({ code, raw }) => ({ code, raw })),
    needsReview: result.needsReview,
  };
}

function categories(text, parsed) {
  const result = [];
  if (/\d(?:[.,]\d+)?\s*(?:лс\.?|л\.с\.?|л\.\s+с\.|л\s+с\.)/iu.test(text)) result.push("HORSEPOWER");
  if (/[±]/u.test(text)) result.push("TOLERANCE");
  if (/\d(?:[.,]\d+)?\s*(?:\.{3}|…|[-–—])\s*\d/u.test(text)) result.push("RANGE");
  if (/(?:около|примерно|приблизительно|порядка|до|не\s+более|~|≈)/iu.test(text)) result.push("UNCERTAINTY");
  if (/фильтр/iu.test(text)) result.push("FILTER_CONTEXT");
  if (/(?:частич|полн|общ|сух|сервис)/iu.test(text)) result.push("SERVICE_CONTEXT");
  if (parsed.capacities.length > 1) result.push("MULTI_CAPACITY");
  if (parsed.capacities.length === 0) result.push("NO_CAPACITY");
  if (!result.length) result.push("EXACT_OTHER");
  return result;
}

const quota = new Map([
  ["HORSEPOWER", 20],
  ["TOLERANCE", 35],
  ["RANGE", 35],
  ["UNCERTAINTY", 10],
  ["FILTER_CONTEXT", 20],
  ["SERVICE_CONTEXT", 25],
  ["MULTI_CAPACITY", 30],
  ["NO_CAPACITY", 10],
  ["EXACT_OTHER", 15],
]);

try {
  const rows = await prisma.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    return transaction.vehicleFluidRequirement.findMany({
      where: { fillVolumeText: { not: null } },
      select: { id: true, fillVolumeText: true, systemCode: true },
      orderBy: { id: "asc" },
    });
  });

  const distinct = new Map();
  for (const row of rows) {
    const text = row.fillVolumeText?.trim();
    if (!text) continue;
    const existing = distinct.get(text);
    if (existing) {
      existing.occurrences += 1;
      existing.systemCodes.add(row.systemCode);
      continue;
    }
    const parsed = parseFluidCapacities(text, row.systemCode);
    distinct.set(text, {
      sourceRequirementId: row.id,
      text,
      occurrences: 1,
      systemCodes: new Set([row.systemCode]),
      categories: categories(text, parsed),
      expected: stableExpected(parsed),
      sortKey: hash(`${row.systemCode}\u0000${text}`),
    });
  }

  const pool = [...distinct.values()].sort((left, right) => left.sortKey.localeCompare(right.sortKey));
  const selected = new Map();
  for (const [category, limit] of quota) {
    for (const row of pool.filter((item) => item.categories.includes(category)).slice(0, limit)) {
      selected.set(row.text, row);
    }
  }
  for (const row of pool) {
    if (selected.size >= 200) break;
    selected.set(row.text, row);
  }

  const cases = [...selected.values()]
    .slice(0, 200)
    .sort((left, right) => left.sortKey.localeCompare(right.sortKey))
    .map((row, index) => ({
      caseId: `capacity-v2-real-${String(index + 1).padStart(3, "0")}`,
      sourceRequirementId: row.sourceRequirementId,
      text: row.text,
      occurrences: row.occurrences,
      categories: row.categories,
      expected: row.expected,
      systemCode: [...row.systemCodes].sort()[0],
      observedSystemCodes: [...row.systemCodes].sort(),
    }));

  if (cases.length !== 200 || new Set(cases.map((item) => item.text)).size !== 200) {
    throw new Error(`Expected 200 distinct real cases, received ${cases.length}`);
  }

  const categoryCounts = {};
  for (const row of cases) {
    for (const category of row.categories) categoryCounts[category] = (categoryCounts[category] || 0) + 1;
  }
  const fixture = {
    schemaVersion: 1,
    parserVersion: FLUID_CAPACITY_PARSER_VERSION,
    source: {
      kind: "frozen-local-postgresql-snapshot",
      archiveId: "railway-final-frozen-backup-2026-08-02-codex-019fb41a",
      totalRequirements: rows.length,
      distinctNonEmptyFillVolumeTexts: distinct.size,
    },
    selection: {
      method: "deterministic-stratified-sha256",
      requestedCases: 200,
      distinctCases: cases.length,
      categoryCounts,
      note: "Expected structures are frozen parser-v2 snapshots; independent hand-authored safety assertions live in scripts/test-fluid-capacity-parser.mjs.",
    },
    cases,
  };

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ outputPath, cases: cases.length, categoryCounts }, null, 2)}\n`);
} finally {
  await prisma.$disconnect();
}
