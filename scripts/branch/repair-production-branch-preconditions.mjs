import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const FOUNDATION_MIGRATION = "20260728120000_branch_architecture_foundation";
const FAILED_FOUNDATION_CHECKSUM = "14de5716128ff19ba5acf6df3f9f25902179b3d0f05d23b1d8137cab45051d8b";
const KNOWN_LABEL = "ЭКО-20260605-008";
const EXPECTED_REHEARSAL_DUPLICATE_STATS = {
  duplicateGroups: 795,
  rowsInGroups: 1591,
  excessRows: 796,
};
const REQUIRED_DISABLED_FLAGS = [
  "EXTERNAL_SIDE_EFFECTS_ENABLED",
  "TELEGRAM_SEND_ENABLED",
  "WEBHOOK_PROCESSING_ENABLED",
  "PAYMENT_MUTATIONS_ENABLED",
  "TBANK_MUTATIONS_ENABLED",
  "SUPPLIER_ORDER_ENABLED",
  "ROSSKO_ORDER_ENABLED",
  "EMAIL_SEND_ENABLED",
  "YCLIENTS_MUTATIONS_ENABLED",
  "MOYSKLAD_MUTATIONS_ENABLED",
  "CRON_ENABLED",
  "WORKERS_ENABLED",
  "QUEUE_CONSUMER_ENABLED",
];

function fail(message) {
  console.error(`Branch precondition repair NO-GO: ${message}`);
  process.exit(1);
}

function integer(value) {
  return typeof value === "bigint" ? Number(value) : Number(value ?? 0);
}

function iso(value) {
  return value instanceof Date ? value.toISOString() : String(value);
}

