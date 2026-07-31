#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { loadSchema, quoteIdent, quoteLiteral } from "./reconciliation-runtime.mjs";

const psql = process.env.RECONCILIATION_PSQL || "/opt/homebrew/opt/postgresql@18/bin/psql";
const socket = process.env.RECONCILIATION_PG_SOCKET;
const port = process.env.RECONCILIATION_PG_PORT;
const database = process.env.RECONCILIATION_SOURCE_DB;
const supplementFile = process.env.RECONCILIATION_FINAL_DELTA_FILE;

if (process.env.RECONCILIATION_ALLOW_LOCAL !== "1" || process.env.RECONCILIATION_APPLY_SUPPLEMENT_LOCAL !== "1") {
  throw new Error("Local supplement loading requires both explicit local-only acknowledgement flags.");
}
if (!socket?.startsWith("/private/tmp/") || socket.includes("://")) {
  throw new Error("Only a Unix socket below /private/tmp is allowed; TCP/remote hosts are refused.");
}
if (database !== "reconciliation_railway") {
  throw new Error("Only the isolated reconciliation_railway database may receive the source supplement.");
}
if (!supplementFile) throw new Error("RECONCILIATION_FINAL_DELTA_FILE is required.");

const config = { psql, socket, port, sourceDb: database };
const schema = loadSchema(config, database);
const rows = readFileSync(supplementFile, "utf8").split("\n").filter(Boolean).map(JSON.parse);
const dependencyOrder = new Map([
  ["_prisma_migrations", 0],
  ["messenger_connections", 10],
  ["messenger_conversations", 20],
  ["communication_identities", 30],
  ["messenger_messages", 40],
  ["conversation_entity_links", 50],
  ["integration_audit_logs", 60],
  ["messenger_outbox", 70],
  ["notification_jobs", 80],
  ["notification_logs", 90],
]);

rows.sort((left, right) => {
  const tableOrder = (dependencyOrder.get(left.tableName) ?? 1_000) - (dependencyOrder.get(right.tableName) ?? 1_000);
  return tableOrder || String(left.row?.id ?? "").localeCompare(String(right.row?.id ?? ""));
});

const statements = [
  "BEGIN;",
  "SET LOCAL statement_timeout = '60s';",
  "SET LOCAL lock_timeout = '3s';",
];
const counts = new Map();

for (const item of rows) {
  const table = schema.byName.get(item.tableName);
  if (!table || !dependencyOrder.has(item.tableName)) throw new Error(`Supplement table is not allowlisted: ${item.tableName}`);
  if (!item.row || typeof item.row !== "object" || Array.isArray(item.row)) throw new Error(`Invalid row for ${item.tableName}`);
  if (table.primaryKey.some((column) => item.row[column] === undefined)) throw new Error(`Missing primary key for ${item.tableName}`);

  const availableColumns = new Set(table.columns.map((column) => column.name));
  const columns = Object.keys(item.row).filter((column) => availableColumns.has(column));
  const nonPrimary = columns.filter((column) => !table.primaryKey.includes(column));
  const conflictAction = nonPrimary.length > 0
    ? `DO UPDATE SET ${nonPrimary.map((column) => `${quoteIdent(column)} = EXCLUDED.${quoteIdent(column)}`).join(", ")}`
    : "DO NOTHING";
  const record = quoteLiteral(item.row);
  statements.push(
    `WITH parsed AS (SELECT * FROM jsonb_populate_record(NULL::public.${quoteIdent(item.tableName)}, ${record})) `
      + `INSERT INTO public.${quoteIdent(item.tableName)} (${columns.map(quoteIdent).join(", ")}) `
      + `SELECT ${columns.map(quoteIdent).join(", ")} FROM parsed `
      + `ON CONFLICT (${table.primaryKey.map(quoteIdent).join(", ")}) ${conflictAction};`,
  );
  counts.set(item.tableName, (counts.get(item.tableName) ?? 0) + 1);
}

statements.push("COMMIT;");
const guard = spawnSync(psql, ["-X", "-v", "ON_ERROR_STOP=1", "-h", socket, "-p", port, "-d", database, "-A", "-t", "-c", "SELECT current_database(), inet_server_addr() IS NULL"], { encoding: "utf8" });
if (guard.status !== 0 || guard.stdout.trim() !== `${database}|t`) {
  throw new Error(`Local database guard failed: ${guard.stderr.trim() || guard.stdout.trim()}`);
}
const result = spawnSync(psql, ["-X", "-v", "ON_ERROR_STOP=1", "-h", socket, "-p", port, "-d", database], {
  encoding: "utf8",
  input: statements.join("\n"),
  maxBuffer: 64 * 1024 * 1024,
});
if (result.status !== 0) throw new Error(`Local supplement transaction failed: ${result.stderr.trim()}`);

console.log(JSON.stringify({
  status: "PASS",
  database,
  localUnixSocketOnly: true,
  rowsApplied: rows.length,
  tableCounts: Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right))),
  productionMutationAttempted: false,
}, null, 2));
