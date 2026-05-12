import { prisma } from "@/lib/db";

export async function logChange(params: {
  entityType: string;
  entityId: string;
  action: "create" | "update" | "delete";
  oldValue?: unknown;
  newValue?: unknown;
  performedByLogin: string;
}) {
  await prisma.changeLog.create({
    data: {
      entityType: params.entityType,
      entityId: params.entityId,
      action: params.action,
      oldValue: params.oldValue != null ? (params.oldValue as object) : undefined,
      newValue: params.newValue != null ? (params.newValue as object) : undefined,
      performedByLogin: params.performedByLogin,
    },
  });
}
