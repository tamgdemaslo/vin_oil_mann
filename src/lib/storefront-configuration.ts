import type { BranchContext } from "@/lib/branch-context";
import { prisma } from "@/lib/db";

export class StorefrontConfigurationError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "StorefrontConfigurationError";
  }
}

function canConfigure(context: BranchContext) {
  return context.user.role === "owner" || context.groupRole === "group_owner" || context.groupRole === "group_admin";
}

function requireConfigurationAccess(context: BranchContext) {
  if (!canConfigure(context)) throw new StorefrontConfigurationError("Настройка витрины доступна владельцу или администратору группы.", 403);
  if (context.mode !== "all") throw new StorefrontConfigurationError("Для настройки витрины выберите режим «Все филиалы».", 409);
}

export async function getStorefrontConfiguration(context: BranchContext) {
  requireConfigurationAccess(context);
  const branchIds = context.branches
    .filter((branch) => branch.businessGroupId === context.businessGroupId)
    .map((branch) => branch.id);
  const [branches, stores, storefronts] = await Promise.all([
    prisma.branch.findMany({
      where: { businessGroupId: context.businessGroupId, id: { in: branchIds } },
      select: { id: true, slug: true, name: true, shortName: true, address: true, phone: true, status: true },
      orderBy: [{ name: "asc" }],
    }),
    prisma.localStore.findMany({
      where: { branchId: { in: branchIds }, archived: false },
      select: { id: true, branchId: true, name: true, isMain: true, archived: true },
      orderBy: [{ branchId: "asc" }, { isMain: "desc" }, { name: "asc" }],
    }),
    prisma.storefront.findMany({
      where: { businessGroupId: context.businessGroupId },
      include: { branches: { include: { stores: true }, orderBy: [{ sortOrder: "asc" }] } },
      orderBy: [{ createdAt: "asc" }],
    }),
  ]);
  if (storefronts.length > 1) {
    throw new StorefrontConfigurationError("Для бизнес-группы найдено несколько витрин. Исправьте конфликт перед изменением настроек.", 409);
  }
  const storefront = storefronts[0] ?? null;
  const configuredByBranch = new Map(storefront?.branches.map((branch) => [branch.branchId, branch]) ?? []);
  return {
    canManage: true,
    storefront: storefront ? { id: storefront.id, slug: storefront.slug, name: storefront.name, status: storefront.status } : null,
    branches: branches.map((branch) => {
      const configured = configuredByBranch.get(branch.id);
      return {
        ...branch,
        enabled: configured?.status === "ACTIVE",
        publicName: configured?.publicName ?? "",
        publicAddress: configured?.publicAddress ?? "",
        publicPhone: configured?.publicPhone ?? "",
        sortOrder: configured?.sortOrder ?? 0,
        selectedStoreIds: configured?.stores.map((item) => item.storeId) ?? [],
        stores: stores.filter((store) => store.branchId === branch.id),
      };
    }),
  };
}

type ConfigurationInput = {
  slug?: unknown;
  name?: unknown;
  branches?: unknown;
};

type BranchConfigurationInput = {
  branchId: string;
  storeIds: string[];
  publicName: string | null;
  publicAddress: string | null;
  publicPhone: string | null;
  sortOrder: number;
};

function text(value: unknown, maximum: number) {
  const result = typeof value === "string" ? value.trim().slice(0, maximum) : "";
  return result || null;
}

