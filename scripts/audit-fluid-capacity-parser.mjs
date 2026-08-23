#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { createJiti } from "jiti";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputArgument = process.argv.find((argument) => argument.startsWith("--output="));
const outputPath = outputArgument ? resolve(workspaceRoot, outputArgument.slice("--output=".length)) : null;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const parsedDatabaseUrl = new URL(databaseUrl);
if (!["127.0.0.1", "localhost", "::1"].includes(parsedDatabaseUrl.hostname)) {
  throw new Error("Capacity audit is restricted to an explicitly local PostgreSQL snapshot");
}

const jiti = createJiti(import.meta.url, { alias: { "@": resolve(workspaceRoot, "src") } });
const { FLUID_CAPACITY_PARSER_VERSION, parseFluidCapacities } = await jiti.import(
  "../src/lib/fluid-capacity-parser.ts",
);
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

function increment(record, key, amount = 1) {
  record[key] = (record[key] || 0) + amount;
}

function stableSample(items, limit = 40) {
  return items
    .sort((left, right) => createHash("sha256").update(left.id).digest("hex").localeCompare(createHash("sha256").update(right.id).digest("hex")))
    .slice(0, limit);
}

try {
  const rows = await prisma.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    return transaction.vehicleFluidRequirement.findMany({
      select: { id: true, systemCode: true, make: true, model: true, fillVolumeText: true },
      orderBy: { id: "asc" },
    });
  });

  const counts = {
    requirements: rows.length,
    requirementsWithSourceText: 0,
    requirementsWithParsedCapacity: 0,
    requirementsWithoutParsedCapacity: 0,
    parsedCapacityTokens: 0,
    exactTokens: 0,
    rangeTokens: 0,
    toleranceTokens: 0,
    approximateTokens: 0,
    upToTokens: 0,
    rejectedHorsepowerTokens: 0,
    requirementsWithRejectedHorsepower: 0,
    suspiciousTokens: 0,
    requirementsNeedingParserReview: 0,
    horsepowerTokensParsedAsCapacity: 0,
  };
  const byKind = {};
  const byConfidence = {};
  const suspiciousByCode = {};
  const samples = { rejectedHorsepower: [], suspicious: [], withoutCapacity: [] };

  for (const row of rows) {
    const text = row.fillVolumeText?.trim() || "";
    if (text) counts.requirementsWithSourceText += 1;
    const parsed = parseFluidCapacities(text, row.systemCode);
    if (parsed.capacities.length) counts.requirementsWithParsedCapacity += 1;
    else counts.requirementsWithoutParsedCapacity += 1;
    counts.parsedCapacityTokens += parsed.capacities.length;
    for (const capacity of parsed.capacities) {
      increment(byKind, capacity.kind);
      increment(byConfidence, capacity.confidence);
      if (capacity.qualifier === "EXACT") counts.exactTokens += 1;
      if (capacity.qualifier === "RANGE") counts.rangeTokens += 1;
      if (capacity.qualifier === "TOLERANCE") counts.toleranceTokens += 1;
      if (capacity.qualifier === "APPROXIMATE") counts.approximateTokens += 1;
      if (capacity.qualifier === "UP_TO") counts.upToTokens += 1;
      if (/\d(?:[.,]\d+)?\s*(?:лс\.?|л\.с\.?|л\.\s+с\.|л\s+с\.)/iu.test(capacity.raw)) {
        counts.horsepowerTokensParsedAsCapacity += 1;
      }
    }
    const horsepower = parsed.rejected.filter((item) => item.code === "HORSEPOWER_COLLISION");
    counts.rejectedHorsepowerTokens += horsepower.length;
    if (horsepower.length) {
      counts.requirementsWithRejectedHorsepower += 1;
      samples.rejectedHorsepower.push({ id: row.id, systemCode: row.systemCode, text, rejected: horsepower });
    }
    counts.suspiciousTokens += parsed.suspicious.length;
    if (parsed.needsReview) {
      counts.requirementsNeedingParserReview += 1;
      samples.suspicious.push({ id: row.id, systemCode: row.systemCode, text, suspicious: parsed.suspicious });
    }
    for (const diagnostic of parsed.suspicious) increment(suspiciousByCode, diagnostic.code);
    if (!parsed.capacities.length) samples.withoutCapacity.push({ id: row.id, systemCode: row.systemCode, text });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    parserVersion: FLUID_CAPACITY_PARSER_VERSION,
    source: {
      kind: "frozen-local-postgresql-snapshot",
      archiveId: "railway-final-frozen-backup-2026-08-02-codex-019fb41a",
      readOnlyTransaction: true,
    },
    counts,
    byKind,
    byConfidence,
    suspiciousByCode,
    safetyAssertions: {
      noHorsepowerParsedAsLiters: counts.horsepowerTokensParsedAsCapacity === 0,
    },
    samples: {
      rejectedHorsepower: stableSample(samples.rejectedHorsepower),
      suspicious: stableSample(samples.suspicious),
      withoutCapacity: stableSample(samples.withoutCapacity),
    },
  };
  if (!report.safetyAssertions.noHorsepowerParsedAsLiters) {
    throw new Error(`${counts.horsepowerTokensParsedAsCapacity} horsepower token(s) were parsed as liters`);
  }
  if (outputPath) {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  process.stdout.write(`${JSON.stringify(outputPath ? { outputPath, ...report } : report, null, 2)}\n`);
} finally {
  await prisma.$disconnect();
}
