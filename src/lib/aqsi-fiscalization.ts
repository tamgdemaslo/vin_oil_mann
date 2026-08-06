import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { syncAqsiPendingOrder, type SyncAqsiPendingOrderInput } from "@/lib/aqsi";
import { resolveAqsiCashRegister, safeAqsiError } from "@/lib/aqsi-integration";
import { getRequestTenant, getScopedBranchId } from "@/lib/request-tenant-store";
import { notifyIntegrationOwner } from "@/lib/integration-owner-notifications";

const PROCESSING_LEASE_MS = 2 * 60_000;

function tenantOrThrow() {
  const tenant = getRequestTenant();
  const branchId = getScopedBranchId();
  if (!tenant?.organizationId) throw new Error("Не определён контекст филиала для AQSI");
  return { branchId, organizationId: tenant.organizationId, userId: tenant.userId ?? null };
}

function idempotencyKey(documentId: string) {
  return `local_demand:${documentId}`;
}

function safeExternalReceiptNumber(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  for (const key of ["receiptNumber", "checkNumber", "fiscalNumber"]) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 160);
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

async function audit(action: string, status: string, metadata: Record<string, unknown>) {
  const tenant = tenantOrThrow();
  await prisma.integrationAuditLog.create({
    data: {
      id: randomUUID(),
      branchId: tenant.branchId,
      organizationId: tenant.organizationId,
      channel: "aqsi",
      actorId: tenant.userId,
      action,
      status,
      metadataJson: metadata as Prisma.InputJsonValue,
    },
  });
}

async function executeRecord(recordId: string) {
  const tenant = tenantOrThrow();
  const leaseCutoff = new Date(Date.now() - PROCESSING_LEASE_MS);
  const claimed = await prisma.aqsiFiscalizationRecord.updateMany({
    where: {
      id: recordId,
      branchId: tenant.branchId,
      organizationId: tenant.organizationId,
      OR: [
        { status: { in: ["pending", "retry", "error"] } },
        { status: "processing", lastAttemptAt: { lt: leaseCutoff } },
      ],
    },
    data: { status: "processing", attempts: { increment: 1 }, lastAttemptAt: new Date(), nextAttemptAt: null },
  });
  if (!claimed.count) {
    const current = await prisma.aqsiFiscalizationRecord.findFirst({ where: { id: recordId, branchId: tenant.branchId } });
    if (!current) throw new Error("Запись фискализации не найдена");
    if (current.status === "succeeded") {
      return {
        ok: true as const,
        pending: false as const,
        recordId: current.id,
        status: "already_succeeded",
        result: {
          orderId: current.externalOrderId ?? current.documentId,
          uid: current.externalUid ?? undefined,
          status: "already_succeeded",
          deviceId: undefined,
          shopId: undefined,
          cashierId: undefined,
          raw: null,
        },
      };
    }
    return { ok: true as const, pending: true as const, recordId: current.id, status: current.status };
  }

  const record = await prisma.aqsiFiscalizationRecord.findFirst({ where: { id: recordId, branchId: tenant.branchId, organizationId: tenant.organizationId } });
  if (!record) throw new Error("Запись фискализации не найдена");
  try {
    const payload = record.payloadJson as unknown as SyncAqsiPendingOrderInput;
    const result = await syncAqsiPendingOrder({ ...payload, registerId: record.registerId });
    const externalReceiptNumber = safeExternalReceiptNumber(result.raw);
    await prisma.aqsiFiscalizationRecord.update({
      where: { id: record.id },
      data: {
        status: "succeeded",
        completedAt: new Date(),
        externalOrderId: result.orderId,
        externalUid: result.uid ?? null,
        externalReceiptNumber,
        safeResponseJson: {
          orderId: result.orderId,
          uid: result.uid ?? null,
          status: result.status ?? "accepted",
          deviceId: result.deviceId ?? null,
          shopId: result.shopId ?? null,
          cashierId: result.cashierId ?? null,
        } as Prisma.InputJsonValue,
        errorCode: null,
        errorMessage: null,
      },
    });
    await prisma.aqsiCashRegister.updateMany({
      where: { id: record.registerId, branchId: tenant.branchId, organizationId: tenant.organizationId },
      data: { status: "connected", lastSuccessAt: new Date(), lastErrorCode: null, lastErrorMessage: null },
    });
    await audit("aqsi_fiscalization_succeeded", "ok", { recordId: record.id, documentId: record.documentId, registerId: record.registerId });
    return { ok: true as const, pending: false as const, recordId: record.id, status: result.status, result };
  } catch (error) {
    const safe = safeAqsiError(error);
    const delayMinutes = Math.min(60, 2 ** Math.min(record.attempts, 6));
    await prisma.aqsiFiscalizationRecord.update({
      where: { id: record.id },
      data: {
        status: "retry",
        nextAttemptAt: new Date(Date.now() + delayMinutes * 60_000),
        errorCode: safe.code,
        errorMessage: safe.message,
      },
    });
    await prisma.aqsiCashRegister.updateMany({
      where: { id: record.registerId, branchId: tenant.branchId, organizationId: tenant.organizationId },
      data: { status: "error", lastErrorAt: new Date(), lastErrorCode: safe.code, lastErrorMessage: safe.message },
    });
    await audit("aqsi_fiscalization_pending", "error", { recordId: record.id, documentId: record.documentId, registerId: record.registerId, code: safe.code, attempts: record.attempts });
    if (safe.code === "AQSI_AUTH_FAILED" || record.attempts >= 3) {
      await notifyIntegrationOwner({
        channel: "aqsi",
        eventKey: "fiscalization_waiting",
        entityId: record.id,
        message: `Отгрузка ${record.documentId} ожидает фискализации после ${record.attempts} попыток.`,
        throttleMinutes: 180,
        metadata: { attempts: record.attempts, errorCode: safe.code },
      });
    }
    return { ok: true as const, pending: true as const, recordId: record.id, status: "retry", error: safe.message, code: safe.code };
  }
}

