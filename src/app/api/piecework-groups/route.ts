import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireBranchApi } from "@/lib/branch-api";
import { logChange } from "@/lib/change-log";
import { prisma } from "@/lib/db";
import { serviceOperationGroupId } from "@/lib/piecework-service-operations";

type CatalogGroupKind = "service" | "product";

function isCatalogGroupKind(value: unknown): value is CatalogGroupKind {
  return value === "service" || value === "product";
}

function normalizeGroupName(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("ru-RU");
}

function cleanGroupName(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

async function requireOwner() {
  const session = await getSession();
  if (!session) {
    return { ok: false as const, response: NextResponse.json({ error: "Необходимо войти" }, { status: 401 }) };
  }
  if (session.user.role !== "owner") {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Только владелец может управлять группами начислений" }, { status: 403 }),
    };
  }
  return { ok: true as const, session };
}

async function readGroups(branchId: string) {
  const [groups, services, usage, serviceOperations] = await Promise.all([
    prisma.localCatalogGroup.findMany({
      where: { branchId, archived: false, kind: { in: ["service", "product"] } },
      select: { id: true, kind: true, name: true },
      orderBy: [{ kind: "asc" }, { name: "asc" }],
    }),
    prisma.localProduct.findMany({
      where: { branchId, archived: false, entityType: "service" },
      select: { id: true, name: true, groupId: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    }),
    prisma.localProduct.groupBy({
      by: ["groupId"],
      where: { branchId, archived: false, groupId: { not: null } },
      _count: { _all: true },
    }),
    prisma.salesAnalyticsMetric.findMany({
      where: { type: "SERVICE_OPERATION", active: true },
      select: { code: true, title: true },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    }),
  ]);

  const usageByGroupId = new Map(
    usage.flatMap((entry) => (entry.groupId ? [[entry.groupId, entry._count._all] as const] : [])),
  );

  return {
    groups: groups.map((group) => ({
      ...group,
      kind: group.kind as CatalogGroupKind,
      itemCount: usageByGroupId.get(group.id) ?? 0,
    })),
    services,
    serviceOperations: serviceOperations.map((operation) => {
      const groupId = serviceOperationGroupId(branchId, operation.code);
      return {
        code: operation.code,
        title: operation.title,
        groupId: groups.some((group) => group.id === groupId) ? groupId : null,
      };
    }),
  };
}

export async function GET() {
  const owner = await requireOwner();
  if (!owner.ok) return owner.response;
  const branchAccess = await requireBranchApi({ requireActive: false });
  if (!branchAccess.ok) return branchAccess.response;

  return NextResponse.json(await readGroups(branchAccess.context.branchId!));
}

export async function POST(request: NextRequest) {
  const owner = await requireOwner();
  if (!owner.ok) return owner.response;
  const branchAccess = await requireBranchApi();
  if (!branchAccess.ok) return branchAccess.response;
  const branchId = branchAccess.context.branchId!;
  const body = await request.json();
  const action = typeof body.action === "string" ? body.action : "";

  if (action === "add-service-operations") {
    const rawCodes: unknown[] | null = Array.isArray(body.codes) ? body.codes : null;
    const requestedCodes = rawCodes
      ? [...new Set(rawCodes
          .filter((code): code is string => typeof code === "string")
          .map((code) => code.trim().toUpperCase())
          .filter(Boolean))]
      : null;
    const operations = await prisma.salesAnalyticsMetric.findMany({
      where: {
        type: "SERVICE_OPERATION",
        active: true,
        ...(requestedCodes ? { code: { in: requestedCodes } } : {}),
      },
      select: { code: true, title: true },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    });
    if (operations.length === 0) {
      return NextResponse.json({ error: "Не найдены операции услуг для добавления" }, { status: 400 });
    }

    const groups = await prisma.$transaction(async (tx) => Promise.all(
      operations.map((operation) => tx.localCatalogGroup.upsert({
        where: { id: serviceOperationGroupId(branchId, operation.code) },
        create: {
          id: serviceOperationGroupId(branchId, operation.code),
          branchId,
          kind: "service",
          name: operation.title,
          normalizedName: normalizeGroupName(operation.title),
        },
        update: { archived: false },
        select: { id: true, name: true, kind: true },
      })),
    ));

    await Promise.all(groups.map((group) => logChange({
      entityType: "local_catalog_group",
      entityId: group.id,
      action: "create",
      newValue: { name: group.name, kind: group.kind, source: "service_operation" },
      performedByLogin: owner.session.user.login,
    })));
    return NextResponse.json({ groups }, { status: 201 });
  }

  const kind = body.kind;
  const name = cleanGroupName(body.name);

  if (!isCatalogGroupKind(kind) || name.length < 2 || name.length > 120) {
    return NextResponse.json({ error: "Укажите название группы от 2 до 120 символов" }, { status: 400 });
  }

  const normalizedName = normalizeGroupName(name);
  const existing = await prisma.localCatalogGroup.findFirst({
    where: { branchId, kind, normalizedName },
    select: { id: true, name: true, archived: true },
  });

  if (existing && !existing.archived) {
    return NextResponse.json({ error: "Группа с таким названием уже есть" }, { status: 409 });
  }

  const group = existing
    ? await prisma.localCatalogGroup.update({
        where: { id: existing.id },
        data: { archived: false, name },
        select: { id: true, kind: true, name: true },
      })
    : await prisma.localCatalogGroup.create({
        data: {
          id: `grp_manual_${randomUUID().replaceAll("-", "")}`,
          branchId,
          kind,
          name,
          normalizedName,
        },
        select: { id: true, kind: true, name: true },
      });

  await logChange({
    entityType: "local_catalog_group",
    entityId: group.id,
    action: existing ? "update" : "create",
    oldValue: existing ? { name: existing.name, archived: true } : null,
    newValue: { name: group.name, kind: group.kind, archived: false },
    performedByLogin: owner.session.user.login,
  });

  return NextResponse.json({ group }, { status: existing ? 200 : 201 });
}

export async function PATCH(request: NextRequest) {
  const owner = await requireOwner();
  if (!owner.ok) return owner.response;
  const branchAccess = await requireBranchApi();
  if (!branchAccess.ok) return branchAccess.response;
  const branchId = branchAccess.context.branchId!;
  const body = await request.json();
  const action = typeof body.action === "string" ? body.action : "";

  if (action === "assign-service") {
    const serviceId = typeof body.serviceId === "string" ? body.serviceId.trim() : "";
    const groupId = typeof body.groupId === "string" ? body.groupId.trim() : "";
    if (!serviceId) {
      return NextResponse.json({ error: "Выберите услугу" }, { status: 400 });
    }

    const service = await prisma.localProduct.findFirst({
      where: { id: serviceId, branchId, entityType: "service", archived: false },
      select: { id: true, name: true, groupId: true, groupPath: true },
    });
    const group = groupId
      ? await prisma.localCatalogGroup.findFirst({
          where: { id: groupId, branchId, kind: "service", archived: false },
          select: { id: true, name: true },
        })
      : null;
    if (!service || (groupId && !group)) {
      return NextResponse.json({ error: "Услуга или группа не найдена в текущем филиале" }, { status: 404 });
    }

    await prisma.localProduct.update({
      where: { id: service.id },
      data: { groupId: group?.id ?? null, groupPath: group?.name ?? null },
    });
    await logChange({
      entityType: "local_product",
      entityId: service.id,
      action: "update",
      oldValue: { groupId: service.groupId, groupPath: service.groupPath },
      newValue: { groupId: group?.id ?? null, groupPath: group?.name ?? null },
      performedByLogin: owner.session.user.login,
    });
    return NextResponse.json({ serviceId: service.id, groupId: group?.id ?? null });
  }

  const groupId = typeof body.groupId === "string" ? body.groupId.trim() : "";
  if (!groupId) return NextResponse.json({ error: "Не выбрана группа" }, { status: 400 });

  const group = await prisma.localCatalogGroup.findFirst({
    where: { id: groupId, branchId, archived: false },
    select: { id: true, kind: true, name: true, normalizedName: true },
  });
  if (!group) return NextResponse.json({ error: "Группа не найдена в текущем филиале" }, { status: 404 });

  if (action === "rename") {
    const name = cleanGroupName(body.name);
    if (name.length < 2 || name.length > 120) {
      return NextResponse.json({ error: "Укажите название группы от 2 до 120 символов" }, { status: 400 });
    }
    const normalizedName = normalizeGroupName(name);
    const duplicate = await prisma.localCatalogGroup.findFirst({
      where: { branchId, kind: group.kind, normalizedName, id: { not: group.id } },
      select: { id: true },
    });
    if (duplicate) return NextResponse.json({ error: "Группа с таким названием уже есть" }, { status: 409 });

    await prisma.$transaction(async (tx) => {
      await tx.localCatalogGroup.update({
        where: { id: group.id },
        data: { name, normalizedName },
      });
      await tx.localProduct.updateMany({
        where: { branchId, groupId: group.id },
        data: { groupPath: name },
      });
      await tx.pieceworkRule.updateMany({
        where: { branchId, targetId: group.id },
        data: { targetName: name },
      });
    });
    await logChange({
      entityType: "local_catalog_group",
      entityId: group.id,
      action: "update",
      oldValue: { name: group.name },
      newValue: { name },
      performedByLogin: owner.session.user.login,
    });
    return NextResponse.json({ groupId: group.id, name });
  }

  if (action === "archive") {
    const itemCount = await prisma.localProduct.count({
      where: { branchId, groupId: group.id, archived: false },
    });
    if (itemCount > 0) {
      return NextResponse.json(
        { error: `Сначала переназначьте ${itemCount} ${itemCount === 1 ? "позицию" : "позиций"} из этой группы` },
        { status: 409 },
      );
    }
    await prisma.localCatalogGroup.update({ where: { id: group.id }, data: { archived: true } });
    await logChange({
      entityType: "local_catalog_group",
      entityId: group.id,
      action: "delete",
      oldValue: { name: group.name, kind: group.kind, archived: false },
      newValue: { archived: true },
      performedByLogin: owner.session.user.login,
    });
    return NextResponse.json({ groupId: group.id, archived: true });
  }

  return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
}
