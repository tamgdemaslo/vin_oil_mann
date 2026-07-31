#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const [baselinePath, candidatePath] = process.argv.slice(2);
if (!baselinePath || !candidatePath) {
  throw new Error("Usage: verify-freeze-snapshots.mjs <baseline.jsonl> <candidate.jsonl>");
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function load(path) {
  const records = readFileSync(path, "utf8").split("\n").filter(Boolean).map(JSON.parse);
  const snapshot = records.find((record) => record.type === "snapshot");
  const tables = records.filter((record) => record.type === "table");
  const activity = records.find((record) => record.type === "activity") ?? null;
  if (!snapshot || tables.length === 0) throw new Error(`Invalid freeze snapshot: ${path}`);
  return { snapshot, tables, activity };
}

function tableHash(tables) {
  const canonical = tables.map((record) => `${JSON.stringify(stable(record))}\n`).join("");
  return createHash("sha256").update(canonical).digest("hex");
}

function maxValue(tables, field) {
  const values = tables.map((record) => record[field]).filter((value) => value !== null && value !== undefined);
  return values.length ? values.sort().at(-1) : null;
}

const baseline = load(baselinePath);
const candidate = load(candidatePath);
const baselineByTable = new Map(baseline.tables.map((record) => [record.tableName, record]));
const candidateByTable = new Map(candidate.tables.map((record) => [record.tableName, record]));
const allTableNames = [...new Set([...baselineByTable.keys(), ...candidateByTable.keys()])].sort();
const changedTables = [];

for (const tableName of allTableNames) {
  const before = baselineByTable.get(tableName) ?? null;
  const after = candidateByTable.get(tableName) ?? null;
  if (JSON.stringify(stable(before)) !== JSON.stringify(stable(after))) {
    changedTables.push({ tableName, before, after });
  }
}

const watchedPattern = /(notification|messenger|message|shipment|integration|audit|appointment|schedule)/i;
const watchedTables = candidate.tables
  .filter((record) => watchedPattern.test(record.tableName))
  .map(({ tableName, rowCount, maxCreatedAt, maxUpdatedAt, maxScheduledAt, maxSentAt }) => ({
    tableName,
    rowCount,
    maxCreatedAt,
    maxUpdatedAt,
    maxScheduledAt,
    maxSentAt,
  }));

const result = {
  status: changedTables.length === 0 ? "CONFIRMED" : "FAILED",
  baselineCheckedAt: baseline.snapshot.checkedAt,
  candidateCheckedAt: candidate.snapshot.checkedAt,
  candidateTransactionReadOnly: candidate.snapshot.transactionReadOnly,
  baselineTableCount: baseline.tables.length,
  candidateTableCount: candidate.tables.length,
  changedTableCount: changedTables.length,
  changedTables,
  newRowsAfterFreeze: changedTables.reduce((total, item) => {
    const before = item.before?.rowCount ?? 0;
    const after = item.after?.rowCount ?? 0;
    return total + Math.max(0, after - before);
  }, 0),
  baselineHash: tableHash(baseline.tables),
  candidateHash: tableHash(candidate.tables),
  finalMaxCreatedAt: maxValue(candidate.tables, "maxCreatedAt"),
  finalMaxUpdatedAt: maxValue(candidate.tables, "maxUpdatedAt"),
  finalMaxScheduledAt: maxValue(candidate.tables, "maxScheduledAt"),
  finalMaxSentAt: maxValue(candidate.tables, "maxSentAt"),
  activeNonSnapshotBackends: candidate.activity?.activeNonSnapshotBackends ?? null,
  watchedTables,
};

if (candidate.snapshot.transactionReadOnly !== "on" || candidate.tables.length !== 137) {
  result.status = "FAILED";
}

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