function parseBranches(value: unknown): BranchConfigurationInput[] {
  if (!Array.isArray(value)) throw new StorefrontConfigurationError("Выберите публичные филиалы.");
  const seen = new Set<string>();
  return value.map((raw, index) => {
    const row = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const branchId = text(row.branchId, 120);
    if (!branchId || seen.has(branchId)) throw new StorefrontConfigurationError("Филиалы в настройке не должны повторяться.");
    seen.add(branchId);
    const storeIds = Array.isArray(row.storeIds)
      ? [...new Set(row.storeIds.map((storeId) => text(storeId, 120)).filter((storeId): storeId is string => Boolean(storeId)))]
      : [];
    if (!storeIds.length) throw new StorefrontConfigurationError("Для каждого публичного филиала выберите хотя бы один склад.");
    return {
      branchId,
      storeIds,
      publicName: text(row.publicName, 160),
      publicAddress: text(row.publicAddress, 1_000),
      publicPhone: text(row.publicPhone, 80),
      sortOrder: Number.isFinite(Number(row.sortOrder)) ? Math.trunc(Number(row.sortOrder)) : index,
    };
  });
}

export async function saveStorefrontConfiguration(context: BranchContext, input: ConfigurationInput) {
  requireConfigurationAccess(context);
  const slug = text(input.slug, 80) ?? "client-site";
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug)) throw new StorefrontConfigurationError("Адрес витрины может содержать только a-z, 0-9 и дефис.");
  const name = text(input.name, 160) ?? "Клиентский сайт";
  const requested = parseBranches(input.branches);
  if (!requested.length) throw new StorefrontConfigurationError("Выберите хотя бы один публичный филиал.");

  const allowedBranchIds = new Set(context.branches
    .filter((branch) => branch.businessGroupId === context.businessGroupId && branch.status === "active")
    .map((branch) => branch.id));
  if (requested.some((branch) => !allowedBranchIds.has(branch.branchId))) {
    throw new StorefrontConfigurationError("В настройке есть недоступный или неактивный филиал.", 403);
  }
  const stores = await prisma.localStore.findMany({
    where: { branchId: { in: requested.map((branch) => branch.branchId) }, archived: false },
    select: { id: true, branchId: true },
  });
  const storeBranch = new Map(stores.map((store) => [store.id, store.branchId]));
  for (const branch of requested) {
    if (branch.storeIds.some((storeId) => storeBranch.get(storeId) !== branch.branchId)) {
      throw new StorefrontConfigurationError("Выбранный склад не принадлежит указанному филиалу.");
    }
  }

  await prisma.$transaction(async (tx) => {
    const existing = await tx.storefront.findMany({ where: { businessGroupId: context.businessGroupId }, take: 2 });
    if (existing.length > 1) throw new StorefrontConfigurationError("Найдено несколько витрин. Автоматическое объединение запрещено.", 409);
    const storefront = existing[0]
      ? await tx.storefront.update({ where: { id: existing[0].id }, data: { slug, name, status: "ACTIVE" } })
      : await tx.storefront.create({ data: { businessGroupId: context.businessGroupId, slug, name, status: "ACTIVE" } });
    await tx.storefrontBranch.updateMany({
      where: { storefrontId: storefront.id, branchId: { notIn: requested.map((branch) => branch.branchId) } },
      data: { status: "INACTIVE" },
    });
    for (const branch of requested) {
      const configured = await tx.storefrontBranch.upsert({
        where: { storefrontId_branchId: { storefrontId: storefront.id, branchId: branch.branchId } },
        create: {
          storefrontId: storefront.id,
          branchId: branch.branchId,
          status: "ACTIVE",
          publicName: branch.publicName,
          publicAddress: branch.publicAddress,
          publicPhone: branch.publicPhone,
          sortOrder: branch.sortOrder,
        },
        update: {
          status: "ACTIVE",
          publicName: branch.publicName,
          publicAddress: branch.publicAddress,
          publicPhone: branch.publicPhone,
          sortOrder: branch.sortOrder,
        },
      });
      await tx.storefrontBranchStore.deleteMany({ where: { storefrontBranchId: configured.id } });
      await tx.storefrontBranchStore.createMany({
        data: branch.storeIds.map((storeId) => ({ storefrontBranchId: configured.id, branchId: branch.branchId, storeId })),
      });
    }
  });
  return getStorefrontConfiguration(context);
}
