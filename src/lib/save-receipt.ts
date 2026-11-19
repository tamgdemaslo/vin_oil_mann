import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";

export function saveReceiptId(scope: readonly string[], operationId: string) {
  return "save_" + createHash("sha256").update(JSON.stringify([...scope, operationId])).digest("hex");
}

export async function lockSaveReceipt(
  tx: Prisma.TransactionClient,
  scope: readonly string[],
  operationId: string,
) {
  const id = saveReceiptId(scope, operationId);
  await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 0))::text`);
  return { id, receipt: await tx.branchAuditLog.findUnique({ where: { id }, select: { entityId: true } }) };
}
