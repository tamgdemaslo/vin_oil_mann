#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig, loadHasher, loadManifest, loadSchema, query, quoteIdent, quoteLiteral } from "./reconciliation-runtime.mjs";

function parseArgs(argv) {
  const options = { output: resolve("docs/reconciliation/repeat-full-diff.json") };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--output") options.output = resolve(argv[++index]);
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
const config = loadConfig();
const hasher = loadHasher(config);
const sourceSchema = loadSchema(config, config.sourceDb);
const targetSchema = loadSchema(config, config.targetDb);
const migration = loadManifest(resolve("docs/reconciliation/railway-to-selectel-migration-manifest.json"));
const resolutions = loadManifest(resolve("docs/reconciliation/same-pk-resolution-manifest.json"));
const protectedBefore = loadManifest(resolve("docs/reconciliation/selectel-only-protected-checksum-before.json"));
const protectedAfter = loadManifest(resolve("docs/reconciliation/selectel-only-protected-checksum-after.json"));
if (sourceSchema.hash !== targetSchema.hash || migration.schemaHash !== sourceSchema.hash) throw new Error("Schema hash mismatch.");

function rowHashIndex(db, table) {
  const pkJson = `jsonb_build_array(${table.primaryKey.map(quoteIdent).join(",")})::text`;
  const text = query(config, db, `SELECT ${pkJson}, md5(to_jsonb(t)::text) FROM public.${quoteIdent(table.tableName)} t ORDER BY 1`);
  const map = new Map();
  for (const line of text.split("\n").filter(Boolean)) {
    const split = line.lastIndexOf("|");
    const tuple = JSON.parse(line.slice(0, split));
    const publicHash = hasher.hash(`pk:${table.tableName}`, tuple);
    map.set(publicHash, line.slice(split + 1));
  }
  return map;
}

const migrationBySource = new Map(migration.records.map((record) => [`${record.sourceTable}\u0000${record.sourcePrimaryKey.hash}`, record]));
const resolutionKeys = new Set(resolutions.resolutions.map((record) => `${record.tableName}\u0000${record.primaryKey.hash}`));
const tableDiffs = [];
const unexpectedSourceOnly = [];
const unexpectedSharedDifferences = [];
let sourceOnly = 0;
let targetOnly = 0;
let sharedIdentical = 0;
let sharedDifferent = 0;

for (const table of sourceSchema.tables) {
  if (table.tableName === "_prisma_migrations") continue;
  const source = rowHashIndex(config.sourceDb, table);
  const target = rowHashIndex(config.targetDb, table);
  let tableSourceOnly = 0;
  let tableTargetOnly = 0;
  let tableSharedIdentical = 0;
  let tableSharedDifferent = 0;
  for (const [pkHash, sourceHash] of source) {
    const key = `${table.tableName}\u0000${pkHash}`;
    if (!target.has(pkHash)) {
      tableSourceOnly += 1;
      const record = migrationBySource.get(key);
      if (!record || record.action === "INSERT_MISSING") unexpectedSourceOnly.push({ tableName: table.tableName, primaryKeyHash: pkHash, manifestAction: record?.action ?? null });
      continue;
    }
    if (sourceHash === target.get(pkHash)) tableSharedIdentical += 1;
    else {
      tableSharedDifferent += 1;
      const migrationRecord = migrationBySource.get(key);
      if (!resolutionKeys.has(key) && migrationRecord?.action !== "INSERT_MISSING") {
        unexpectedSharedDifferences.push({ tableName: table.tableName, primaryKeyHash: pkHash });
      }
    }
  }
  for (const pkHash of target.keys()) if (!source.has(pkHash)) tableTargetOnly += 1;
  sourceOnly += tableSourceOnly;
  targetOnly += tableTargetOnly;
  sharedIdentical += tableSharedIdentical;
  sharedDifferent += tableSharedDifferent;
  if (tableSourceOnly || tableTargetOnly || tableSharedDifferent) tableDiffs.push({
    tableName: table.tableName,
    sourceOnly: tableSourceOnly,
    targetOnly: tableTargetOnly,
    sharedIdentical: tableSharedIdentical,
    sharedDifferent: tableSharedDifferent,
  });
}

const fkText = query(config, config.targetDb, String.raw`
SELECT child.relname,
       parent.relname,
       con.conname,
       jsonb_agg(child_col.attname ORDER BY child_key.ordinality)::text,
       jsonb_agg(parent_col.attname ORDER BY child_key.ordinality)::text,
       con.convalidated::text
FROM pg_constraint con
JOIN pg_class child ON child.oid = con.conrelid
JOIN pg_namespace child_ns ON child_ns.oid = child.relnamespace
JOIN pg_class parent ON parent.oid = con.confrelid
JOIN pg_namespace parent_ns ON parent_ns.oid = parent.relnamespace
JOIN unnest(con.conkey) WITH ORDINALITY child_key(attnum, ordinality) ON true
JOIN unnest(con.confkey) WITH ORDINALITY parent_key(attnum, ordinality) ON parent_key.ordinality = child_key.ordinality
JOIN pg_attribute child_col ON child_col.attrelid = child.oid AND child_col.attnum = child_key.attnum
JOIN pg_attribute parent_col ON parent_col.attrelid = parent.oid AND parent_col.attnum = parent_key.attnum
WHERE con.contype = 'f' AND child_ns.nspname = 'public' AND parent_ns.nspname = 'public'
GROUP BY child.relname, parent.relname, con.conname, con.convalidated
ORDER BY child.relname, con.conname`);

const foreignKeys = [];
let orphanRows = 0;
for (const line of fkText.split("\n").filter(Boolean)) {
  const [childTable, parentTable, name, childColumnsJson, parentColumnsJson, validated] = line.split("|");
  const childColumns = JSON.parse(childColumnsJson);
  const parentColumns = JSON.parse(parentColumnsJson);
  const nonNull = childColumns.map((column) => `child.${quoteIdent(column)} IS NOT NULL`).join(" AND ");
  const match = childColumns.map((column, index) => `parent.${quoteIdent(parentColumns[index])} IS NOT DISTINCT FROM child.${quoteIdent(column)}`).join(" AND ");
  const count = Number(query(config, config.targetDb, `SELECT count(*) FROM public.${quoteIdent(childTable)} child WHERE (${nonNull}) AND NOT EXISTS (SELECT 1 FROM public.${quoteIdent(parentTable)} parent WHERE ${match})`));
  foreignKeys.push({ childTable, parentTable, name, validated: validated === "true", orphanRows: count });
  orphanRows += count;
}

const invalidIndexes = Number(query(config, config.targetDb, `SELECT count(*) FROM pg_index idx JOIN pg_class rel ON rel.oid = idx.indrelid JOIN pg_namespace ns ON ns.oid = rel.relnamespace WHERE ns.nspname = 'public' AND (NOT idx.indisvalid OR NOT idx.indisready)`));
const unvalidatedConstraints = Number(query(config, config.targetDb, `SELECT count(*) FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid JOIN pg_namespace ns ON ns.oid = rel.relnamespace WHERE ns.nspname = 'public' AND NOT con.convalidated`));
const protectedChecksumMatch = protectedBefore.globalChecksum === protectedAfter.globalChecksum;
const status = unexpectedSourceOnly.length === 0
  && unexpectedSharedDifferences.length === 0
  && orphanRows === 0
  && invalidIndexes === 0
  && unvalidatedConstraints === 0
  && protectedChecksumMatch ? "PASS" : "FAIL";

const result = {
  version: 1,
  generatedAt: new Date().toISOString(),
  status,
  productionMutationAttempted: false,
  sourceDatabase: config.sourceDb,
  targetDatabase: config.targetDb,
  schemaHash: sourceSchema.hash,
  totals: { sourceOnly, targetOnly, sharedIdentical, sharedDifferent },
  explainedDifferences: {
    sourceOnlyManifestActions: Object.fromEntries([...migration.records.reduce((map, record) => {
      if (!map.has(record.action)) map.set(record.action, 0);
      map.set(record.action, map.get(record.action) + 1);
      return map;
    }, new Map()).entries()].sort()),
    resolutionManifestEntries: resolutions.conflictCount,
  },
  unexpectedSourceOnly,
  unexpectedSharedDifferences,
  integrity: { foreignKeyCount: foreignKeys.length, orphanRows, invalidIndexes, unvalidatedConstraints },
  protectedSelectelOnly: {
    contractTotal: protectedBefore.contractProtectedTotal,
    explicitPkRowsChecked: protectedBefore.explicitPkRowsChecked,
    checksumBefore: protectedBefore.globalChecksum,
    checksumAfter: protectedAfter.globalChecksum,
    checksumMatch: protectedChecksumMatch,
  },
  tableDiffs,
  foreignKeys,
};
writeFileSync(options.output, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({
  status,
  totals: result.totals,
  unexpectedSourceOnly: unexpectedSourceOnly.length,
  unexpectedSharedDifferences: unexpectedSharedDifferences.length,
  integrity: result.integrity,
  protectedChecksumMatch,
}, null, 2));
