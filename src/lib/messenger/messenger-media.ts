import crypto from "crypto";
import { prisma } from "@/lib/db";
import { ensureMessengerIntegrationCoreSchema } from "./messenger-schema";
import { getMessengerOrganizationId } from "./messenger-tenant";
import { messengerStorageStatus } from "./messenger-storage";
import { isPhotoAttachmentType, normalizeMessengerAttachment, normalizeMessengerAttachmentType } from "./messenger-attachment-normalization";
import type { Attachment } from "./messenger-types";

type MediaJobOperation = "download" | "upload" | "thumbnail" | "backfill";
type MediaJobStatus = "queued" | "processing" | "completed" | "failed";

type MediaJobRow = {
  id: string;
  organizationId: string;
  messengerAccountId: string | null;
  attachmentId: string;
  operation: MediaJobOperation;
  status: MediaJobStatus;
  attempts: number;
  lockedAt: Date | null;
  lockedBy: string | null;
  nextAttemptAt: Date | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type AttachmentProjectionRow = {
  id: string;
  type: string;
  url: string | null;
  name: string | null;
  size: number | null;
  mimeType: string | null;
  previewUrl: string | null;
  originalStorageKey: string | null;
  thumbnailStorageKey: string | null;
  status: string;
  progress: number;
  errorCode: string | null;
  errorMessage: string | null;
  caption: string | null;
  width: number | null;
  height: number | null;
  duration: number | null;
};

let inProcessWorkerStarted = false;
let inProcessWorkerBusy = false;
let lastHeartbeatAt: Date | null = null;

function mediaErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/Object storage|storage.+not configured|storage_not_configured/i.test(message)) return "storage_not_configured";
  if (/TIMEOUT|timeout|not connected|connection closed|reconnect/i.test(message)) return "telegram_timeout";
  if (/too large|file size/i.test(message)) return "too_large";
  return "media_download_failed";
}

function jobWorkerId() {
  return `next-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
}

function retryAt(attempts: number) {
  const minutes = Math.min(60, Math.max(1, 2 ** Math.min(attempts, 5)));
  return new Date(Date.now() + minutes * 60_000);
}

function attachmentStatusForClient(status: string): Attachment["status"] {
  if (status === "ready") return "available";
  if (status === "queued" || status === "downloading") return "downloading";
  if (status === "too_large") return "too_large";
  if (status === "unsupported") return "unsupported";
  if (status === "failed") return "failed";
  return "pending";
}

function attachmentProxyUrls(row: AttachmentProjectionRow) {
  const type = normalizeMessengerAttachmentType(row);
  const contentUrl =
    row.originalStorageKey || row.url ? `/api/messenger/attachments/${encodeURIComponent(row.id)}/content` : row.url ?? undefined;
  const thumbnailUrl =
    row.thumbnailStorageKey || (isPhotoAttachmentType(type) && row.originalStorageKey) || row.previewUrl
      ? `/api/messenger/attachments/${encodeURIComponent(row.id)}/thumbnail`
      : undefined;
  return { contentUrl, thumbnailUrl };
}

function toAttachment(row: AttachmentProjectionRow): Attachment {
  const urls = attachmentProxyUrls(row);
  return normalizeMessengerAttachment({
    id: row.id,
    type: row.type,
    url: urls.contentUrl,
    previewUrl: urls.thumbnailUrl,
    name: row.name ?? undefined,
    size: row.size ?? undefined,
    mimeType: row.mimeType ?? undefined,
    status: attachmentStatusForClient(row.status),
    progress: row.progress,
    caption: row.caption ?? undefined,
    width: row.width ?? undefined,
    height: row.height ?? undefined,
    duration: row.duration ?? undefined,
    errorCode: row.errorCode ?? undefined,
    errorMessage: row.errorMessage ?? undefined,
  });
}

export async function listMessageAttachmentProjection(messageId: string): Promise<Attachment[]> {
  await ensureMessengerIntegrationCoreSchema();
  const rows = await prisma.$queryRaw<AttachmentProjectionRow[]>`
    SELECT
      id,
      type,
      url,
      name,
      size,
      mime_type AS "mimeType",
      preview_url AS "previewUrl",
      original_storage_key AS "originalStorageKey",
      thumbnail_storage_key AS "thumbnailStorageKey",
      status,
      progress,
      error_code AS "errorCode",
      error_message AS "errorMessage",
      caption,
      width,
      height,
      duration
    FROM messenger_attachments
    WHERE message_id = ${messageId}
      AND organization_id = ${getMessengerOrganizationId()}
    ORDER BY created_at ASC, id ASC
  `;
  return rows.map(toAttachment);
}

export async function refreshMessageAttachmentsJson(messageId: string) {
  const attachments = await listMessageAttachmentProjection(messageId);
  await prisma.$executeRaw`
    UPDATE messenger_messages
    SET attachments_json = ${JSON.stringify(attachments)}::jsonb,
        updated_at = now()
    WHERE id = ${messageId}
      AND organization_id = ${getMessengerOrganizationId()}
  `;
  return attachments;
}

export async function enqueueMessengerMediaJob(input: {
  organizationId?: string;
  messengerAccountId?: string | null;
  attachmentId: string;
  operation: MediaJobOperation;
}) {
  await ensureMessengerIntegrationCoreSchema();
  const organizationId = input.organizationId ?? getMessengerOrganizationId();
  const existing = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM messenger_media_jobs
    WHERE organization_id = ${organizationId}
      AND attachment_id = ${input.attachmentId}
      AND operation = ${input.operation}
      AND status IN ('queued', 'processing')
    LIMIT 1
  `;
  if (existing[0]?.id) {
    kickMessengerMediaWorker();
    return existing[0].id;
  }
  const id = crypto.randomUUID();
  await prisma.$executeRaw`
    INSERT INTO messenger_media_jobs
      (id, organization_id, messenger_account_id, attachment_id, operation, status, created_at, updated_at)
    VALUES
      (${id}, ${organizationId}, ${input.messengerAccountId ?? null}, ${input.attachmentId}, ${input.operation}, 'queued', now(), now())
  `;
  kickMessengerMediaWorker();
  return id;
}

