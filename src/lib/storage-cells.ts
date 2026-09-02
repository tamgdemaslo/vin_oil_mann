import { Prisma } from "@prisma/client";
import type { BranchContext } from "@/lib/branch-context";
import { prisma } from "@/lib/db";

type Tx = Prisma.TransactionClient;

export type StorageCellInput = {
  code?: unknown;
  name?: unknown;
  zone?: unknown;
  comment?: unknown;
  archived?: unknown;
  reassignToCellId?: unknown;
};

export type StorageCellListParams = {
  search?: string;
  status?: "all" | "occupied" | "free" | "archived";
  sort?: "code" | "name" | "products" | "createdAt";
  direction?: "asc" | "desc";
  limit?: number;
  offset?: number;
};

export class StorageCellError extends Error {
  status: number;
  code: string;
  details?: Record<string, unknown>;

  constructor(message: string, status = 400, code = "STORAGE_CELL_INVALID", details?: Record<string, unknown>) {
    super(message);
    this.name = "StorageCellError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function clean(value: unknown, max: number) {
  return (typeof value === "string" ? value.trim() : "").slice(0, max);
}

export function normalizeStorageCellCode(value: unknown) {
  return clean(value, 120)
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .toLocaleUpperCase("ru-RU");
}

function bool(value: unknown) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function actorName(context: BranchContext) {
  return context.user?.name?.trim() || context.user?.login?.trim() || context.userId;
}

export function canManageStorageCells(context: BranchContext) {
  if (context.mode !== "branch" || !context.branchId) return false;
  if (["group_owner", "group_admin"].includes(context.groupRole ?? "")) return true;
  if (["branch_owner", "administrator"].includes(context.branchRole ?? "")) return true;
  return context.permissions.some((permission) => [
    "branches.manage",
    "warehouses.manage",
    "cells.create",
    "cells.update",
    "cells.delete",
  ].includes(permission));
}

export function canAssignProductStorageCell(context: BranchContext) {
  return canManageStorageCells(context) || context.permissions.some((permission) => [
    "products.manage",
    "products.update",
    "products.update_cell",
    "warehouse.manage",
  ].includes(permission));
}

function requireBranch(context: BranchContext) {
  if (context.mode !== "branch" || !context.branchId) {
    throw new StorageCellError("Для управления ячейками выберите конкретный филиал", 409, "BRANCH_REQUIRED");
  }
  return context.branchId;
}

async function requireStore(tx: Tx | typeof prisma, branchId: string, storeId: string, includeArchived = false) {
  const store = await tx.localStore.findFirst({
    where: { id: storeId, branchId, ...(includeArchived ? {} : { archived: false }) },
    select: { id: true, branchId: true, name: true, isMain: true, archived: true },
  });
  if (!store) throw new StorageCellError("Склад не найден в активном филиале", 404, "STORE_NOT_FOUND");
  return store;
}

function mapCell(cell: {
  id: string;
  branchId: string;
  storeId: string;
  code: string;
  normalizedCode: string;
  name: string | null;
  zone: string | null;
  comment: string | null;
  archived: boolean;
  createdAt: Date;
  updatedAt: Date;
  _count?: { assignments: number; documentPositions?: number };
}) {
  const productCount = cell._count?.assignments ?? 0;
  return {
    id: cell.id,
    branchId: cell.branchId,
    storeId: cell.storeId,
    code: cell.code,
    normalizedCode: cell.normalizedCode,
    name: cell.name ?? "",
    zone: cell.zone ?? "",
    comment: cell.comment ?? "",
    archived: cell.archived,
    productCount,
    usedInDocuments: (cell._count?.documentPositions ?? 0) > 0,
    status: cell.archived ? "archived" as const : productCount > 0 ? "occupied" as const : "free" as const,
    createdAt: cell.createdAt.toISOString(),
    updatedAt: cell.updatedAt.toISOString(),
  };
}

export async function listStorageCells(context: BranchContext, storeId: string, params: StorageCellListParams = {}) {
  const branchId = requireBranch(context);
  const store = await requireStore(prisma, branchId, storeId, true);
  const search = clean(params.search, 160);
  const status = params.status ?? "all";
  const direction = params.direction === "desc" ? "desc" : "asc";
  const limit = Math.min(100, Math.max(1, params.limit ?? 50));
  const offset = Math.max(0, params.offset ?? 0);
  const where: Prisma.StorageCellWhereInput = {
    branchId,
    storeId,
    ...(status === "archived" ? { archived: true } : { archived: false }),
    ...(status === "occupied" ? { assignments: { some: {} } } : {}),
    ...(status === "free" ? { assignments: { none: {} } } : {}),
    ...(search ? {
      OR: [
        { code: { contains: search, mode: "insensitive" } },
        { name: { contains: search, mode: "insensitive" } },
        { zone: { contains: search, mode: "insensitive" } },
      ],
    } : {}),
  };
  const orderBy: Prisma.StorageCellOrderByWithRelationInput[] = params.sort === "products"
    ? [{ assignments: { _count: direction } }, { code: "asc" }]
    : params.sort === "name"
      ? [{ name: direction }, { code: "asc" }]
      : params.sort === "createdAt"
        ? [{ createdAt: direction }, { code: "asc" }]
        : [{ normalizedCode: direction }];

  const [cells, total, totalActive, occupied, archived] = await Promise.all([
    prisma.storageCell.findMany({
      where,
      orderBy,
      skip: offset,
      take: limit,
      include: { _count: { select: { assignments: true, documentPositions: true } } },
    }),
    prisma.storageCell.count({ where }),
    prisma.storageCell.count({ where: { branchId, storeId, archived: false } }),
    prisma.storageCell.count({ where: { branchId, storeId, archived: false, assignments: { some: {} } } }),
    prisma.storageCell.count({ where: { branchId, storeId, archived: true } }),
  ]);

  return {
    store,
    cells: cells.map(mapCell),
    summary: { total: totalActive, occupied, free: Math.max(0, totalActive - occupied), archived },
    meta: { total, limit, offset },
    canManage: canManageStorageCells(context),
  };
}

export async function createStorageCell(context: BranchContext, storeId: string, input: StorageCellInput) {
  const branchId = requireBranch(context);
  if (!canManageStorageCells(context)) {
    throw new StorageCellError("Недостаточно прав для создания ячейки", 403, "STORAGE_CELL_FORBIDDEN");
  }
  const code = clean(input.code, 120);
  const normalizedCode = normalizeStorageCellCode(code);
  if (!normalizedCode) throw new StorageCellError("Укажите код ячейки", 400, "STORAGE_CELL_CODE_REQUIRED");
  const name = clean(input.name, 180) || null;
  const zone = clean(input.zone, 180) || null;
  const comment = clean(input.comment, 2000) || null;

  const result = await prisma.$transaction(async (tx) => {
    await requireStore(tx, branchId, storeId);
    const existing = await tx.storageCell.findFirst({ where: { branchId, storeId, normalizedCode } });
    if (existing?.archived) {
      throw new StorageCellError(
        `Ячейка ${existing.code} находится в архиве. Восстановите её в справочнике ячеек.`,
        409,
        "STORAGE_CELL_ARCHIVED",
      );
    }
    if (existing) return { cell: existing, created: false };
    const cell = await tx.storageCell.create({
      data: { branchId, storeId, code, normalizedCode, name, zone, comment, createdById: context.userId },
    });
    await tx.branchAuditLog.create({
      data: {
        businessGroupId: context.businessGroupId,
        branchId,
        userId: context.userId,
        action: "STORAGE_CELL_CREATED",
        entityType: "storage_cell",
        entityId: cell.id,
        metadata: { storeId, code, name, zone, actor: actorName(context) },
      },
    });
    return { cell, created: true };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return { ...result, cell: mapCell({ ...result.cell, _count: { assignments: 0, documentPositions: 0 } }) };
}

export async function updateStorageCell(context: BranchContext, storeId: string, cellId: string, input: StorageCellInput) {
  const branchId = requireBranch(context);
  if (!canManageStorageCells(context)) {
    throw new StorageCellError("Недостаточно прав для изменения ячейки", 403, "STORAGE_CELL_FORBIDDEN");
  }
  const requestedCode = input.code === undefined ? null : clean(input.code, 120);
  if (input.code !== undefined && !normalizeStorageCellCode(requestedCode)) {
    throw new StorageCellError("Укажите код ячейки", 400, "STORAGE_CELL_CODE_REQUIRED");
  }

  const cell = await prisma.$transaction(async (tx) => {
    const store = await requireStore(tx, branchId, storeId, true);
    const current = await tx.storageCell.findFirst({
      where: { id: cellId, branchId, storeId },
      include: { _count: { select: { assignments: true, documentPositions: true } } },
    });
    if (!current) throw new StorageCellError("Ячейка не найдена", 404, "STORAGE_CELL_NOT_FOUND");
    const code = requestedCode ?? current.code;
    const normalizedCode = normalizeStorageCellCode(code);
    const archived = input.archived === undefined ? current.archived : bool(input.archived);
    if (archived && current._count.assignments > 0) {
      throw new StorageCellError(
        `К ячейке ${current.code} привязано ${current._count.assignments} товаров. Сначала переназначьте их.`,
        409,
        "STORAGE_CELL_OCCUPIED",
        { productCount: current._count.assignments },
      );
    }
    const duplicate = await tx.storageCell.findFirst({
      where: { branchId, storeId, normalizedCode, id: { not: cellId } },
      select: { id: true, code: true },
    });
    if (duplicate) throw new StorageCellError(`Ячейка ${duplicate.code} уже существует`, 409, "STORAGE_CELL_DUPLICATE");
    const updated = await tx.storageCell.update({
      where: { id: cellId },
      data: {
        code,
        normalizedCode,
        ...(input.name === undefined ? {} : { name: clean(input.name, 180) || null }),
        ...(input.zone === undefined ? {} : { zone: clean(input.zone, 180) || null }),
        ...(input.comment === undefined ? {} : { comment: clean(input.comment, 2000) || null }),
        archived,
        archivedAt: archived ? current.archivedAt ?? new Date() : null,
        archivedById: archived ? context.userId : null,
      },
      include: { _count: { select: { assignments: true, documentPositions: true } } },
    });
    if (code !== current.code) {
      const assignments = await tx.productStorageAssignment.findMany({
        where: { branchId, storeId, cellId },
        select: { productId: true },
      });
      const productIds = assignments.map((assignment) => assignment.productId);
      if (productIds.length) {
        await tx.localStockBalance.updateMany({ where: { branchId, storeId, productId: { in: productIds } }, data: { slotName: code } });
        if (store.isMain) await tx.localProduct.updateMany({ where: { branchId, id: { in: productIds } }, data: { cell: code } });
      }
    }
    await tx.branchAuditLog.create({
      data: {
        businessGroupId: context.businessGroupId,
        branchId,
        userId: context.userId,
        action: archived && !current.archived ? "STORAGE_CELL_ARCHIVED" : "STORAGE_CELL_UPDATED",
        entityType: "storage_cell",
        entityId: cellId,
        metadata: {
          storeId,
          before: { code: current.code, name: current.name, zone: current.zone, archived: current.archived },
          after: { code: updated.code, name: updated.name, zone: updated.zone, archived: updated.archived },
          affectedProducts: current._count.assignments,
        },
      },
    });
    return updated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return mapCell(cell);
}

export async function deleteStorageCell(context: BranchContext, storeId: string, cellId: string, input: StorageCellInput = {}) {
  const branchId = requireBranch(context);
  if (!canManageStorageCells(context)) {
    throw new StorageCellError("Недостаточно прав для удаления ячейки", 403, "STORAGE_CELL_FORBIDDEN");
  }
  const reassignToCellId = clean(input.reassignToCellId, 120) || null;

  const result = await prisma.$transaction(async (tx) => {
    const store = await requireStore(tx, branchId, storeId, true);
    const current = await tx.storageCell.findFirst({
      where: { id: cellId, branchId, storeId },
      include: { _count: { select: { assignments: true, documentPositions: true } } },
    });
    if (!current) throw new StorageCellError("Ячейка не найдена", 404, "STORAGE_CELL_NOT_FOUND");
    const assignments = await tx.productStorageAssignment.findMany({
      where: { branchId, storeId, cellId },
      select: { productId: true },
    });
    const productIds = assignments.map((assignment) => assignment.productId);
    if (productIds.length && !reassignToCellId) {
      throw new StorageCellError(
        `К ячейке ${current.code} привязано ${productIds.length} товаров. Перед удалением выберите новую ячейку.`,
        409,
        "STORAGE_CELL_OCCUPIED",
        { productCount: productIds.length },
      );
    }
    let target: { id: string; code: string } | null = null;
    if (reassignToCellId) {
      if (reassignToCellId === cellId) throw new StorageCellError("Нельзя перенести товары в ту же ячейку", 400, "STORAGE_CELL_SAME_TARGET");
      target = await tx.storageCell.findFirst({
        where: { id: reassignToCellId, branchId, storeId, archived: false },
        select: { id: true, code: true },
      });
      if (!target) throw new StorageCellError("Новая ячейка не найдена или архивирована", 404, "STORAGE_CELL_TARGET_NOT_FOUND");
      if (productIds.length) {
        await tx.productStorageAssignment.updateMany({
          where: { branchId, storeId, cellId },
          data: { cellId: target.id, assignedAt: new Date(), assignedById: context.userId },
        });
        await tx.localStockBalance.updateMany({ where: { branchId, storeId, productId: { in: productIds } }, data: { slotName: target.code } });
        if (store.isMain) await tx.localProduct.updateMany({ where: { branchId, id: { in: productIds } }, data: { cell: target.code } });
        await tx.branchAuditLog.create({
          data: {
            businessGroupId: context.businessGroupId,
            branchId,
            userId: context.userId,
            action: "STORAGE_CELL_PRODUCTS_REASSIGNED",
            entityType: "storage_cell",
            entityId: current.id,
            metadata: { storeId, fromCellId: current.id, fromCode: current.code, toCellId: target.id, toCode: target.code, productCount: productIds.length },
          },
        });
      }
    }

    const legacyBalanceUsage = await tx.localStockBalance.count({
      where: {
        branchId,
        storeId,
        slotName: { equals: current.code, mode: "insensitive" },
        quantity: { not: 0 },
        ...(productIds.length ? { productId: { notIn: productIds } } : {}),
      },
    });
    if (legacyBalanceUsage > 0) {
      throw new StorageCellError("В ячейке есть текущий остаток без нормализованного назначения", 409, "STORAGE_CELL_HAS_STOCK", { balanceCount: legacyBalanceUsage });
    }

    const archive = current._count.documentPositions > 0 || productIds.length > 0 || bool(input.archived);
    if (archive) {
      await tx.storageCell.update({
        where: { id: current.id },
        data: { archived: true, archivedAt: new Date(), archivedById: context.userId },
      });
    } else {
      await tx.storageCell.delete({ where: { id: current.id } });
    }
    await tx.branchAuditLog.create({
      data: {
        businessGroupId: context.businessGroupId,
        branchId,
        userId: context.userId,
        action: archive ? "STORAGE_CELL_ARCHIVED" : "STORAGE_CELL_DELETED",
        entityType: "storage_cell",
        entityId: current.id,
        metadata: { storeId, code: current.code, productCount: productIds.length, historicalPositions: current._count.documentPositions, targetCellId: target?.id ?? null },
      },
    });
    return { archived: archive, productCount: productIds.length, targetCell: target };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return result;
}

export async function listStorageCellProducts(context: BranchContext, storeId: string, cellId: string) {
  const branchId = requireBranch(context);
  const cell = await prisma.storageCell.findFirst({
    where: { id: cellId, branchId, storeId },
    include: { _count: { select: { assignments: true, documentPositions: true } } },
  });
  if (!cell) throw new StorageCellError("Ячейка не найдена", 404, "STORAGE_CELL_NOT_FOUND");
  const assignments = await prisma.productStorageAssignment.findMany({
    where: { branchId, storeId, cellId },
    orderBy: [{ product: { name: "asc" } }],
    include: {
      product: {
        select: {
          id: true,
          name: true,
          article: true,
          code: true,
          uomName: true,
          stockBalances: { where: { branchId, storeId }, select: { quantity: true, available: true } },
        },
      },
    },
  });
  return {
    cell: mapCell(cell),
    products: assignments.map((assignment) => ({
      id: assignment.product.id,
      name: assignment.product.name,
      article: assignment.product.article ?? assignment.product.code ?? "",
      quantity: Number(assignment.product.stockBalances[0]?.quantity ?? 0),
      available: Number(assignment.product.stockBalances[0]?.available ?? 0),
      uomName: assignment.product.uomName ?? "шт.",
    })),
  };
}

export async function applyProductStorageCellTx(tx: Tx, input: {
  branchId: string;
  productId: string;
  storeId: string;
  cellId: string | null;
  actorId?: string | null;
  businessGroupId?: string | null;
  sourceDocumentId?: string | null;
  quantity?: number | null;
}) {
  const [product, store, current] = await Promise.all([
    tx.localProduct.findFirst({ where: { id: input.productId, branchId: input.branchId }, select: { id: true, name: true } }),
    tx.localStore.findFirst({ where: { id: input.storeId, branchId: input.branchId, archived: false }, select: { id: true, isMain: true } }),
    tx.productStorageAssignment.findFirst({ where: { branchId: input.branchId, productId: input.productId, storeId: input.storeId }, include: { cell: true } }),
  ]);
  if (!product) throw new StorageCellError("Товар не найден в активном филиале", 404, "PRODUCT_NOT_FOUND");
  if (!store) throw new StorageCellError("Склад не найден в активном филиале", 404, "STORE_NOT_FOUND");
  const nextCell = input.cellId
    ? await tx.storageCell.findFirst({ where: { id: input.cellId, branchId: input.branchId, storeId: input.storeId, archived: false } })
    : null;
  if (input.cellId && !nextCell) {
    throw new StorageCellError("Ячейка не относится к выбранному складу или архивирована", 409, "STORAGE_CELL_SCOPE_INVALID");
  }
  if (current?.cellId === nextCell?.id || (!current && !nextCell)) {
    return { changed: false, previousCell: current?.cell ?? null, cell: nextCell };
  }

  if (nextCell) {
    await tx.productStorageAssignment.upsert({
      where: { branchId_productId_storeId: { branchId: input.branchId, productId: input.productId, storeId: input.storeId } },
      create: {
        branchId: input.branchId,
        productId: input.productId,
        storeId: input.storeId,
        cellId: nextCell.id,
        assignedById: input.actorId ?? null,
      },
      update: { cellId: nextCell.id, assignedAt: new Date(), assignedById: input.actorId ?? null },
    });
  } else {
    await tx.productStorageAssignment.deleteMany({ where: { branchId: input.branchId, productId: input.productId, storeId: input.storeId } });
  }

  await tx.localStockBalance.updateMany({
    where: { branchId: input.branchId, productId: input.productId, storeId: input.storeId },
    data: { slotName: nextCell?.code ?? null },
  });
  if (store.isMain) {
    await tx.localProduct.update({ where: { id: input.productId }, data: { cell: nextCell?.code ?? null } });
  }
  await tx.branchAuditLog.create({
    data: {
      businessGroupId: input.businessGroupId ?? null,
      branchId: input.branchId,
      userId: input.actorId ?? null,
      action: nextCell ? "PRODUCT_STORAGE_CELL_CHANGED" : "PRODUCT_STORAGE_CELL_CLEARED",
      entityType: "local_product",
      entityId: input.productId,
      metadata: {
        storeId: input.storeId,
        context: input.sourceDocumentId ? "RECEIPT_POSTING" : "PRODUCT_CARD",
        sourceDocumentId: input.sourceDocumentId ?? null,
        quantity: input.quantity ?? null,
        previousCellId: current?.cellId ?? null,
        previousCellCode: current?.cell.code ?? null,
        cellId: nextCell?.id ?? null,
        cellCode: nextCell?.code ?? null,
      },
    },
  });
  return { changed: true, previousCell: current?.cell ?? null, cell: nextCell };
}

export async function assignProductStorageCell(context: BranchContext, productId: string, storeId: string, cellId: string | null) {
  const branchId = requireBranch(context);
  if (!canAssignProductStorageCell(context)) {
    throw new StorageCellError("Недостаточно прав для изменения ячейки товара", 403, "PRODUCT_CELL_FORBIDDEN");
  }
  const balance = await prisma.localStockBalance.findFirst({
    where: { branchId, productId, storeId },
    select: { quantity: true },
  });
  const result = await prisma.$transaction((tx) => applyProductStorageCellTx(tx, {
    branchId,
    productId,
    storeId,
    cellId,
    actorId: context.userId,
    businessGroupId: context.businessGroupId,
  }), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  const quantity = Number(balance?.quantity ?? 0);
  return {
    ...result,
    warning: !cellId && quantity > 0
      ? `У товара есть остаток ${quantity} шт. Место его хранения теперь не указано.`
      : null,
  };
}

export async function getProductStorageCells(context: BranchContext, productId: string) {
  const branchId = requireBranch(context);
  const product = await prisma.localProduct.findFirst({ where: { id: productId, branchId }, select: { id: true } });
  if (!product) throw new StorageCellError("Товар не найден", 404, "PRODUCT_NOT_FOUND");
  const assignments = await prisma.productStorageAssignment.findMany({
    where: { branchId, productId },
    orderBy: [{ store: { isMain: "desc" } }, { store: { name: "asc" } }],
    include: { cell: true, store: { select: { id: true, name: true, isMain: true, archived: true } } },
  });
  return assignments.map((assignment) => ({
    storeId: assignment.storeId,
    storeName: assignment.store.name,
    storeIsMain: assignment.store.isMain,
    cell: mapCell({ ...assignment.cell, _count: { assignments: 0, documentPositions: 0 } }),
  }));
}
