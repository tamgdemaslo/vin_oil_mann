import fs from "node:fs";

const errors = [];
const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
if (!databaseUrl) errors.push("DATABASE_URL is required");
if (/railway|rlwy\.net/i.test(databaseUrl)) errors.push("DATABASE_URL points to the decommissioned legacy platform");

const archiveStatus = process.env.LEGACY_PLATFORM_ARCHIVE_STATUS?.trim() ?? "";
const archiveEvidencePath = process.env.BRANCH_LEGACY_PLATFORM_ARCHIVE_EVIDENCE?.trim() ?? "";
if (archiveStatus !== "RAILWAY_DECOMMISSIONED_ARCHIVED") {
  errors.push("LEGACY_PLATFORM_ARCHIVE_STATUS must equal RAILWAY_DECOMMISSIONED_ARCHIVED");
}
if (!archiveEvidencePath || !fs.existsSync(archiveEvidencePath)) {
  errors.push("BRANCH_LEGACY_PLATFORM_ARCHIVE_EVIDENCE must point to the verified archive manifest");
} else {
  try {
    const evidence = JSON.parse(fs.readFileSync(archiveEvidencePath, "utf8"));
    if (evidence.status !== "RAILWAY_DECOMMISSIONED_ARCHIVED") errors.push("archive manifest status is invalid");
    if (evidence.canonicalProduction?.provider !== "Selectel") errors.push("archive manifest does not name Selectel as canonical production");
    if (evidence.legacyPlatform?.importPolicy !== "ARCHIVE_ONLY_DO_NOT_IMPORT") errors.push("archive manifest import policy is invalid");
    if (evidence.legacyPlatform?.decommissioned !== true) errors.push("archive manifest does not confirm legacy platform decommissioning");
    if (evidence.backup?.verified !== true) errors.push("archive manifest does not confirm backup verification");
    if (evidence.legacyPlatform?.project?.projectDeleted !== true) errors.push("archive manifest does not confirm Railway project deletion");
    if (evidence.github?.verified !== true || evidence.github?.railwayReferencesRemaining !== 0) errors.push("archive manifest does not confirm clean GitHub inventory");
    if (evidence.selectelCleanup?.railwayEnvironmentKeysRemaining !== 0) errors.push("archive manifest reports Railway environment keys on Selectel");
    if (evidence.localCleanup?.railwayProjectLink !== false || evidence.localCleanup?.railwayCliSession !== false) errors.push("archive manifest reports an active local Railway link/session");
  } catch (error) {
    errors.push(`archive manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}
for (const legacyPath of ["railway.json", "railway.toml", "railpack.json", "nixpacks.toml", ".railwayignore", ".railway"]) {
  if (fs.existsSync(legacyPath)) errors.push(`active legacy platform path must be absent: ${legacyPath}`);
}
if (process.env.APP_ENV !== "branch-migration-rehearsal") errors.push("APP_ENV must equal branch-migration-rehearsal");
if (process.env.DEPLOYMENT_PROVIDER !== "selectel-rehearsal") errors.push("DEPLOYMENT_PROVIDER must equal selectel-rehearsal");
for (const name of [
  "EXTERNAL_SIDE_EFFECTS_ENABLED",
  "TELEGRAM_SEND_ENABLED",
  "WEBHOOK_PROCESSING_ENABLED",
  "PAYMENT_MUTATIONS_ENABLED",
  "TBANK_MUTATIONS_ENABLED",
  "SUPPLIER_ORDER_ENABLED",
  "EMAIL_SEND_ENABLED",
  "YCLIENTS_MUTATIONS_ENABLED",
  "MOYSKLAD_MUTATIONS_ENABLED",
  "ROSSKO_ORDER_ENABLED",
]) {
  if (process.env[name] !== "false") errors.push(`${name} must equal false`);
}
if (errors.length) {
  console.error(`Branch migration preflight NO-GO:\n- ${errors.join("\n- ")}`);
  process.exit(1);
}
const hostname = new URL(databaseUrl).hostname;
console.log(`Branch migration rehearsal preflight passed for ${hostname}. No migration was executed.`);