async function claimMessengerMediaJobs(limit: number, workerId: string) {
  await ensureMessengerIntegrationCoreSchema();
  const organizationId = getMessengerOrganizationId();
  return prisma.$queryRaw<MediaJobRow[]>`
    WITH next_jobs AS (
      SELECT id
      FROM messenger_media_jobs
      WHERE organization_id = ${organizationId}
        AND (
          status = 'queued'
          OR (status = 'processing' AND locked_at < now() - interval '10 minutes')
          OR (status = 'failed' AND next_attempt_at IS NOT NULL AND next_attempt_at <= now() AND attempts < 5)
        )
      ORDER BY created_at ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE messenger_media_jobs mj
    SET status = 'processing',
        locked_at = now(),
        locked_by = ${workerId},
        attempts = mj.attempts + 1,
        last_attempt_at = now(),
        updated_at = now()
    FROM next_jobs
    WHERE mj.id = next_jobs.id
    RETURNING
      mj.id,
      mj.organization_id AS "organizationId",
      mj.messenger_account_id AS "messengerAccountId",
      mj.attachment_id AS "attachmentId",
      mj.operation,
      mj.status,
      mj.attempts,
      mj.locked_at AS "lockedAt",
      mj.locked_by AS "lockedBy",
      mj.next_attempt_at AS "nextAttemptAt",
      mj.error_code AS "errorCode",
      mj.error_message AS "errorMessage",
      mj.created_at AS "createdAt",
      mj.updated_at AS "updatedAt"
  `;
}

async function completeJob(job: MediaJobRow) {
  await prisma.$executeRaw`
    UPDATE messenger_media_jobs
    SET status = 'completed',
        locked_at = NULL,
        locked_by = NULL,
        error_code = NULL,
        error_message = NULL,
        updated_at = now()
    WHERE id = ${job.id}
  `;
}