function opaque(value) {
  if (!value) return null;
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function parseMode() {
  const apply = process.argv.includes("--apply");
  const dryRun = process.argv.includes("--dry-run");
  if (apply && dryRun) fail("choose only one of --dry-run or --apply");
  const unsupported = process.argv.slice(2).filter((arg) => arg !== "--apply" && arg !== "--dry-run");
  if (unsupported.length) fail(`unsupported arguments: ${unsupported.join(", ")}`);
  return apply ? "apply" : "dry-run";
}

const mode = parseMode();
const appEnv = process.env.APP_ENV?.trim();
const provider = process.env.DEPLOYMENT_PROVIDER?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";

if (!new Set(["branch-migration-rehearsal", "production"]).has(appEnv)) {
  fail("APP_ENV must be branch-migration-rehearsal or production");
}
if (!new Set(["selectel-rehearsal", "selectel"]).has(provider)) {
  fail("DEPLOYMENT_PROVIDER must be selectel-rehearsal or selectel");
}
if (!databaseUrl) fail("DATABASE_URL is required");
if (/railway|rlwy\.net/i.test(databaseUrl)) fail("decommissioned database URLs are forbidden");
if (process.env.BRANCH_PRECONDITION_REPAIR_ENABLED !== "true") {
  fail("BRANCH_PRECONDITION_REPAIR_ENABLED must equal true");
}
for (const name of REQUIRED_DISABLED_FLAGS) {
  if (process.env[name] !== "false") fail(`${name} must equal false`);
}
if (mode === "apply" && process.env.BRANCH_PRECONDITION_REPAIR_APPLY !== "true") {
  fail("--apply requires BRANCH_PRECONDITION_REPAIR_APPLY=true");
}
if (
  mode === "apply" &&
  appEnv === "production" &&
  process.env.PRODUCTION_BRANCH_REPAIR_CONFIRMATION !== "APPLY_SELECTEL_BRANCH_PRECONDITIONS"
) {
  fail("production apply requires the explicit production confirmation literal");
}

const migrationPath = path.resolve("prisma/migrations", FOUNDATION_MIGRATION, "migration.sql");
if (!fs.existsSync(migrationPath)) fail(`migration file is missing: ${migrationPath}`);
const migrationSql = fs.readFileSync(migrationPath, "utf8");
const repositoryFoundationChecksum = sha256(migrationSql);
if (/CREATE\s+UNIQUE\s+INDEX[^;]*local_demands_branch_id_name/isu.test(migrationSql)) {
  fail("repository foundation still treats local_demands.name as a unique identity");
}
if (!migrationSql.includes('CREATE INDEX IF NOT EXISTS "local_demands_branch_id_name_idx"')) {
  fail("repository foundation is missing the non-unique shipment-label lookup index");
}

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

try {
  const [environment] = await prisma.$queryRawUnsafe(`
    SELECT current_database() AS database,
           inet_server_addr()::text AS "serverAddress",
           current_setting('server_version') AS "serverVersion"
  `);
  if (appEnv === "branch-migration-rehearsal") {
    if (!environment.database.includes("rehearsal")) fail("rehearsal database name must contain rehearsal");
    if (environment.serverAddress !== null) fail("rehearsal must use an isolated Unix-socket PostgreSQL connection");
  }

  const journal = await prisma.$queryRawUnsafe(`
    SELECT migration_name AS name,
           checksum,
           finished_at AS "finishedAt",
           rolled_back_at AS "rolledBackAt",
           applied_steps_count AS "appliedSteps"
      FROM _prisma_migrations
     WHERE migration_name = '${FOUNDATION_MIGRATION}'
     ORDER BY started_at DESC
  `);
  const failedAttempt = journal.find(
    (row) => row.checksum === FAILED_FOUNDATION_CHECKSUM && row.finishedAt === null && row.rolledBackAt === null,
  );
  const alreadyResolved = journal.some(
    (row) => row.checksum === FAILED_FOUNDATION_CHECKSUM && row.rolledBackAt !== null,
  );
  const currentApplied = journal.some(
    (row) => row.checksum === repositoryFoundationChecksum && row.finishedAt !== null && row.rolledBackAt === null,
  );
  if (!failedAttempt && !alreadyResolved && !currentApplied) {
    fail("foundation journal state is neither the audited failed attempt nor an idempotent completed state");
  }
  if (failedAttempt && integer(failedAttempt.appliedSteps) !== 0) {
    fail("the failed foundation attempt is not the audited zero-step attempt");
  }

  const [duplicateStats] = await prisma.$queryRawUnsafe(`
    WITH groups AS (
      SELECT name, count(*)::bigint AS rows
        FROM local_demands
       GROUP BY name
      HAVING count(*) > 1
    )
    SELECT count(*)::bigint AS "duplicateGroups",
           coalesce(sum(rows), 0)::bigint AS "rowsInGroups",
           coalesce(sum(rows - 1), 0)::bigint AS "excessRows"
      FROM groups
  `);
  const stats = {
    duplicateGroups: integer(duplicateStats.duplicateGroups),
    rowsInGroups: integer(duplicateStats.rowsInGroups),
    excessRows: integer(duplicateStats.excessRows),
  };
  if (appEnv === "branch-migration-rehearsal") {
    for (const [key, expected] of Object.entries(EXPECTED_REHEARSAL_DUPLICATE_STATS)) {
      if (stats[key] !== expected) fail(`fresh Selectel duplicate baseline changed: ${key}=${stats[key]}, expected ${expected}`);
    }
  }

  const rows = await prisma.$queryRawUnsafe(`
    SELECT d.id,
           d.name,
           d.created_at AS "createdAt",
           d.updated_at AS "updatedAt",
           d.applicable,
           d.counterparty_id AS "counterpartyId",
           d.moysklad_id AS "moyskladId",
           d.organization_id AS "organizationId",
           d.sum_cents AS "sumCents",
           coalesce(d.raw->'state'->>'name', '') AS "sourceStatus",
           (SELECT count(*)::int FROM local_demand_positions p WHERE p.demand_id = d.id) AS "positionCount",
           (SELECT md5(coalesce(string_agg(concat_ws(':', coalesce(p.product_id, ''),
                                                    coalesce(p.moysklad_position_id, ''), p.quantity,
                                                    p.price_cents_per_unit, p.discount), ',' ORDER BY p.id), ''))
              FROM local_demand_positions p WHERE p.demand_id = d.id) AS "positionFingerprint",
           (SELECT count(*)::int FROM shipment_revisions r WHERE r.shipment_id = d.id) AS "revisionCount",
           (SELECT count(*)::int FROM closing_documents c WHERE c.shipment_id = d.id) AS "closingDocumentCount",
           (SELECT count(*)::int FROM inventory_ledger_entries i WHERE i.shipment_id = d.id) AS "ledgerReferenceCount",
           (SELECT count(*)::int FROM diagnostic_map_sessions s WHERE s.demand_id = d.id) AS "vehicleSessionCount",
           (SELECT count(*)::int FROM diagnostics x WHERE x.shipment_moysklad_id = d.moysklad_id
                                                    AND d.moysklad_id IS NOT NULL) AS "diagnosticCount",
           (SELECT count(DISTINCT r.created_by_id)::int FROM shipment_revisions r
             WHERE r.shipment_id = d.id AND r.created_by_id IS NOT NULL) AS "revisionCreatorCount",
           (SELECT count(DISTINCT c.created_by_id)::int FROM closing_documents c
             WHERE c.shipment_id = d.id AND c.created_by_id IS NOT NULL) AS "documentCreatorCount"
      FROM local_demands d
     WHERE d.name = '${KNOWN_LABEL}'
     ORDER BY d.created_at, d.id
  `);
  if (rows.length !== 2) fail(`expected two known ${KNOWN_LABEL} rows, got ${rows.length}`);

  const cards = rows.map((row) => ({
    table: "local_demands",
    primaryKey: row.id,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    status: row.sourceStatus || (row.applicable ? "applicable" : "not_applicable"),
    clientRelation: row.counterpartyId ? { linked: true, opaqueRef: opaque(row.counterpartyId) } : { linked: false },
    vehicleRelation: {
      diagnosticMapSessions: integer(row.vehicleSessionCount),
      diagnostics: integer(row.diagnosticCount),
    },
    amountCents: integer(row.sumCents),
    positionCount: integer(row.positionCount),
    positionFingerprint: row.positionFingerprint,
    revisionCount: integer(row.revisionCount),
    externalIds: { moyskladId: row.moyskladId ? opaque(row.moyskladId) : null },
    creator: {
      revisionActors: integer(row.revisionCreatorCount),
      documentActors: integer(row.documentCreatorCount),
      directlyRecorded: false,
    },
    usedByOtherDocuments: {
      closingDocuments: integer(row.closingDocumentCount),
      inventoryLedgerEntries: integer(row.ledgerReferenceCount),
      diagnosticMapSessions: integer(row.vehicleSessionCount),
      diagnostics: integer(row.diagnosticCount),
    },
    organizationRef: opaque(row.organizationId),
  }));
  if (
    cards[0].amountCents === cards[1].amountCents ||
    cards[0].positionFingerprint === cards[1].positionFingerprint ||
    cards[0].clientRelation.opaqueRef === cards[1].clientRelation.opaqueRef
  ) {
    fail(`${KNOWN_LABEL} no longer matches the audited distinct-business-entity classification`);
  }

  const auditRows = cards.map((card) => {
    const sourceFingerprint = sha256(JSON.stringify(card));
    return {
      entity: "local_demands",
      entityId: card.primaryKey,
      oldValue: KNOWN_LABEL,
      newValue: KNOWN_LABEL,
      reason: "DISTINCT_BUSINESS_ENTITY; DISPLAY_LABEL_IS_NOT_IDENTITY; PRESERVE_BUSINESS_DOCUMENT",
      canonicalRelation: `self:${card.primaryKey}`,
      auditMarker: `branch-precondition:local_demands:${card.primaryKey}:display-label:v1`,
      sourceFingerprint,
    };
  });

  let auditMutationsApplied = 0;
  if (mode === "apply") {
    auditMutationsApplied = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(20260728120000)`);
      await tx.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS branch_precondition_repair_audit (
          audit_marker TEXT PRIMARY KEY,
          entity TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          old_value TEXT NOT NULL,
          new_value TEXT NOT NULL,
          reason TEXT NOT NULL,
          canonical_relation TEXT NOT NULL,
          source_fingerprint TEXT NOT NULL,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      let inserted = 0;
      for (const operation of auditRows) {
        const existing = await tx.$queryRawUnsafe(
          `SELECT entity, entity_id AS "entityId", old_value AS "oldValue", new_value AS "newValue",
                  reason, canonical_relation AS "canonicalRelation", source_fingerprint AS "sourceFingerprint"
             FROM branch_precondition_repair_audit WHERE audit_marker = $1`,
          operation.auditMarker,
        );
        if (existing.length) {
          const expected = { ...operation };
          delete expected.auditMarker;
          if (JSON.stringify(existing[0]) !== JSON.stringify(expected)) {
            throw new Error(`audit marker payload mismatch: ${operation.auditMarker}`);
          }
          continue;
        }
        inserted += await tx.$executeRawUnsafe(
          `INSERT INTO branch_precondition_repair_audit
             (audit_marker, entity, entity_id, old_value, new_value, reason, canonical_relation, source_fingerprint)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          operation.auditMarker,
          operation.entity,
          operation.entityId,
          operation.oldValue,
          operation.newValue,
          operation.reason,
          operation.canonicalRelation,
          operation.sourceFingerprint,
        );
      }
      return inserted;
    });
  }

  console.log(JSON.stringify({
    status: "PASS",
    mode,
    environment: {
      appEnv,
      provider,
      database: environment.database,
      serverVersion: environment.serverVersion,
      unixSocketOnly: environment.serverAddress === null,
    },
    migrationGuard: {
      migration: FOUNDATION_MIGRATION,
      failedChecksum: FAILED_FOUNDATION_CHECKSUM,
      repositoryChecksum: repositoryFoundationChecksum,
      failedAttemptPresent: Boolean(failedAttempt),
      failedAttemptAlreadyResolved: alreadyResolved,
      currentMigrationApplied: currentApplied,
      failedMigrationFileModifiedByThisScript: false,
      shipmentLabelIndex: "NON_UNIQUE_LOOKUP_INDEX",
    },
    selectelOnlyPreflight: {
      trueBlockingUniqueConflictsForCurrentMigration: 0,
      repeatedShipmentDisplayLabels: stats,
      knownConflict: KNOWN_LABEL,
      classification: "DISTINCT_BUSINESS_ENTITIES_SHARED_DISPLAY_LABEL",
      resolution: "PRESERVE_BOTH; STABLE_IDS_REMAIN_CANONICAL; NO_BUSINESS_ROW_MUTATION",
      cards,
    },
    plan: auditRows,
    result: {
      businessMutationsPlanned: 0,
      businessMutationsApplied: 0,
      auditMutationsApplied,
      idempotent: true,
    },
  }, null, 2));
} finally {
  await prisma.$disconnect();
}
