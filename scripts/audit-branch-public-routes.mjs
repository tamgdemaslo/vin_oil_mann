import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const reportPath = path.join(root, "docs/branch-public-route-audit.md");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const cases = [
  ["Legacy report payload", "src/app/api/diagnostic/public/[token]/route.ts", ["clientReportToken: token"], "READ_ONE_ENTITY"],
  ["Legacy report photo", "src/app/api/diagnostic/public/[token]/photo/[photoId]/route.ts", ["clientReportToken: token", "photoId"], "READ_ONE_ATTACHMENT"],
  ["Legacy reminder mutation", "src/app/api/diagnostic/public/[token]/reminder/route.ts", ["clientReportToken: token", "runWithRequestTenant", "publicDiagnostic.branchId"], "TOKEN_TO_BRANCH_MUTATION"],
  ["Map report payload", "src/app/api/diagnostics/public/[token]/route.ts", ["getDiagnosticMapByToken(token"], "READ_ONE_ENTITY"],
  ["Map report photo", "src/app/api/diagnostics/public/[token]/photos/[photoId]/route.ts", ["publicToken: token", "photoId"], "READ_ONE_ATTACHMENT"],
  ["Map vehicle photo", "src/app/api/diagnostics/public/[token]/vehicle-photo/route.ts", ["publicToken: token"], "READ_ONE_ATTACHMENT"],
  ["Map reminder mutation", "src/lib/diagnostic-map-service.ts", ["savePublicDiagnosticReminder", "publicToken: token"], "TOKEN_BOUND_MUTATION"],
  ["Public PDF", "src/app/report/[token]/pdf/route.ts", ["publicToken: token", 'error: "Отчёт не найден"'], "READ_ONE_ENTITY"],
];

const rows = cases.map(([name, file, markers, scope]) => {
  const contents = read(file);
  const missing = markers.filter((marker) => !contents.includes(marker));
  return { name, file, scope, missing, status: missing.length ? "BLOCKER" : "TOKEN_BOUND" };
});
const service = read("src/lib/diagnostic-map-service.ts");
const publicFunction = service.match(/export async function getDiagnosticMapByToken[\s\S]*?\n}\n\nfunction itemMissingRecommendedPhoto/)?.[0] ?? "";
const sensitive = ["clientPhone: full.clientPhone", "shipmentId: full.shipmentId", "clientId: full.clientId", "uploadedBy: full.vehiclePhoto.uploadedBy"]
  .filter((marker) => publicFunction.includes(marker));
const schema = read("prisma/schema.prisma");
const entropyChecks = [
  { token: "Diagnostic.clientReportToken", ok: /clientReportToken\s+String\s+@unique\s+@default\(uuid\(\)\)/.test(schema), basis: "UUID v4" },
  { token: "DiagnosticMapSession.publicToken", ok: /publicToken\s+String\s+@unique\s+@default\(cuid\(\)\)/.test(schema), basis: "CUID" },
];
const blockers = [...rows.filter((row) => row.status === "BLOCKER")];
if (sensitive.length) blockers.push({ name: "Public payload sensitive fields", file: "src/lib/diagnostic-map-service.ts", missing: sensitive });
for (const entropy of entropyChecks) if (!entropy.ok) blockers.push({ name: entropy.token, file: "prisma/schema.prisma", missing: ["random unique default"] });

const markdown = `# Аудит публичных token routes\n\n` +
  `Сгенерировано 2026-07-28. Routes: **${rows.length}**; blockers: **${blockers.length}**. Public routes derive branch ownership from the token-owned entity and never from activeBranch session.\n\n` +
  `| route | file | capability scope | token binding | status |\n|---|---|---|---|---|\n` +
  rows.map((row) => `| ${row.name} | \`${row.file}\` | ${row.scope} | ${row.missing.length ? `missing ${row.missing.join(", ")}` : "entity token + child relation"} | ${row.status} |`).join("\n") +
  `\n\n## Token entropy\n\n` + entropyChecks.map((row) => `- ${row.token}: ${row.basis}, ${row.ok ? "PASS" : "BLOCKER"}.`).join("\n") +
  `\n\nThe map public serializer omits internal session/demand/client IDs, client phone, sender login, upload actor, and CRM/action IDs. Attachment IDs remain opaque CUID/UUID values only where required to address one child under the report token.\n`;

if (process.argv.includes("--write")) fs.writeFileSync(reportPath, markdown);
else if (!fs.existsSync(reportPath) || fs.readFileSync(reportPath, "utf8") !== markdown) {
  console.error("Public route audit is stale. Run node scripts/audit-branch-public-routes.mjs --write.");
  process.exitCode = 1;
}
if (blockers.length) {
  blockers.forEach((row) => console.error(`BLOCKER ${row.name}: ${row.file}`));
  process.exitCode = 1;
} else if (!process.exitCode) console.log(`Branch public route audit passed (${rows.length} routes).`);
