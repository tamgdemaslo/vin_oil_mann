import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const reportPath = path.join(root, "docs/branch-integration-audit.md");

function filesBelow(directory) {
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith("._")) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...filesBelow(absolute));
    else result.push(absolute);
  }
  return result;
}

function source(relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

const forbiddenRuntimeEnv = /process\.env\.(?:YCLIENTS_[A-Z0-9_]+|ROSSKO_[A-Z0-9_]+|MOYSKLAD_(?:LOGIN|PASSWORD|TOKEN|BEARER|PREFER_BEARER))/g;
const knownLeakedSecrets = ["mz5bf2yp97nbs4s45e9j"];
const runtimeFindings = [];
for (const file of filesBelow(path.join(root, "src")).filter((item) => /\.(?:ts|tsx|js|mjs)$/.test(item))) {
  const contents = fs.readFileSync(file, "utf8");
  for (const match of contents.matchAll(forbiddenRuntimeEnv)) {
    runtimeFindings.push({ file: path.relative(root, file), token: match[0] });
  }
  for (const secret of knownLeakedSecrets) {
    if (contents.includes(secret)) runtimeFindings.push({ file: path.relative(root, file), token: "known hardcoded credential" });
  }
}

const checks = [
  ["YCLIENTS config", "src/lib/yclients/branch-config.ts", ["getBranchIntegrationValues", '"yclients"', "getScopedBranchId"]],
  ["YCLIENTS proxy auth", "src/app/api/yclients/route.ts", ["getSession()", "requireBranchApi()", "configuredCompanyId", "getYclientsBranchConfig"]],
  ["YCLIENTS AI", "src/lib/ai-agent/yclients.ts", ["getYclientsBranchConfig"]],
  ["YCLIENTS dashboard", "src/app/api/dashboard/operations/route.ts", ["getYclientsBranchConfig", "yclientsRuntimeUserTokens"]],
  ["ROSSKO", "src/lib/rossko.ts", ["getBranchIntegrationValues", '"rossko"']],
  ["MoySklad", "src/lib/moysklad.ts", ["getBranchIntegrationValues", '"moysklad"']],
  ["MoySklad rehearsal mutation guard", "src/lib/moysklad.ts", ['assertExternalSideEffectAllowed("moysklad_mutation")']],
  ["YCLIENTS rehearsal mutation guard", "src/app/api/yclients/route.ts", ['assertExternalSideEffectAllowed("yclients_mutation")']],
  ["ROSSKO rehearsal order guard", "src/lib/rossko.ts", ['assertExternalSideEffectAllowed("rossko_order")']],
  ["T-Bank rehearsal mutation guard", "src/lib/tbank.ts", ['assertExternalSideEffectAllowed("payment_mutation")', 'assertExternalSideEffectAllowed("tbank_mutation")']],
  ["Employee Telegram link", "src/lib/messenger/messenger-linking.ts", ["linkingBranchId()", "branch_id"]],
  ["Employee Telegram notification", "src/lib/messenger/messenger-employee-notifications.ts", ["getScopedBranchId", "branch_id"]],
].map(([name, file, markers]) => {
  const contents = source(file);
  const missing = markers.filter((marker) => !contents.includes(marker));
  return { name, file, status: missing.length ? "BLOCKER" : "BRANCH_SCOPED", notes: missing.length ? `missing: ${missing.join(", ")}` : "required branch loader/guard markers present" };
});

const legacyWebhooks = [
  "src/app/api/messenger/webhook/telegram/route.ts",
  "src/app/api/messenger/webhooks/telegram/route.ts",
  "src/app/api/integrations/tbank/webhook/payment-status/route.ts",
].map((file) => {
  const contents = source(file);
  const disabled = contents.includes("status: 410") || contents.includes('from "../../webhook/telegram/route"');
  return { name: "Legacy webhook", file, status: disabled ? "DISABLED_410" : "BLOCKER", notes: disabled ? "branch-addressed route required" : "legacy unscoped route remains active" };
});

const maintenanceEnv = filesBelow(path.join(root, "scripts"))
  .filter((file) => /\.(?:js|mjs|ts)$/.test(file))
  .flatMap((file) => {
    const contents = fs.readFileSync(file, "utf8");
    return new RegExp(forbiddenRuntimeEnv.source).test(contents) ? [path.relative(root, file)] : [];
  })
  .sort();

const rows = [...checks, ...legacyWebhooks];
const blockers = [...runtimeFindings.map((finding) => ({ ...finding, status: "BLOCKER" })), ...rows.filter((row) => row.status === "BLOCKER")];
const markdown = `# Аудит филиальной изоляции интеграций\n\n` +
  `Сгенерировано 2026-07-28. Runtime env/secret blockers: **${runtimeFindings.length}**; structural blockers: **${rows.filter((row) => row.status === "BLOCKER").length}**.\n\n` +
  `| integration/path | file | status | evidence |\n|---|---|---|---|\n` +
  rows.map((row) => `| ${row.name} | \`${row.file}\` | ${row.status} | ${row.notes} |`).join("\n") +
  `\n\n## Runtime credential scan\n\n` +
  (runtimeFindings.length ? runtimeFindings.map((row) => `- BLOCKER \`${row.file}\`: ${row.token}`).join("\n") : "No YCLIENTS, ROSSKO, or MoySklad credential env fallback and no known hardcoded provider secret under `src/`.") +
  `\n\n## Maintenance-only scripts\n\n` +
  `The following scripts still accept operator-supplied MoySklad environment credentials. They are classified **ADMIN_ONLY**, are not imported by request runtime, and must not be used as a production fallback. Production execution requires a separate reviewed branch-aware migration/import procedure:\n\n` +
  (maintenanceEnv.length ? maintenanceEnv.map((file) => `- \`${file}\``).join("\n") : "- none") +
  `\n\nProvider credentials are stored as encrypted \`IntegrationCredential\` rows selected by active \`branchId\` and organization. A missing row is an explicit not-configured state; no silent global fallback is permitted.\n`;

if (process.argv.includes("--write")) {
  fs.writeFileSync(reportPath, markdown);
  console.log(`Integration audit written: ${rows.length} structural checks, ${blockers.length} blockers.`);
} else {
  const current = fs.existsSync(reportPath) ? fs.readFileSync(reportPath, "utf8") : "";
  if (current !== markdown) {
    console.error("Integration audit is stale. Run node scripts/audit-branch-integrations.mjs --write.");
    process.exitCode = 1;
  }
}

if (blockers.length) {
  for (const blocker of blockers) console.error(`BLOCKER ${blocker.file}: ${blocker.notes ?? blocker.token}`);
  process.exitCode = 1;
} else if (!process.exitCode) {
  console.log(`Branch integration audit passed (${rows.length} structural checks).`);
}