async function failJob(job: MediaJobRow, error: unknown) {
  const message = error instanceof Error ? error.message : "Messenger media job failed";
  const errorCode = mediaErrorCode(error);
  const nextAttemptAt = retryAt(job.attempts);
  await prisma.$executeRaw`
    UPDATE messenger_media_jobs
    SET status = 'failed',
        locked_at = NULL,
        locked_by = NULL,
        next_attempt_at = ${job.attempts < 5 ? nextAttemptAt : null},
        error_code = ${errorCode},
        error_message = ${message.slice(0, 1000)},
        updated_at = now()
    WHERE id = ${job.id}
  `;
  await prisma.$executeRaw`
    UPDATE messenger_attachments
    SET status = CASE WHEN ${job.attempts} >= 5 THEN 'failed' ELSE status END,
        attempts = attempts + 1,
        last_attempt_at = now(),
        next_attempt_at = ${job.attempts < 5 ? nextAttemptAt : null},
        error_code = ${errorCode},
        error_message = ${message.slice(0, 1000)},
        updated_at = now()
    WHERE id = ${job.attachmentId}
      AND organization_id = ${job.organizationId}
  `;
  const rows = await prisma.$queryRaw<Array<{ messageId: string }>>`
    SELECT message_id AS "messageId"
    FROM messenger_attachments
    WHERE id = ${job.attachmentId}
      AND organization_id = ${job.organizationId}
    LIMIT 1
  `;
  if (rows[0]?.messageId) await refreshMessageAttachmentsJson(rows[0].messageId).catch(() => {});
}

async function processJob(job: MediaJobRow) {
  if (job.operation === "download" || job.operation === "backfill") {
    const { downloadTelegramAttachmentMedia } = await import("./channels/telegram-user-session");
    await downloadTelegramAttachmentMedia(job.attachmentId);
    return;
  }
  if (job.operation === "thumbnail") {
    const rows = await prisma.$queryRaw<Array<{ messageId: string }>>`
      SELECT message_id AS "messageId"
      FROM messenger_attachments
      WHERE id = ${job.attachmentId}
        AND organization_id = ${job.organizationId}
      LIMIT 1
    `;
    if (rows[0]?.messageId) await refreshMessageAttachmentsJson(rows[0].messageId);
    return;
  }
  throw new Error(`Messenger media operation ${job.operation} не поддерживается`);
}

export async function processMessengerMediaJobs(input: { limit?: number; workerId?: string } = {}) {
  const workerId = input.workerId ?? jobWorkerId();
  const jobs = await claimMessengerMediaJobs(input.limit ?? 5, workerId);
  const processed: Array<{ id: string; ok: boolean; error?: string }> = [];
  for (const job of jobs) {
    lastHeartbeatAt = new Date();
    try {
      await processJob(job);
      await completeJob(job);
      processed.push({ id: job.id, ok: true });
    } catch (error) {
      await failJob(job, error);
      processed.push({ id: job.id, ok: false, error: error instanceof Error ? error.message : "failed" });
    }
  }
  return { ok: true as const, processed };
}

export function kickMessengerMediaWorker() {
  if (typeof window !== "undefined") return;
  if (process.env.MESSENGER_MEDIA_IN_PROCESS_WORKER === "false") return;
  if (inProcessWorkerStarted) return;
  inProcessWorkerStarted = true;
  const tick = async () => {
    if (inProcessWorkerBusy) return;
    inProcessWorkerBusy = true;
    try {
      await processMessengerMediaJobs({ limit: 3, workerId: `in-process-${process.pid}` });
    } catch (error) {
      console.warn("[messenger.media.worker]", {
        action: "tick_failed",
        error: error instanceof Error ? error.message : "media worker failed",
      });
    } finally {
      lastHeartbeatAt = new Date();
      inProcessWorkerBusy = false;
    }
  };
  const interval = setInterval(() => void tick(), Number(process.env.MESSENGER_MEDIA_WORKER_INTERVAL_MS ?? 15_000));
  interval.unref?.();
  void tick();
}

export async function repairMessengerAttachmentMetadata(limit = 500) {
  await ensureMessengerIntegrationCoreSchema();
  const organizationId = getMessengerOrganizationId();
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      messageId: string;
      type: string;
      name: string | null;
      mimeType: string | null;
      metadataJson: Record<string, unknown> | null;
    }>
  >`
    SELECT
      id,
      message_id AS "messageId",
      type,
      name,
      mime_type AS "mimeType",
      metadata_json AS "metadataJson"
    FROM messenger_attachments
    WHERE organization_id = ${organizationId}
      AND (
        type IN ('image', 'file', 'document', 'audio')
        OR name IS NULL
        OR name ~* '^(attachment|photo|video|voice|audio|document)-telegram:message:'
        OR mime_type LIKE 'image/%'
        OR mime_type LIKE 'video/%'
        OR mime_type LIKE 'audio/%'
      )
    ORDER BY updated_at DESC
    LIMIT ${limit}
  `;
  let repaired = 0;
  const refreshed = new Set<string>();
  for (const row of rows) {
    const normalized = normalizeMessengerAttachment({
      id: row.id,
      type: row.type,
      name: row.name ?? undefined,
      mimeType: row.mimeType ?? undefined,
      metadataJson: row.metadataJson ?? undefined,
    });
    if (normalized.type === row.type && (normalized.name ?? null) === row.name) continue;
    await prisma.$executeRaw`
      UPDATE messenger_attachments
      SET type = ${normalized.type},
          name = ${normalized.name ?? row.name},
          updated_at = now()
      WHERE id = ${row.id}
        AND organization_id = ${organizationId}
    `;
    repaired += 1;
    refreshed.add(row.messageId);
  }
  for (const messageId of refreshed) {
    await refreshMessageAttachmentsJson(messageId).catch(() => {});
  }
  return { repaired, scanned: rows.length };
}

