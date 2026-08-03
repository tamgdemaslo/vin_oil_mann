import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { hasBranchPermission, type BranchContext } from "@/lib/branch-context";
import { runWithRequestTenant } from "@/lib/request-tenant-store";

export type BranchInput = {
  name?: unknown;
  shortName?: unknown;
  slug?: unknown;
  address?: unknown;
  timezone?: unknown;
  phone?: unknown;
  email?: unknown;
  telegramUsername?: unknown;
  legalEntityName?: unknown;
  legalEntityType?: unknown;
  inn?: unknown;
  ogrn?: unknown;
  bankDetailsJson?: unknown;
  openingDate?: unknown;
  status?: unknown;
  organizationId?: unknown;
  secondaryPhone?: unknown;
  whatsapp?: unknown;
  communicationEmail?: unknown;
  communicationTelegram?: unknown;
  workingSettingsJson?: unknown;
  communicationSettingsJson?: unknown;
  documentSettingsJson?: unknown;
};

function clean(value: unknown, max = 240) {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text.slice(0, max) : null;
}

function slugify(value: unknown) {
  return (clean(value, 120) ?? "")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function json(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.JsonNull;
  return value as Prisma.InputJsonValue;
}

function date(value: unknown) {
  const text = clean(value, 40);
  if (!text) return null;
  const parsed = new Date(`${text.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function branchData(input: BranchInput, current?: { name: string; shortName: string; slug: string }) {
  const name = clean(input.name, 160) ?? current?.name ?? "";
  const shortName = clean(input.shortName, 80) ?? current?.shortName ?? name;
  const slug = slugify(input.slug ?? input.shortName ?? input.name) || current?.slug || "";
  const optional = <T>(key: keyof BranchInput, value: T) => current && input[key] === undefined ? undefined : value;
  return {
    name,
    shortName,
    slug,
    address: optional("address", clean(input.address, 1000)),
    timezone: optional("timezone", clean(input.timezone, 80) ?? "Europe/Kaliningrad"),
    phone: optional("phone", clean(input.phone, 80)),
    email: optional("email", clean(input.email, 180)),
    telegramUsername: optional("telegramUsername", clean(input.telegramUsername, 180)),
    legalEntityName: optional("legalEntityName", clean(input.legalEntityName, 320)),
    legalEntityType: optional("legalEntityType", clean(input.legalEntityType, 80)),
    inn: optional("inn", clean(input.inn, 24)),
    ogrn: optional("ogrn", clean(input.ogrn, 32)),
    bankDetailsJson: optional("bankDetailsJson", json(input.bankDetailsJson)),
    openingDate: optional("openingDate", date(input.openingDate)),
    status: optional("status", input.status === "inactive" ? "inactive" : "active"),
  };
}

function validate(data: ReturnType<typeof branchData>) {
  if (!data.name) return "Укажите название филиала";
  if (!data.shortName) return "Укажите короткое название филиала";
  if (!data.slug) return "Не удалось сформировать адрес филиала";
  if (data.inn && !/^(?:\d{10}|\d{12})$/.test(data.inn)) return "ИНН должен содержать 10 или 12 цифр";
  return null;
}

export async function createBranch(context: BranchContext, input: BranchInput) {
  if (!hasBranchPermission(context, "branches.create")) return { ok: false as const, status: 403, error: "Недостаточно прав" };
  const data = branchData(input);
  const error = validate(data);
  if (error) return { ok: false as const, status: 400, error };
  const duplicate = await prisma.branch.findFirst({
    where: { businessGroupId: context.businessGroupId, slug: data.slug },
    select: { id: true },
  });
  if (duplicate) return { ok: false as const, status: 409, error: "Филиал с таким адресом уже существует" };

  const branch = await prisma.$transaction(async (tx) => {
    let created = await tx.branch.create({
      data: {
        businessGroupId: context.businessGroupId,
        ...data,
      },
    });
    const createdBranchTenant = {
      mode: "branch" as const,
      branchId: created.id,
      organizationId: created.id,
      allowedBranchIds: [created.id],
      businessGroupId: context.businessGroupId,
      userId: context.userId,
      permissions: context.permissions,
    };
    const organization = await runWithRequestTenant(createdBranchTenant, async () => {
      if (context.userId) {
        await tx.branchMembership.create({
          data: { branchId: created.id, userId: context.userId, roleId: "branch_owner", status: "active" },
        });
      }
      return tx.localOrganization.create({
        data: {
          name: data.shortName,
          entityType: data.legalEntityType ?? "legal_entity",
          fullLegalName: data.legalEntityName,
          inn: data.inn,
          ogrn: data.ogrn,
          actualAddress: data.address,
          phone: data.phone,
          email: data.email,
          isDefault: false,
          isActive: true,
        },
      });
    });
    created = await tx.branch.update({ where: { id: created.id }, data: { legacyOrganizationId: organization.id } });
    await tx.branchAuditLog.create({
      data: {
        businessGroupId: context.businessGroupId,
        branchId: created.id,
        userId: context.userId,
        action: "branch_created",
        entityType: "branch",
        entityId: created.id,
      },
    });
    return created;
  });
  return { ok: true as const, branch };
}

export async function updateBranch(context: BranchContext, branchId: string, input: BranchInput) {
  if (!hasBranchPermission(context, "branches.update", branchId)) return { ok: false as const, status: 403, error: "Недостаточно прав" };
  const current = await prisma.branch.findFirst({ where: { id: branchId, businessGroupId: context.businessGroupId } });
  if (!current) return { ok: false as const, status: 404, error: "Филиал не найден" };
  const data = branchData(input, current);
  const error = validate(data);
  if (error) return { ok: false as const, status: 400, error };

  const requestedOrganizationId = clean(input.organizationId, 120);
  if (requestedOrganizationId) {
    const [organization, linkedBranch] = await Promise.all([
      prisma.localOrganization.findUnique({ where: { id: requestedOrganizationId }, select: { id: true } }),
      prisma.branch.findFirst({ where: { legacyOrganizationId: requestedOrganizationId }, select: { id: true, businessGroupId: true } }),
    ]);
    if (!organization || (linkedBranch && (linkedBranch.id !== branchId || linkedBranch.businessGroupId !== context.businessGroupId))) {
      return { ok: false as const, status: 400, error: "Организация недоступна этому филиалу" };
    }
  }

  const branch = await prisma.$transaction(async (tx) => {
    const updated = await tx.branch.update({
      where: { id: current.id },
      data: { ...data, legacyOrganizationId: requestedOrganizationId ?? undefined },
    });
    const organizationId = requestedOrganizationId ?? current.legacyOrganizationId;
    if (organizationId) {
      await tx.localOrganization.update({
        where: { id: organizationId },
        data: {
          name: data.shortName,
          entityType: data.legalEntityType ?? undefined,
          fullLegalName: data.legalEntityName,
          inn: data.inn,
          ogrn: data.ogrn,
          actualAddress: data.address,
          phone: data.phone,
          email: data.email,
        },
      });
    }
    const hasCommunicationUpdate = [
      input.secondaryPhone,
      input.whatsapp,
      input.communicationEmail,
      input.communicationTelegram,
      input.workingSettingsJson,
      input.communicationSettingsJson,
    ].some((value) => value !== undefined) || input.phone !== undefined;
    if (hasCommunicationUpdate) {
      const existingCommunication = await tx.branchCommunicationSettings.findUnique({ where: { branchId } });
      const existingCallbacks = existingCommunication?.callbackSettingsJson && typeof existingCommunication.callbackSettingsJson === "object" && !Array.isArray(existingCommunication.callbackSettingsJson)
        ? existingCommunication.callbackSettingsJson as Prisma.JsonObject
        : {};
      const callbackSettingsJson = {
        ...existingCallbacks,
        ...(input.workingSettingsJson !== undefined ? { work: input.workingSettingsJson } : {}),
        ...(input.communicationSettingsJson !== undefined ? { messages: input.communicationSettingsJson } : {}),
      } as Prisma.InputJsonValue;
      await tx.branchCommunicationSettings.upsert({
        where: { branchId },
        create: {
          branchId,
          primaryPhone: clean(input.phone, 80) ?? updated.phone ?? "Не указан",
          secondaryPhone: clean(input.secondaryPhone, 80),
          whatsapp: clean(input.whatsapp, 180),
          telegram: clean(input.communicationTelegram, 180),
          email: clean(input.communicationEmail, 180) ?? updated.email,
          callbackSettingsJson,
        },
        update: {
          primaryPhone: input.phone === undefined ? undefined : clean(input.phone, 80) ?? "Не указан",
          secondaryPhone: input.secondaryPhone === undefined ? undefined : clean(input.secondaryPhone, 80),
          whatsapp: input.whatsapp === undefined ? undefined : clean(input.whatsapp, 180),
          telegram: input.communicationTelegram === undefined ? undefined : clean(input.communicationTelegram, 180),
          email: input.communicationEmail === undefined ? undefined : clean(input.communicationEmail, 180),
          callbackSettingsJson,
        },
      });
    }
    if (input.documentSettingsJson !== undefined) {
      const primary = await tx.branchLegalEntity.findFirst({ where: { branchId }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] });
      if (primary) {
        await tx.branchLegalEntity.update({ where: { id: primary.id }, data: { documentSettingsJson: json(input.documentSettingsJson) } });
      } else {
        await tx.branchLegalEntity.create({
          data: {
            branchId,
            name: updated.legalEntityName ?? updated.shortName,
            entityType: updated.legalEntityType ?? "legal_entity",
            inn: updated.inn,
            ogrn: updated.ogrn,
            legalAddress: updated.address,
            bankDetailsJson: updated.bankDetailsJson ?? undefined,
            documentSettingsJson: json(input.documentSettingsJson),
            isPrimary: true,
          },
        });
      }
    }
    await tx.branchAuditLog.create({
      data: {
        businessGroupId: context.businessGroupId,
        branchId: updated.id,
        userId: context.userId,
        action: "branch_updated",
        entityType: "branch",
        entityId: updated.id,
      },
    });
    return updated;
  });
  return { ok: true as const, branch };
}

export async function archiveBranch(context: BranchContext, branchId: string) {
  if (!hasBranchPermission(context, "branches.archive", branchId)) return { ok: false as const, status: 403, error: "Недостаточно прав" };
  const branch = await prisma.branch.findFirst({ where: { id: branchId, businessGroupId: context.businessGroupId } });
  if (!branch) return { ok: false as const, status: 404, error: "Филиал не найден" };
  if (branch.status === "archived") return { ok: true as const, branch };
  const activeCount = await prisma.branch.count({ where: { businessGroupId: context.businessGroupId, status: "active" } });
  if (activeCount <= 1) return { ok: false as const, status: 409, error: "Нельзя архивировать единственный активный филиал" };

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.branch.update({ where: { id: branch.id }, data: { status: "archived" } });
    if (branch.legacyOrganizationId) {
      await tx.localOrganization.update({
        where: { id: branch.legacyOrganizationId },
        data: { isActive: false, isDefault: false, archivedAt: new Date() },
      });
    }
    await tx.branchTelegramIntegration.updateMany({
      where: { branchId: branch.id },
      data: { status: "disabled" },
    });
    await tx.branchAuditLog.create({
      data: {
        businessGroupId: context.businessGroupId,
        branchId: branch.id,
        userId: context.userId,
        action: "branch_archived",
        entityType: "branch",
        entityId: branch.id,
      },
    });
    return row;
  });
  return { ok: true as const, branch: updated };
}
