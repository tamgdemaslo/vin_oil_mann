import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const errors = [];
if (!databaseUrl) errors.push("DATABASE_URL is required");
if (/railway/i.test(databaseUrl)) errors.push("Railway database is forbidden");
if (process.env.APP_ENV !== "branch-migration-rehearsal") errors.push("APP_ENV must equal branch-migration-rehearsal");
if (process.env.EXTERNAL_SIDE_EFFECTS_ENABLED !== "false") errors.push("EXTERNAL_SIDE_EFFECTS_ENABLED must equal false");
if (process.env.BRANCH_FILE_MANIFEST_DRY_RUN !== "true") errors.push("BRANCH_FILE_MANIFEST_DRY_RUN must equal true");
if (errors.length) {
  console.error(`File migration manifest refused:\n- ${errors.join("\n- ")}`);
  process.exit(1);
}

const outputPath = path.resolve(process.env.BRANCH_FILE_MANIFEST_OUTPUT || "docs/branch-file-legacy-migration-manifest.csv");
const prisma = new PrismaClient();

function proposedKey(branchId, entityType, containerId, oldKey) {
  if (/(?:^|\/)branches\//.test(oldKey)) return oldKey;
  const file = path.basename(oldKey);
  if (entityType.startsWith("diagnostic")) return `branches/${branchId}/diagnostics/${containerId}/${file}`;
  return `branches/${branchId}/${oldKey.replace(/^\/+/, "")}`;
}

async function localMetadata(oldKey, newKey) {
  try {
    const bytes = await fsp.readFile(oldKey);
    const conflict = fs.existsSync(newKey) ? "TARGET_EXISTS" : "CLEAR";
    return { size: bytes.byteLength, checksum: crypto.createHash("sha256").update(bytes).digest("hex"), conflict };
  } catch {
    return { size: null, checksum: null, conflict: "SOURCE_MISSING" };
  }
}

function csv(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

try {
  const [classic, mapPhotos, vehiclePhotos, messenger] = await Promise.all([
    /* branch-audit: MIGRATION_ONLY reason="read-only legacy file manifest on guarded rehearsal copy" */
    prisma.$queryRawUnsafe(`SELECT d.branch_id AS "branchId", p.file_path AS "oldKey", 'diagnostic-photos' AS "entityType", p.id AS "entityId", d.id AS "containerId" FROM diagnostic_photos p JOIN diagnostic_positions dp ON dp.id = p.position_id AND dp.branch_id = p.branch_id JOIN diagnostics d ON d.id = dp.diagnostic_id AND d.branch_id = dp.branch_id WHERE p.file_path IS NOT NULL AND p.file_path <> ''`),
    /* branch-audit: MIGRATION_ONLY reason="read-only legacy file manifest on guarded rehearsal copy" */
    prisma.$queryRawUnsafe(`SELECT s.branch_id AS "branchId", p.file_path AS "oldKey", 'diagnostic-map-photos' AS "entityType", p.id AS "entityId", s.id AS "containerId" FROM diagnostic_map_photos p JOIN diagnostic_map_items i ON i.id = p.item_id AND i.branch_id = p.branch_id JOIN diagnostic_map_sessions s ON s.id = i.session_id AND s.branch_id = i.branch_id WHERE p.file_path IS NOT NULL AND p.file_path <> ''`),
    /* branch-audit: MIGRATION_ONLY reason="read-only legacy file manifest on guarded rehearsal copy" */
    prisma.$queryRawUnsafe(`SELECT s.branch_id AS "branchId", p.file_path AS "oldKey", 'diagnostic-vehicle-photos' AS "entityType", p.id AS "entityId", s.id AS "containerId" FROM diagnostic_map_vehicle_photos p JOIN diagnostic_map_sessions s ON s.id = p.session_id AND s.branch_id = p.branch_id WHERE p.file_path IS NOT NULL AND p.file_path <> ''`),
    /* branch-audit: MIGRATION_ONLY reason="read-only legacy object manifest on guarded rehearsal copy" */
    prisma.$queryRawUnsafe(`SELECT branch_id AS "branchId", original_storage_key AS "oldKey", 'messenger' AS "entityType", id AS "entityId", size FROM messenger_attachments WHERE original_storage_key IS NOT NULL AND original_storage_key <> ''`),
  ]);
  const rows = [];
  for (const row of [...classic, ...mapPhotos, ...vehiclePhotos]) {
    const newKey = proposedKey(row.branchId, row.entityType, row.containerId, row.oldKey);
    const storageRoot = row.entityType === "diagnostic-photos"
      ? (process.env.DIAGNOSTIC_PHOTOS_PATH || path.join(process.cwd(), ".data", "diagnostic-photos"))
      : (process.env.DIAGNOSTIC_MAP_PHOTOS_PATH || path.join(process.cwd(), ".data", "diagnostic-map-photos"));
    const newDiskPath = path.join(storageRoot, newKey);
    const metadata = await localMetadata(row.oldKey, newDiskPath);
    rows.push({ ...row, newKey, size: metadata.size, checksum: metadata.checksum, conflictStatus: newKey === row.oldKey ? "ALREADY_SCOPED" : metadata.conflict });
  }
  for (const row of messenger) {
    const newKey = proposedKey(row.branchId, row.entityType, row.entityId, row.oldKey);
    rows.push({ ...row, newKey, checksum: null, conflictStatus: newKey === row.oldKey ? "ALREADY_SCOPED" : "OBJECT_HEAD_REQUIRED" });
  }
  const header = ["oldKey", "newKey", "branchId", "entityType", "entityId", "size", "checksum", "conflictStatus"];
  const csvText = [header, ...rows.map((row) => header.map((key) => row[key]))].map((row) => row.map(csv).join(",")).join("\n") + "\n";
  await fsp.writeFile(outputPath, csvText, { flag: "wx" });
  console.log(`Dry-run file manifest written: ${outputPath} (${rows.length} rows). No file or object was moved.`);
} finally {
  await prisma.$disconnect();
}
