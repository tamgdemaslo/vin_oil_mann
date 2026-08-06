import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const reportPath = path.join(root, "docs/branch-file-audit.md");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const checks = [
  ["Messenger attachments", "src/lib/messenger/messenger-storage.ts", ['["branches", getScopedBranchId()', "messengerObjectKey"]],
  ["Messenger attachment content", "src/app/api/messenger/attachments/[id]/content/route.ts", ["getSession()", "branch_id = ${getScopedBranchId()}"]],
  ["Messenger thumbnails", "src/app/api/messenger/attachments/[id]/thumbnail/route.ts", ["getSession()", "branch_id = ${getScopedBranchId()}"]],
  ["Messenger avatars", "src/app/api/messenger/conversations/[id]/avatar/route.ts", ["getSession()", "branch_id = ${getScopedBranchId()}", "getMessengerStorageObject"]],
  ["Classic diagnostic upload path", "src/lib/diagnostic-photos.ts", ['"branches", branchId, "diagnostics"']],
  ["Diagnostic map upload path", "src/lib/diagnostic-map-service.ts", ['"branches", branchId, "diagnostics"', "branchId_sessionId"]],
  ["Private diagnostic photo", "src/app/api/diagnostics/[id]/photos/[photoId]/route.ts", ["requireApiSessionWithShift()"]],
  ["Private vehicle photo", "src/app/api/diagnostics/[id]/vehicle-photo/route.ts", ["requireApiSessionWithShift()"]],
  ["Public diagnostic photo", "src/app/api/diagnostics/public/[token]/photos/[photoId]/route.ts", ["publicToken: token", "photoId"]],
].map(([name, file, markers]) => {
  const contents = read(file);
  const missing = markers.filter((marker) => !contents.includes(marker));
  return { name, file, missing, status: missing.length ? "BLOCKER" : "ENFORCED" };
});

const routeSources = [
  "src/app/api/messenger/attachments/[id]/content/route.ts",
  "src/app/api/messenger/attachments/[id]/thumbnail/route.ts",
  "src/app/api/messenger/conversations/[id]/avatar/route.ts",
].map(read).join("\n");
const permanentPublicStorageLeak = routeSources.includes("publicMessengerStorageUrl");
const blockers = [...checks.filter((row) => row.status === "BLOCKER")];
if (permanentPublicStorageLeak) blockers.push({ name: "Permanent object URL", file: "messenger file routes", missing: ["authenticated proxy"] });

const registry = [
  ["Messenger attachments", "S3-compatible object storage", "branches/{branchId}/messenger/...", "message/conversation", "session + branch SQL", "no; authenticated proxy", "legacy unprefixed keys resolved only through branch-owned DB row", "ENFORCED"],
  ["Telegram downloaded media", "same object storage", "branches/{branchId}/messenger/...", "MessengerAttachment", "worker and proxy use branchId", "no", "dry-run key migration required", "ENFORCED_NEW"],
  ["Diagnostic photos (legacy)", "local disk", "branches/{branchId}/diagnostics/{diagnosticId}/{photoId}", "DiagnosticPhoto", "session or report token + entity relation", "token route only", "old paths remain readable from branch-owned row", "ENFORCED_NEW"],
  ["Diagnostic map photos", "DB bytes + local disk cache", "branches/{branchId}/diagnostics/{sessionId}/{photoId}", "DiagnosticMapPhoto", "session or report token + entity relation", "token-bound route", "old cache paths remain entity-bound", "ENFORCED_NEW"],
  ["Vehicle photos", "DB bytes + local disk cache", "branches/{branchId}/diagnostics/{sessionId}/vehicle-*", "DiagnosticMapVehiclePhoto", "session or report token", "token-bound route", "old cache paths remain entity-bound", "ENFORCED_NEW"],
  ["Product photos", "PostgreSQL bytes", "n/a", "LocalProductPhoto -> LocalProduct", "session + branch relation", "no", "none", "ENFORCED"],
  ["Generated PDFs", "ephemeral memory/tmp", "random temp directory", "closing document/demand/report token", "session+branch or public token", "public only for one report token", "no persistent object", "ENFORCED"],
  ["Shipment documents", "generated on demand", "n/a", "LocalDemand/ClosingDocument", "session + scoped Prisma", "no", "none", "ENFORCED"],
  ["Exports", "response stream", "n/a", "scoped source rows", "session + export permission", "no", "no retained export job", "ENFORCED_SYNC"],
  ["AI attachments", "branch-scoped JSON in PostgreSQL", "n/a", "AIAssistantMessage", "thread branch scope", "no", "binary upload not implemented", "SCHEMA_ONLY"],
  ["Inventory attachments", "object-key schema only", "must be branches/{branchId}/inventory/...", "InventoryAttachment", "no download route implemented", "no", "must enforce when activated", "SCHEMA_ONLY"],
  ["Cash/invoice attachment URLs", "external URL metadata", "provider-controlled", "branch-scoped expense/invoice", "visible only with parent entity", "provider URL may be external", "move to proxy storage in separate feature", "LEGACY_POINTER"],
  ["Temporary files", "OS temp", "random UUID dir", "single render job", "not addressable via app route", "no", "cleanup in finally", "ENFORCED"],
  ["Generated images", "on-demand SVG/image response", "n/a", "single report token", "token-bound", "yes, report-scoped", "none", "ENFORCED"],
  ["Backups", "outside application runtime", "operator runbook only", "database/deployment", "operator control", "no", "application has no backup read route", "NOT_APP_ACCESSIBLE"],
];

const markdown = `# Аудит файловых подсистем по филиалам\n\n` +
  `Сгенерировано 2026-07-28. Structural checks: **${checks.length}**; blockers: **${blockers.length}**. Новые disk/object keys обязаны начинаться с \`branches/{branchId}/\`. Знание storage key не даёт доступа: приватная выдача идёт через authenticated proxy и branch-owned DB row.\n\n` +
  `| subsystem | storage | new key format | owner relation | authorization | public/signed URL | legacy handling | status |\n|---|---|---|---|---|---|---|---|\n` +
  registry.map((row) => `| ${row.join(" | ")} |`).join("\n") +
  `\n\n## Automated evidence\n\n| check | file | status |\n|---|---|---|\n` +
  checks.map((row) => `| ${row.name} | \`${row.file}\` | ${row.status}${row.missing.length ? `: missing ${row.missing.join(", ")}` : ""} |`).join("\n") +
  `\n\n## Legacy dry-run\n\nPhysical moves are forbidden before rehearsal. \`scripts/build-branch-file-migration-manifest.mjs\` produces the required oldKey/newKey/branchId/entity/size/checksum/conflict manifest against an explicitly configured non-production copy.\n`;

if (process.argv.includes("--write")) fs.writeFileSync(reportPath, markdown);
else if (!fs.existsSync(reportPath) || fs.readFileSync(reportPath, "utf8") !== markdown) {
  console.error("File audit is stale. Run node scripts/audit-branch-files.mjs --write.");
  process.exitCode = 1;
}
if (blockers.length) {
  blockers.forEach((row) => console.error(`BLOCKER ${row.name}: ${row.file}`));
  process.exitCode = 1;
} else if (!process.exitCode) console.log(`Branch file audit passed (${checks.length} checks).`);
