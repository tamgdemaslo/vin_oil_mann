import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const schemaPath = path.join(root, "prisma/schema.prisma");
const reportPath = path.join(root, "docs/branch-unique-constraints.md");
const schema = fs.readFileSync(schemaPath, "utf8");

const globalRandomTokens = new Map([
  ["MessengerLinkToken.token", "192-bit random start token; global uniqueness prevents token ambiguity"],
  ["Diagnostic.clientReportToken", "UUID v4 public capability token"],
  ["DiagnosticMapSession.publicToken", "CUID public capability token"],
]);

const parentScoped = new Map([
  ["ClientNotificationPreference.clientId", "one-to-one preference keyed by globally generated client id; branch ownership is enforced by the client relation policy"],
  ["DiagnosticMapVehiclePhoto.sessionId", "one-to-one child of globally generated session id"],
  ["LocalSupplierInvoice.documentId", "one-to-one child of globally generated inventory document id"],
  ["DiagnosticPosition.diagnosticId+node", "redundant parent-scoped key retained for Prisma compatibility; branch-aware twin exists"],
  ["DiagnosticMapItem.sessionId+itemCode", "redundant parent-scoped key retained for Prisma compatibility; branch-aware twin exists"],
  ["ProductMannLink.organizationId+productId+mannArticleNormalized", "redundant parent-scoped key retained for Prisma compatibility; branch-aware twin exists"],
  ["LocalStockBalance.productId+storeId", "redundant parent-scoped key retained for Prisma compatibility; branch-aware twin exists"],
]);

function mappedTable(body, modelName) {
  return body.match(/@@map\("([^"]+)"\)/)?.[1] ?? modelName;
}

function fieldMap(body) {
  const fields = new Map();
  for (const line of body.split("\n")) {
    const match = line.match(/^\s*(\w+)\s+[^\n]+/);
    if (!match || line.trim().startsWith("@@")) continue;
    fields.set(match[1], line.match(/@map\("([^"]+)"\)/)?.[1] ?? match[1]);
  }
  return fields;
}

const findings = [];
for (const match of schema.matchAll(/model\s+(\w+)\s*\{([\s\S]*?)\n\}/g)) {
  const [, model, body] = match;
  const branchScoped = /\bbranchId\s+String\??/.test(body);
  const columns = fieldMap(body);
  const constraints = [];
  for (const fieldMatch of body.matchAll(/^\s*(\w+)\s+[^\n]*@(id|unique)\b/gm)) {
    constraints.push({ kind: fieldMatch[2].toUpperCase(), fields: [fieldMatch[1]] });
  }
  for (const uniqueMatch of body.matchAll(/^\s*@@(id|unique)\(\[([^\]]+)\]/gm)) {
    constraints.push({
      kind: uniqueMatch[1].toUpperCase(),
      fields: uniqueMatch[2].split(",").map((field) => field.trim()),
    });
  }
  for (const constraint of constraints) {
    const key = `${model}.${constraint.fields.join("+")}`;
    let expectedScope = branchScoped ? "BRANCH" : "GLOBAL_OR_GROUP";
    let currentScope = constraint.fields.includes("branchId") ? "BRANCH" : "GLOBAL";
    let providerGuarantees = "n/a";
    let risk = "LOW";
    let status = "SAFE_GLOBAL";
    let migrationRequired = "no";

    if (constraint.kind === "ID" && constraint.fields.length === 1 && constraint.fields[0] === "id") {
      expectedScope = "GLOBAL_TECHNICAL_ID";
      providerGuarantees = "application-generated UUID/CUID or explicit control-plane id";
      status = "SAFE_GLOBAL_ID";
    } else if (globalRandomTokens.has(key)) {
      expectedScope = "GLOBAL_RANDOM_TOKEN";
      providerGuarantees = globalRandomTokens.get(key);
      status = "SAFE_GLOBAL_TOKEN";
    } else if (parentScoped.has(key)) {
      expectedScope = "PARENT_SCOPED";
      providerGuarantees = parentScoped.get(key);
      status = "SAFE_BY_PARENT";
    } else if (branchScoped && !constraint.fields.includes("branchId")) {
      risk = "CRITICAL";
      status = "BLOCKER";
      migrationRequired = "yes";
    } else if (branchScoped) {
      status = "SAFE_BRANCH";
    } else {
      providerGuarantees = "global/control-plane model; reviewed by model-scope registry";
    }

    findings.push({
      model,
      table: mappedTable(body, model),
      kind: constraint.kind,
      fields: constraint.fields,
      columns: constraint.fields.map((field) => columns.get(field) ?? field),
      currentScope,
      expectedScope,
      providerGuarantees,
      risk,
      migrationRequired,
      duplicatePrecheck: branchScoped && constraint.fields.includes("branchId") ? "manual preflight required" : "not required",
      status,
    });
  }
}

const blockers = findings.filter((finding) => finding.status === "BLOCKER");
const markdown = `# Аудит unique/PK по филиалам\n\n` +
  `Сгенерировано из \`prisma/schema.prisma\` 2026-07-28. Ограничений: **${findings.length}**, блокеров: **${blockers.length}**. ` +
  `Глобальные технические ID и высокоэнтропийные public tokens не получают \`branchId\`; их основания перечислены явно.\n\n` +
  `| model | kind | fields | current scope | expected scope | provider guarantee / basis | risk | migration | duplicate precheck | status |\n` +
  `|---|---|---|---|---|---|---|---|---|---|\n` +
  findings.map((row) => `| ${row.model} | ${row.kind} | ${row.fields.join(", ")} | ${row.currentScope} | ${row.expectedScope} | ${row.providerGuarantees} | ${row.risk} | ${row.migrationRequired} | ${row.duplicatePrecheck} | ${row.status} |`).join("\n") + "\n";

if (process.argv.includes("--write")) {
  fs.writeFileSync(reportPath, markdown);
  console.log(`Unique audit written: ${findings.length} constraints, ${blockers.length} blockers.`);
} else {
  const current = fs.existsSync(reportPath) ? fs.readFileSync(reportPath, "utf8") : "";
  if (current !== markdown) {
    console.error("Unique audit is stale. Run node scripts/audit-branch-unique.mjs --write.");
    process.exitCode = 1;
  }
}

if (blockers.length) {
  for (const blocker of blockers) console.error(`BLOCKER ${blocker.model}: ${blocker.fields.join(", ")}`);
  process.exitCode = 1;
} else if (!process.exitCode) {
  console.log(`Branch unique audit passed (${findings.length} constraints).`);
}
