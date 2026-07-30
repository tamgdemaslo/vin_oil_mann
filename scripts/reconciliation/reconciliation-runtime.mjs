import { createHash, createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

export const ALLOWED_ACTIONS = new Set([
  "INSERT_MISSING",
  "MAP_TO_EXISTING",
  "SKIP_DUPLICATE",
  "SKIP_EPHEMERAL",
  "RECREATE_JOB",
  "RECOMPUTE",
  "MANUAL_REVIEW",
  "SKIP_OBSOLETE",
  "REJECT_INVALID",
]);

export function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

export function loadConfig() {
  const config = {
    psql: process.env.RECONCILIATION_PSQL || "/opt/homebrew/Cellar/postgresql@18/18.4/bin/psql",
    socket: process.env.RECONCILIATION_PG_SOCKET || "/private/tmp/reconciliation-socket-fixed",
    port: process.env.RECONCILIATION_PG_PORT || "55435",
    sourceDb: process.env.RECONCILIATION_SOURCE_DB || "reconciliation_railway",
    targetDb: process.env.RECONCILIATION_TARGET_DB || "reconciliation_selectel",
    hashKeyFile: process.env.RECONCILIATION_HASH_KEY_FILE,
    supplementFile: process.env.RECONCILIATION_SUPPLEMENT_FILE,
  };
  assertLocalConfig(config);
  return config;
}

export function assertLocalConfig(config) {
  if (process.env.RECONCILIATION_ALLOW_LOCAL !== "1") {
    throw new Error("Set RECONCILIATION_ALLOW_LOCAL=1 to acknowledge local-only reconciliation access.");
  }
  if (!config.socket.startsWith("/private/tmp/") || config.socket.includes("://")) {
    throw new Error("Only a Unix socket below /private/tmp is allowed; TCP/remote hosts are refused.");
  }
  if (config.sourceDb !== "reconciliation_railway" || config.targetDb !== "reconciliation_selectel") {
    throw new Error("Database guard refused: only reconciliation_railway -> reconciliation_selectel is allowed.");
  }
  if (!existsSync(config.hashKeyFile || "")) throw new Error("RECONCILIATION_HASH_KEY_FILE is required.");
  if (!existsSync(config.supplementFile || "")) throw new Error("RECONCILIATION_SUPPLEMENT_FILE is required.");
}

export function query(config, db, sql) {
  const result = spawnSync(
    config.psql,
    ["-X", "-v", "ON_ERROR_STOP=1", "-h", config.socket, "-p", config.port, "-d", db, "-A", "-t", "-c", sql],
    { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 },
  );
  if (result.status !== 0) throw new Error(`Local psql failed for ${db}: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

export function quoteIdent(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

export function quoteLiteral(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "object") return `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function loadManifest(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function loadHasher(config) {
  const key = readFileSync(config.hashKeyFile, "utf8").trim();
  const keyId = createHash("sha256").update(`${key}\n`).digest("hex").slice(0, 16);
  function hash(label, value) {
    const digest = createHmac("sha256", key).update(`${label}\u0000${JSON.stringify(stable(value))}`).digest("hex");
    return `hmac-sha256:${keyId}:${digest}`;
  }
  return { hash, keyId };
}

export function loadSchema(config, db) {
  const columnsSql = String.raw`
SELECT c.relname, a.attnum, a.attname,
       pg_catalog.format_type(a.atttypid, a.atttypmod),
       (NOT a.attnotnull)::text
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid
WHERE n.nspname = 'public' AND c.relkind = 'r'
  AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY c.relname, a.attnum`;
  const pkSql = String.raw`
SELECT c.relname, a.attname, key.ordinality
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_constraint con ON con.conrelid = c.oid AND con.contype = 'p'
JOIN unnest(con.conkey) WITH ORDINALITY AS key(attnum, ordinality) ON true
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = key.attnum
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY c.relname, key.ordinality`;
  const tables = new Map();
  for (const line of query(config, db, columnsSql).split("\n").filter(Boolean)) {
    const [tableName, ordinal, name, type, nullable] = line.split("|");
    if (!tables.has(tableName)) tables.set(tableName, { tableName, columns: [], primaryKey: [] });
    tables.get(tableName).columns.push({ name, type, nullable: nullable === "true", ordinal: Number(ordinal) });
  }
  for (const line of query(config, db, pkSql).split("\n").filter(Boolean)) {
    const [tableName, name] = line.split("|");
    tables.get(tableName)?.primaryKey.push(name);
  }
  const list = [...tables.values()].sort((a, b) => a.tableName.localeCompare(b.tableName));
  const hashPayload = list.map((table) => ({
    tableName: table.tableName,
    columns: table.columns.map(({ name, type, nullable }) => ({ name, type, nullable })),
    primaryKey: table.primaryKey,
  }));
  return {
    tables: list,
    byName: new Map(list.map((table) => [table.tableName, table])),
    hash: createHash("sha256").update(JSON.stringify(stable(hashPayload))).digest("hex"),
  };
}

export function loadUniqueIndexes(config, db, tableName) {
  const sql = String.raw`
SELECT idx.relname,
       ix.indisprimary::text,
       COALESCE(pg_get_expr(ix.indpred, ix.indrelid), ''),
       COALESCE(jsonb_agg(att.attname ORDER BY key.ordinality) FILTER (WHERE att.attname IS NOT NULL), '[]'::jsonb)::text
FROM pg_index ix
JOIN pg_class tbl ON tbl.oid = ix.indrelid
JOIN pg_namespace n ON n.oid = tbl.relnamespace
JOIN pg_class idx ON idx.oid = ix.indexrelid
JOIN unnest(ix.indkey) WITH ORDINALITY AS key(attnum, ordinality) ON true
LEFT JOIN pg_attribute att ON att.attrelid = tbl.oid AND att.attnum = key.attnum
WHERE n.nspname = 'public' AND tbl.relname = ${quoteLiteral(tableName)} AND ix.indisunique
GROUP BY idx.relname, ix.indisprimary, ix.indpred, ix.indrelid
ORDER BY idx.relname`;
  return query(config, db, sql).split("\n").filter(Boolean).map((line) => {
    const [name, primary, predicate, columns] = line.split("|");
    return { name, primary: primary === "true", predicate: predicate || null, columns: JSON.parse(columns) };
  });
}

export function buildPkIndex(config, db, table, hasher) {
  const expression = `jsonb_build_array(${table.primaryKey.map(quoteIdent).join(",")})::text`;
  const output = query(config, db, `SELECT ${expression} FROM public.${quoteIdent(table.tableName)} ORDER BY 1`);
  const index = new Map();
  for (const line of output.split("\n").filter(Boolean)) {
    const tuple = JSON.parse(line);
    index.set(hasher.hash(`pk:${table.tableName}`, tuple), tuple);
  }
  return index;
}

export function fetchRow(config, db, table, tuple) {
  const predicate = table.primaryKey.map((column, index) => `${quoteIdent(column)} IS NOT DISTINCT FROM ${quoteLiteral(tuple[index])}`).join(" AND ");
  const output = query(config, db, `SELECT to_jsonb(t)::text FROM public.${quoteIdent(table.tableName)} t WHERE ${predicate}`);
  if (!output) return null;
  const rows = output.split("\n").map(JSON.parse);
  if (rows.length !== 1) throw new Error(`Expected one ${table.tableName} row, got ${rows.length}.`);
  return rows[0];
}

export function loadSupplement(config, hasher) {
  const payload = JSON.parse(readFileSync(config.supplementFile, "utf8"));
  const index = new Map();
  for (const item of payload.records || []) {
    const publicPk = hasher.hash(`pk:${item.tableName}`, [item.row.id]);
    index.set(`${item.tableName}\u0000${publicPk}`, item.row);
  }
  return index;
}

export function countMigrations(config, db) {
  return Number(query(config, db, 'SELECT count(*) FROM public."_prisma_migrations"'));
}
