import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const schema = fs.readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
const reportPath = path.join(root, "docs/branch-raw-sql-audit.json");
const manifestPath = path.join(root, "docs/branch-raw-sql-review.md");

const tableScopes = new Map();
for (const match of schema.matchAll(/model\s+(\w+)\s*\{([\s\S]*?)\n\}/g)) {
  const [, model, body] = match;
  const table = body.match(/@@map\("([^"]+)"\)/)?.[1];
  if (!table) continue;
  const scope = /\bbranchId\s+String/.test(body)
    ? "BRANCH_SCOPED"
    : /\bbusinessGroupId\s+String/.test(body)
      ? "GROUP_SCOPED"
      : "GLOBAL";
  tableScopes.set(table, { model, scope });
}

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name.startsWith(".") || entry.name === "node_modules" ? [] : files(full);
    return /\.(?:ts|tsx|mjs|sql)$/.test(entry.name) ? [full] : [];
  });
}

function enclosingFunction(source, offset) {
  const prefix = source.slice(0, offset);
  const matches = [...prefix.matchAll(/(?:export\s+)?(?:async\s+)?function\s+(\w+)|(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\(/g)];
  const last = matches.at(-1);
  return last?.[1] ?? last?.[2] ?? "module scope";
}

function sqlOperation(snippet, rawOperation) {
  const match = snippet.match(/\b(SELECT|INSERT|UPDATE|DELETE|UPSERT|CREATE|ALTER|DROP|TRUNCATE|WITH)\b/i);
  if (!match) return rawOperation.includes("execute") ? "MUTATION_UNKNOWN" : "READ_UNKNOWN";
  if (match[1].toUpperCase() !== "WITH") return match[1].toUpperCase();
  const afterWith = snippet.match(/\b(UPDATE|DELETE|INSERT|SELECT)\b/gi)?.at(-1);
  return afterWith?.toUpperCase() ?? "WITH";
}

function isMutation(operation, snippet) {
  return ["INSERT", "UPDATE", "DELETE", "UPSERT", "CREATE", "ALTER", "DROP", "TRUNCATE", "MUTATION_UNKNOWN"].includes(operation)
    || /\bFOR\s+UPDATE\b|pg_advisory|nextval\s*\(/i.test(snippet);
}

function priority(mutation, tables) {
  if (mutation) return "P0";
  if (tables.some((table) => /client|counterpart|vehicle|message|payroll|payment|expense|diagnostic|attachment|telegram|demand|shipment/i.test(table))) return "P1";
  if (tables.some((table) => /appointment|product|stock|case|notification|queue|job/i.test(table))) return "P2";
  return "P3";
}

function classify({ relative, snippet, tables, operation, mutation, annotation }) {
  const hasBranchColumn = /\bbranch_id\b/i.test(snippet);
  const hasParameterizedBranch = hasBranchColumn && /\$\{[^}]*branch/i.test(snippet);
  const hasAllowedBranches = /allowedBranchIds|allowed_branch_ids/i.test(snippet);
  const hasBusinessGroup = /businessGroupId|business_group_id/i.test(snippet);
  const isDdl = ["CREATE", "ALTER", "DROP", "TRUNCATE"].includes(operation);
  const isControlledMigration = relative.startsWith("prisma/migrations/") || /migration|backfill/i.test(relative);

  if (annotation?.kind === "GLOBAL_SAFE") {
    if (tables.some((table) => tableScopes.get(table)?.scope !== "GLOBAL")) {
      return { classification: "UNSAFE", status: "REVIEW_REQUIRED", branchSource: "invalid GLOBAL_SAFE annotation", requiredFix: "Remove annotation and scope the branch table query" };
    }
    return { classification: "GLOBAL_SAFE", status: "SAFE_GLOBAL", branchSource: "not applicable", requiredFix: "none" };
  }
  if (annotation?.kind === "MIGRATION_ONLY") {
    if (!isControlledMigration || !annotation.reason.trim()) {
      return { classification: "UNSAFE", status: "REVIEW_REQUIRED", branchSource: "invalid MIGRATION_ONLY annotation", requiredFix: "Move into a controlled migration/admin file and provide a reason" };
    }
    return { classification: "MIGRATION_ONLY", status: "MIGRATION_ONLY", branchSource: `controlled admin operation: ${annotation.reason}`, requiredFix: "none" };
  }
  if (isDdl) {
    return isControlledMigration
      ? { classification: "MIGRATION_ONLY", status: "MIGRATION_ONLY", branchSource: "controlled migration file", requiredFix: "none" }
      : { classification: "UNSAFE", status: "REVIEW_REQUIRED", branchSource: "runtime DDL", requiredFix: "Move schema mutation into a reviewed migration" };
  }
  if (hasAllowedBranches && hasBusinessGroup && !mutation) {
    return { classification: "OWNER_MULTI_BRANCH_READ_ONLY", status: "SAFE_GROUP", branchSource: "allowedBranchIds plus businessGroupId", requiredFix: "none" };
  }
  if (hasParameterizedBranch) {
    const byParent = /\bJOIN\b[\s\S]*\bbranch_id\b/i.test(snippet);
    return {
      classification: byParent ? "BRANCH_SCOPED_BY_PARENT" : "BRANCH_SCOPED",
      status: "SAFE_BRANCH",
      branchSource: byParent ? "parameterized parent JOIN branch_id" : "parameterized branch_id",
      requiredFix: "none",
    };
  }
  return {
    classification: "UNKNOWN",
    status: "REVIEW_REQUIRED",
    branchSource: /\borganization_id\b/i.test(snippet) ? "legacy organization_id only" : "none",
    requiredFix: mutation
      ? "Add a parameterized branch_id predicate/value before enabling this mutation"
      : "Add parameterized branch_id or a verified branch-scoped parent JOIN",
  };
}

const findings = [];
const scanRoots = ["src", "scripts"].map((dir) => path.join(root, dir)).filter(fs.existsSync);
for (const file of scanRoots.flatMap(files)) {
  const source = fs.readFileSync(file, "utf8");
  const relative = path.relative(root, file);
  const callPattern = /\$(?:queryRaw|queryRawUnsafe|executeRaw|executeRawUnsafe)\b/g;
  for (const call of source.matchAll(callPattern)) {
    const start = call.index ?? 0;
    const line = source.slice(0, start).split("\n").length;
    const window = source.slice(start, start + 5000);
    const snippet = (window.split(";")[0] ?? window).slice(0, 4000);
    const touchedTables = [...tableScopes.keys()].filter((table) => new RegExp(`\\b${table}\\b`, "i").test(snippet));
    if (!touchedTables.some((table) => tableScopes.get(table)?.scope === "BRANCH_SCOPED")) continue;
    const annotationMatch = source.slice(Math.max(0, start - 500), start).match(/branch-audit:\s*(GLOBAL_SAFE|MIGRATION_ONLY)\s+reason="([^"]+)"/);
    const annotation = annotationMatch ? { kind: annotationMatch[1], reason: annotationMatch[2] } : null;
    const operation = sqlOperation(snippet, call[0]);
    const mutation = isMutation(operation, snippet);
    const result = classify({ relative, snippet, tables: touchedTables, operation, mutation, annotation });
    findings.push({
      file: relative,
      line,
      function: enclosingFunction(source, start),
      rawApi: call[0],
      sqlOperation: operation,
      mutation,
      tables: touchedTables,
      tableScopes: Object.fromEntries(touchedTables.map((table) => [table, tableScopes.get(table)?.scope ?? "UNKNOWN"])),
      classification: result.classification,
      branchSource: result.branchSource,
      businessGroupSource: /businessGroupId|business_group_id/i.test(snippet) ? "parameterized businessGroupId" : "none",
      risk: priority(mutation, touchedTables),
      requiredFix: result.requiredFix,
      test: mutation ? "cross-branch mutation must affect zero rows or fail" : "Branch A query must not return Branch B rows",
      status: result.status,
      annotation,
    });
  }
}

const classifications = ["GLOBAL_SAFE", "GROUP_SCOPED", "BRANCH_SCOPED", "BRANCH_SCOPED_BY_PARENT", "OWNER_MULTI_BRANCH_READ_ONLY", "MIGRATION_ONLY", "UNSAFE", "UNKNOWN"];
const counts = Object.fromEntries(classifications.map((name) => [name, findings.filter((row) => row.classification === name).length]));
const report = JSON.stringify({ generatedAt: "2026-07-28", counts, findings }, null, 2) + "\n";

function md(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}
const manifest = [
  "# Branch raw SQL review — 2026-07-28",
  "",
  "Этот файл генерируется `scripts/audit-branch-raw-sql.mjs`. Статус SAFE выводится только из проверяемых признаков SQL; ручная отметка не поддерживается.",
  "",
  `- Всего обращений к branch-scoped таблицам: ${findings.length}`,
  ...classifications.map((name) => `- ${name}: ${counts[name]}`),
  "",
  "| File | Line | Function | Operation | Tables / scopes | Classification | Branch source | Group source | Mutation | Risk | Required fix | Test | Status |",
  "|---|---:|---|---|---|---|---|---|---|---|---|---|---|",
  ...findings.map((row) => `| ${md(row.file)} | ${row.line} | ${md(row.function)} | ${row.sqlOperation} | ${md(row.tables.map((table) => `${table}:${row.tableScopes[table]}`).join(", "))} | ${row.classification} | ${md(row.branchSource)} | ${md(row.businessGroupSource)} | ${row.mutation ? "yes" : "no"} | ${row.risk} | ${md(row.requiredFix)} | ${md(row.test)} | ${row.status} |`),
  "",
].join("\n");

if (process.argv.includes("--write")) {
  fs.writeFileSync(reportPath, report);
  fs.writeFileSync(manifestPath, manifest);
  console.log(`Raw SQL manifest written: ${findings.length} branch-table calls.`);
} else {
  const stale = !fs.existsSync(reportPath) || fs.readFileSync(reportPath, "utf8") !== report || !fs.existsSync(manifestPath) || fs.readFileSync(manifestPath, "utf8") !== manifest;
  if (stale) {
    console.error("Raw SQL audit reports are stale. Run with --write.");
    process.exit(1);
  }
  const blockers = findings.filter((row) => row.classification === "UNKNOWN" || row.classification === "UNSAFE");
  if (process.argv.includes("--strict") && blockers.length) {
    console.error(`Raw SQL audit NO-GO: ${blockers.length} blockers (${counts.UNSAFE} unsafe, ${counts.UNKNOWN} unknown).`);
    process.exit(1);
  }
  console.log(`Raw SQL audit current: ${findings.length} calls, ${blockers.length} blockers.`);
}