export async function backfillTelegramMedia(limit = 50) {
  await ensureMessengerIntegrationCoreSchema();
  const organizationId = getMessengerOrganizationId();
  const repair = await repairMessengerAttachmentMetadata(Math.max(100, limit * 5));
  const rows = await prisma.$queryRaw<Array<{ id: string; messengerAccountId: string | null }>>`
    SELECT id, messenger_account_id AS "messengerAccountId"
    FROM messenger_attachments
    WHERE organization_id = ${organizationId}
      AND channel = 'telegram'
      AND status IN ('pending', 'queued', 'downloading', 'failed')
      AND (original_storage_key IS NULL OR original_storage_key = '')
    ORDER BY created_at ASC
    LIMIT ${limit}
  `;
  for (const row of rows) {
    await enqueueMessengerMediaJob({
      organizationId,
      messengerAccountId: row.messengerAccountId,
      attachmentId: row.id,
      operation: "backfill",
    });
  }
  return { ok: true as const, enqueued: rows.length, repaired: repair.repaired, scanned: repair.scanned };
}

export async function getMessengerMediaHealth() {
  await ensureMessengerIntegrationCoreSchema();
  const organizationId = getMessengerOrganizationId();
  const rows = await prisma.$queryRaw<
    Array<{
      pendingJobs: number;
      processingJobs: number;
      failedJobs: number;
      oldestPendingAt: Date | null;
      lastCompletedAt: Date | null;
      lastActivityAt: Date | null;
    }>
  >`
    WITH jobs AS (
      SELECT
        COUNT(*) FILTER (WHERE status = 'queued')::int AS "pendingJobs",
        COUNT(*) FILTER (WHERE status = 'processing')::int AS "processingJobs",
        MIN(created_at) FILTER (WHERE status = 'queued') AS "oldestPendingAt",
        MAX(updated_at) FILTER (WHERE status = 'completed') AS "lastCompletedAt",
        MAX(updated_at) FILTER (WHERE status IN ('completed', 'processing')) AS "lastActivityAt"
      FROM messenger_media_jobs
      WHERE organization_id = ${organizationId}
    ),
    attachments AS (
      SELECT COUNT(*) FILTER (WHERE status = 'failed')::int AS "failedJobs"
      FROM messenger_attachments
      WHERE organization_id = ${organizationId}
        AND channel = 'telegram'
    )
    SELECT
      jobs."pendingJobs",
      jobs."processingJobs",
      attachments."failedJobs",
      jobs."oldestPendingAt",
      jobs."lastCompletedAt",
      jobs."lastActivityAt"
    FROM jobs, attachments
  `;
  const storage = messengerStorageStatus();
  const lastActivityAt = rows[0]?.lastActivityAt ?? rows[0]?.lastCompletedAt ?? null;
  const workerAlive = Boolean(
    (lastHeartbeatAt && Date.now() - lastHeartbeatAt.getTime() < 90_000) ||
      (lastActivityAt && Date.now() - lastActivityAt.getTime() < 5 * 60_000)
  );
  return {
    storage,
    storageConnected: storage.configured,
    workerAlive,
    workerHeartbeatAt: lastHeartbeatAt?.toISOString() ?? lastActivityAt?.toISOString() ?? null,
    pendingJobs: rows[0]?.pendingJobs ?? 0,
    processingJobs: rows[0]?.processingJobs ?? 0,
    failedJobs: rows[0]?.failedJobs ?? 0,
    oldestPendingAt: rows[0]?.oldestPendingAt?.toISOString() ?? null,
    lastCompletedAt: rows[0]?.lastCompletedAt?.toISOString() ?? null,
  };
}
