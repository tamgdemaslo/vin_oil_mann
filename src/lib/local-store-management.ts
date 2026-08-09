import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { invalidateWarehouseReadCaches } from "@/lib/local-inventory-admin";
import type { BranchContext } from "@/lib/branch-context";
import { runWithRequestTenant } from "@/lib/request-tenant-store";

export type WarehouseInput = {
  name?: unknown;
  shortName?: unknown;
  address?: unknown;
  comment?: unknown;
  isMain?: unknown;
};

export type ManagedWarehouse = {
  id: string;
  branchId: string;
  name: string;
  shortName: string;
  address: string;
  comment: string;
  isMain: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
};

type TargetBranch = {
  id: string;
  legacyOrganizationId: string | null;
  status: string;
};

function clean(value: unknown, max: number) {
  const text = typeof value === "string" ? value.trim() : "";
  return text.slice(0, max);
}

function boolean(value: unknown) {
  return value === true || value === "true" || value === "on" || value === 1 || value === "1";
}

function jsonRecord(value: Prisma.JsonValue | null | undefined) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Prisma.JsonValue>
    : {};
}

function rawText(raw: Record<string, Prisma.JsonValue | undefined>, key: string) {
  return typeof raw[key] === "string" ? raw[key].trim() : "";
}

function mapWarehouse(store: {
  id: string;
  branchId: string;
  name: string;
  isMain: boolean;
  archived: boolean;
  raw: Prisma.JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
}): ManagedWarehouse {
  const raw = jsonRecord(store.raw);
  return {
    id: store.id,
    branchId: store.branchId,
    name: store.name,
    shortName: rawText(raw, "shortName"),
    address: rawText(raw, "address"),
    comment: rawText(raw, "comment"),
    isMain: store.isMain,
    archived: store.archived,
    createdAt: store.createdAt.toISOString(),
    updatedAt: store.updatedAt.toISOString(),
  };
}

function storeRaw(input: WarehouseInput, current?: Prisma.JsonValue | null) {
  const raw = jsonRecord(current);
  return {
    ...raw,
    shortName: clean(input.shortName, 120),
    address: clean(input.address, 1000),
    comment: clean(input.comment, 2000),
  } as Prisma.InputJsonValue;
}

async function findReadableBranch(context: BranchContext, branchId: string): Promise<TargetBranch | null> {
  if (!context.branches.some((branch) => branch.id === branchId)) return null;
  return prisma.branch.findFirst({
    where: { id: branchId, businessGroupId: context.businessGroupId },
    select: { id: true, legacyOrganizationId: true, status: true },
  });
}

function hasWarehouseManagementPermission(value: Prisma.JsonValue | null) {
  if (Array.isArray(value)) return value.some((item) => item === "branches.manage" || item === "warehouses.manage");
  if (!value || typeof value !== "object") return false;
  const permissions = value as Record<string, Prisma.JsonValue>;
  return Boolean(permissions["branches.manage"] || permissions["warehouses.manage"]);
}

async function canManageTargetBranch(context: BranchContext, branchId: string) {
  if (context.groupRole === "group_owner" || context.groupRole === "group_admin") return true;
  if (!context.userId) return false;
  const membership = await prisma.branchMembership.findFirst({
    where: { branchId, userId: context.userId, status: "active" },
    select: { roleId: true, permissionsJson: true },
  });
  return ["branch_owner", "administrator"].includes(membership?.roleId ?? "") || hasWarehouseManagementPermission(membership?.permissionsJson ?? null);
}

async function findManagedBranch(context: BranchContext, branchId: string) {
  const branch = await findReadableBranch(context, branchId);
  if (!branch) return { ok: false as const, status: 403, error: "Филиал недоступен" };

  if (branch.status !== "active") return { ok: false as const, status: 423, error: "Архивный филиал доступен только для просмотра" };
  if (!await canManageTargetBranch(context, branchId)) {
    return { ok: false as const, status: 403, error: "Недостаточно прав для управления складами филиала" };
  }
  return { ok: true as const, branch };
}

function runForBranch<T>(context: BranchContext, branch: TargetBranch, operation: () => T): T {
  return runWithRequestTenant({
    mode: "branch",
    branchId: branch.id,
    organizationId: branch.legacyOrganizationId ?? branch.id,
    allowedBranchIds: [branch.id],
    businessGroupId: context.businessGroupId,
    userId: context.userId,
    permissions: [context.groupRole, context.branchRole].filter((role): role is string => Boolean(role)),
  }, operation);
}

async function normalizeMainWarehouse(tx: Prisma.TransactionClient, branchId: string) {
  const active = await tx.localStore.findMany({
    where: { branchId, archived: false },
    orderBy: [{ isMain: "desc" }, { createdAt: "asc" }],
    select: { id: true, isMain: true },
  });
  const main = active[0];
  if (!main) return;
  await tx.localStore.updateMany({
    where: { branchId, archived: false, id: { not: main.id }, isMain: true },
    data: { isMain: false },
  });
  if (!main.isMain) {
    await tx.localStore.update({ where: { id: main.id }, data: { isMain: true } });
  }
}

export async function listManagedWarehouses(context: BranchContext, branchId: string) {
  const branch = await findReadableBranch(context, branchId);
  if (!branch) return { ok: false as const, status: 403, error: "Филиал недоступен" };
  const warehouses = await runForBranch(context, branch, () => prisma.localStore.findMany({
    where: { branchId },
    orderBy: [{ archived: "asc" }, { isMain: "desc" }, { name: "asc" }],
  }));
  return { ok: true as const, warehouses: warehouses.map(mapWarehouse), canManage: await canManageTargetBranch(context, branchId) };
}

