import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const reportPath = path.join(root, "docs/branch-export-audit.md");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const definitions = [
  ["Products XLSX", "src/app/api/products/export/route.ts", "SINGLE_BRANCH", "products", ["getSession()", "canManageProducts"]],
  ["Product import result XLSX", "src/app/api/products/import/[jobId]/report/route.ts", "SINGLE_BRANCH", "products", ["getSession()", "canManageProducts"]],
  ["Product template XLSX", "src/app/api/products/export-template/route.ts", "GLOBAL_SAFE", "template", ["getSession()"]],
  ["Warehouse analytics CSV", "src/app/api/warehouse/analytics/_shared.ts", "SINGLE_BRANCH", "inventory", ["canExportWarehouseAnalytics", "getWarehouseProductAnalytics"]],
  ["Inventory count CSV/HTML", "src/app/api/inventory/sessions/[...path]/route.ts", "SINGLE_BRANCH", "inventory", ["getSession()", "getInventoryReconciliation"]],
  ["Job order XLS", "src/app/api/demands/[id]/job-order/route.ts", "SINGLE_BRANCH", "clients+shipments", ["getSession()", "loadLocalDemandDetailPayload"]],
  ["Finance JSON/CSV source", "src/app/api/finance/[report]/route.ts", "SINGLE_BRANCH", "finances", ["getSession()", "getFinanceCenter"]],
  ["Closing document PDF", "src/app/api/closing-documents/[id]/pdf/route.ts", "SINGLE_BRANCH", "finances+shipments", ["getSession()", "loadClosingDocument"]],
  ["Demand closing PDF", "src/app/api/demands/[id]/closing-documents/pdf/route.ts", "SINGLE_BRANCH", "finances+shipments", ["getSession()", "prisma.localDemand.findFirst"]],
];
const rows = definitions.map(([name, file, scope, dataClass, markers]) => {
  const contents = read(file);
  const missing = markers.filter((marker) => !contents.includes(marker));
  return { name, file, scope, dataClass, missing, status: missing.length ? "BLOCKER" : "SCOPED" };
});
const scopedDb = read("src/lib/db.ts");
const allModeMutationBlocked = scopedDb.includes('tenant.mode === "all"') && scopedDb.includes("WRITE_OPERATIONS.has(operation)");
const allModeExplicitBranch = scopedDb.includes("В режиме «Все филиалы» требуется явный разрешённый branchId");
const blockers = rows.filter((row) => row.status === "BLOCKER");
if (!allModeMutationBlocked || !allModeExplicitBranch) blockers.push({ name: "all-branches guard", file: "src/lib/db.ts", missing: ["explicit allowed branches/read-only"] });

const markdown = `# Аудит экспортов по филиалам\n\n` +
  `Сгенерировано 2026-07-28. Exports: **${rows.length}**; blockers: **${blockers.length}**. Все реализованные выгрузки являются synchronous \`SINGLE_BRANCH\` (кроме безопасного пустого шаблона), поэтому permissions snapshot export-job пока неприменим: retained export jobs отсутствуют.\n\n` +
  `| export | file | scope | data class | authorization/source scope | status |\n|---|---|---|---|---|---|\n` +
  rows.map((row) => `| ${row.name} | \`${row.file}\` | ${row.scope} | ${row.dataClass} | ${row.missing.length ? `missing ${row.missing.join(", ")}` : "server session + scoped DB/service"} | ${row.status} |`).join("\n") +
  `\n\n## All-branches policy\n\nNo current export accepts \`scope=MULTI_BRANCH\`. In all-branches mode the database policy requires explicit allowed branch IDs for reads and blocks every mutation. Personal-data multi-branch exports are therefore disabled, not implicitly granted to owners. Any future multi-branch export must add a retained permission snapshot and one of \`branches.export_clients\`, \`branches.export_finances\`, \`branches.export_payroll\`, or \`branches.export_messages\`.\n\n` +
  `Client-side finance CSV is derived only from the already server-scoped finance response; it cannot widen scope. ZIP, payroll, message, appointment, and client-list export endpoints are not implemented.\n`;

if (process.argv.includes("--write")) fs.writeFileSync(reportPath, markdown);
else if (!fs.existsSync(reportPath) || fs.readFileSync(reportPath, "utf8") !== markdown) {
  console.error("Export audit is stale. Run node scripts/audit-branch-exports.mjs --write.");
  process.exitCode = 1;
}
if (blockers.length) {
  blockers.forEach((row) => console.error(`BLOCKER ${row.name}: ${row.file}`));
  process.exitCode = 1;
} else if (!process.exitCode) console.log(`Branch export audit passed (${rows.length} exports).`);
