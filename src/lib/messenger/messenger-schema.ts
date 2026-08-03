import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

let ensurePromise: Promise<void> | null = null;

const REQUIRED_MESSENGER_TABLES = [
  "messenger_accounts",
  "messenger_connections",
  "telegram_user_sessions",
  "messenger_conversations",
  "messenger_messages",
  "messenger_outbox",
  "messenger_webhook_events",
  "messenger_attachments",
  "messenger_media_jobs",
] as const;

/**
 * Runtime requests must never create, alter, or backfill application tables.
 * Schema changes belong to reviewed Prisma migrations. This check is global
 * metadata-only and fails closed when a required migration is missing.
 */
export async function ensureMessengerIntegrationCoreSchema() {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      /* branch-audit: GLOBAL_SAFE reason="PostgreSQL catalog readiness check; no application rows are read" */
      const rows = await prisma.$queryRaw<Array<{ tableName: string }>>(Prisma.sql`
        SELECT c.relname AS "tableName"
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = current_schema()
          AND c.relkind IN ('r', 'p')
          AND c.relname IN (${Prisma.join([...REQUIRED_MESSENGER_TABLES])})
      `);
      const present = new Set(rows.map((row) => row.tableName));
      const missing = REQUIRED_MESSENGER_TABLES.filter((table) => !present.has(table));
      if (missing.length) {
        throw new Error(`Messenger schema migration required: ${missing.join(", ")}`);
      }
    })().catch((error) => {
      ensurePromise = null;
      throw error;
    });
  }
  await ensurePromise;
}