export async function createManagedWarehouse(context: BranchContext, branchId: string, input: WarehouseInput) {
  const resolved = await findManagedBranch(context, branchId);
  if (!resolved.ok) return resolved;
  const name = clean(input.name, 160);
  if (!name) return { ok: false as const, status: 400, error: "Укажите название склада" };

  const warehouse = await runForBranch(context, resolved.branch, () => prisma.$transaction(async (tx) => {
    const activeCount = await tx.localStore.count({ where: { branchId, archived: false } });
    const isMain = activeCount === 0 || boolean(input.isMain);
    if (isMain) {
      await tx.localStore.updateMany({ where: { branchId, archived: false, isMain: true }, data: { isMain: false } });
    }
    const created = await tx.localStore.create({
      data: {
        branchId,
        organizationId: resolved.branch.legacyOrganizationId,
        name,
        isMain,
        raw: storeRaw(input),
      },
    });
    await normalizeMainWarehouse(tx, branchId);
    await tx.branchAuditLog.create({
      data: {
        businessGroupId: context.businessGroupId,
        branchId,
        userId: context.userId,
        action: "warehouse_created",
        entityType: "warehouse",
        entityId: created.id,
        metadata: { name: created.name, isMain },
      },
    });
    return created;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  invalidateWarehouseReadCaches();
  return { ok: true as const, warehouse: mapWarehouse(warehouse) };
}

export async function updateManagedWarehouse(context: BranchContext, branchId: string, warehouseId: string, input: WarehouseInput) {
  const resolved = await findManagedBranch(context, branchId);
  if (!resolved.ok) return resolved;
  const name = clean(input.name, 160);
  if (!name) return { ok: false as const, status: 400, error: "Укажите название склада" };

  const warehouse = await runForBranch(context, resolved.branch, () => prisma.$transaction(async (tx) => {
    const current = await tx.localStore.findFirst({ where: { id: warehouseId, branchId, archived: false } });
    if (!current) throw new Error("WAREHOUSE_NOT_FOUND");
    const isMain = input.isMain === undefined ? current.isMain : boolean(input.isMain);
    if (isMain) {
      await tx.localStore.updateMany({ where: { branchId, archived: false, id: { not: warehouseId }, isMain: true }, data: { isMain: false } });
    }
    const updated = await tx.localStore.update({
      where: { id: current.id },
      data: { name, isMain, raw: storeRaw(input, current.raw) },
    });
    await normalizeMainWarehouse(tx, branchId);
    await tx.branchAuditLog.create({
      data: {
        businessGroupId: context.businessGroupId,
        branchId,
        userId: context.userId,
        action: "warehouse_updated",
        entityType: "warehouse",
        entityId: updated.id,
        metadata: { name: updated.name, isMain: updated.isMain },
      },
    });
    return updated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  invalidateWarehouseReadCaches();
  return { ok: true as const, warehouse: mapWarehouse(warehouse) };
}

export async function setManagedWarehouseMain(context: BranchContext, branchId: string, warehouseId: string) {
  const resolved = await findManagedBranch(context, branchId);
  if (!resolved.ok) return resolved;

  const warehouse = await runForBranch(context, resolved.branch, () => prisma.$transaction(async (tx) => {
    const current = await tx.localStore.findFirst({ where: { id: warehouseId, branchId, archived: false } });
    if (!current) throw new Error("WAREHOUSE_NOT_FOUND");
    await tx.localStore.updateMany({ where: { branchId, archived: false, id: { not: warehouseId }, isMain: true }, data: { isMain: false } });
    const updated = await tx.localStore.update({ where: { id: current.id }, data: { isMain: true } });
    await tx.branchAuditLog.create({
      data: {
        businessGroupId: context.businessGroupId,
        branchId,
        userId: context.userId,
        action: "warehouse_main_changed",
        entityType: "warehouse",
        entityId: updated.id,
      },
    });
    return updated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  invalidateWarehouseReadCaches();
  return { ok: true as const, warehouse: mapWarehouse(warehouse) };
}

export async function archiveManagedWarehouse(context: BranchContext, branchId: string, warehouseId: string) {
  const resolved = await findManagedBranch(context, branchId);
  if (!resolved.ok) return resolved;

  const warehouse = await runForBranch(context, resolved.branch, () => prisma.$transaction(async (tx) => {
    const current = await tx.localStore.findFirst({ where: { id: warehouseId, branchId, archived: false } });
    if (!current) throw new Error("WAREHOUSE_NOT_FOUND");
    const updated = await tx.localStore.update({ where: { id: current.id }, data: { archived: true, isMain: false } });
    await normalizeMainWarehouse(tx, branchId);
    await tx.branchAuditLog.create({
      data: {
        businessGroupId: context.businessGroupId,
        branchId,
        userId: context.userId,
        action: "warehouse_archived",
        entityType: "warehouse",
        entityId: updated.id,
      },
    });
    return updated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  invalidateWarehouseReadCaches();
  return { ok: true as const, warehouse: mapWarehouse(warehouse) };
}

export function isWarehouseNotFound(error: unknown) {
  return error instanceof Error && error.message === "WAREHOUSE_NOT_FOUND";
}