export async function submitAqsiFiscalization(input: SyncAqsiPendingOrderInput) {
  const tenant = tenantOrThrow();
  const register = await resolveAqsiCashRegister(input.registerId);
  const key = idempotencyKey(input.id);
  let record = await prisma.aqsiFiscalizationRecord.upsert({
    where: { branchId_idempotencyKey: { branchId: tenant.branchId, idempotencyKey: key } },
    update: {},
    create: {
      id: randomUUID(),
      branchId: tenant.branchId,
      organizationId: tenant.organizationId,
      registerId: register.registerId,
      documentType: "local_demand",
      documentId: input.id,
      idempotencyKey: key,
      payloadJson: { ...input, registerId: register.registerId } as Prisma.InputJsonValue,
      status: "pending",
    },
  });
  if (record.status === "succeeded") {
    return {
      ok: true as const,
      pending: false as const,
      recordId: record.id,
      status: "already_succeeded",
      result: {
        orderId: record.externalOrderId ?? input.id,
        uid: record.externalUid ?? undefined,
        status: "already_succeeded",
        deviceId: undefined,
        shopId: undefined,
        cashierId: undefined,
        raw: null,
      },
    };
  }
  if (record.status !== "processing") {
    record = await prisma.aqsiFiscalizationRecord.update({
      where: { id: record.id },
      data: { registerId: register.registerId, payloadJson: { ...input, registerId: register.registerId } as Prisma.InputJsonValue, status: "pending" },
    });
  }
  return executeRecord(record.id);
}

export async function retryAqsiFiscalization(recordId: string) {
  const tenant = tenantOrThrow();
  const record = await prisma.aqsiFiscalizationRecord.findFirst({ where: { id: recordId, branchId: tenant.branchId, organizationId: tenant.organizationId } });
  if (!record) throw new Error("Запись фискализации не найдена в текущем филиале");
  if (record.status === "succeeded") return { ok: true as const, pending: false as const, recordId, status: "already_succeeded" };
  await prisma.aqsiFiscalizationRecord.update({ where: { id: record.id }, data: { status: "retry", nextAttemptAt: null } });
  return executeRecord(record.id);
}

export async function retryDueAqsiFiscalizations(limit = 10) {
  const tenant = tenantOrThrow();
  const due = await prisma.aqsiFiscalizationRecord.findMany({
    where: { branchId: tenant.branchId, organizationId: tenant.organizationId, status: { in: ["pending", "retry"] }, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }] },
    orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
    take: Math.min(50, Math.max(1, limit)),
    select: { id: true },
  });
  const results = [];
  for (const row of due) results.push(await executeRecord(row.id));
  return results;
}
