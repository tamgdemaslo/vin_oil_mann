import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { BranchContext } from "@/lib/branch-context";
import { resolveCatalogProductSelection } from "@/lib/catalog-search";
import { prisma } from "@/lib/db";
import { productIdentityKey } from "@/lib/product-identity";
import {
  storefrontIdentityEvidence,
  storefrontPublicationReadiness,
  storefrontTechnicalConflicts,
  type StorefrontIdentityEvidence,
  type StorefrontIdentityProduct,
} from "@/lib/storefront-product-identity";

export const STOREFRONT_PUBLICATION_STATES = ["HIDDEN", "PUBLISHED"] as const;
export type StorefrontPublicationState = (typeof STOREFRONT_PUBLICATION_STATES)[number];

const PUBLICATION_BATCH_LIMIT = 5_000;
const PUBLICATION_BATCH_TTL_MS = 30 * 60 * 1_000;

export class StorefrontPublicationError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "storefront_publication_error"
  ) {
    super(message);
    this.name = "StorefrontPublicationError";
  }
}

export function canManageStorefrontPublication(context: BranchContext) {
  return context.user.role === "owner" || context.groupRole === "group_owner" || context.groupRole === "group_admin";
}

function requirePublicationPermission(context: BranchContext) {
  if (!canManageStorefrontPublication(context)) {
    throw new StorefrontPublicationError(
      "Общей публикацией сайта может управлять владелец или администратор бизнес-группы.",
      403,
      "storefront_publication_forbidden"
    );
  }
}

function parseState(value: unknown): StorefrontPublicationState {
  if (value === "HIDDEN" || value === "PUBLISHED") return value;
  throw new StorefrontPublicationError("Не выбрано состояние публикации.", 400, "publication_state_required");
}

async function activeStorefrontForGroup(businessGroupId: string) {
  const storefronts = await prisma.storefront.findMany({
    where: { businessGroupId, status: "ACTIVE" },
    include: {
      branches: {
        where: { status: "ACTIVE", branch: { status: "active" } },
        include: {
          branch: true,
          stores: { where: { store: { archived: false } }, include: { store: true } },
        },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      },
    },
    take: 2,
  });
  if (storefronts.length === 0) {
    throw new StorefrontPublicationError(
      "Клиентская витрина для бизнес-группы ещё не настроена.",
      409,
      "storefront_not_configured"
    );
  }
  if (storefronts.length > 1) {
    throw new StorefrontPublicationError(
      "Для бизнес-группы найдено несколько активных витрин. Выберите одну в настройках.",
      409,
      "storefront_ambiguous"
    );
  }
  const storefront = storefronts[0];
  if (!storefront.branches.length || storefront.branches.some((branch) => branch.stores.length === 0)) {
    throw new StorefrontPublicationError(
      "У витрины должны быть явно выбраны публичные филиалы и склады.",
      409,
      "storefront_branches_incomplete"
    );
  }
  return storefront;
}

type StorefrontWithBranches = Awaited<ReturnType<typeof activeStorefrontForGroup>>;
type IdentityBinding = Prisma.StorefrontProductBindingGetPayload<{
  include: {
    localProduct: true;
    storefrontProduct: {
      include: {
        contentSource: true;
        bindings: { include: { localProduct: true } };
      };
    };
  };
}>;

async function identityBindings(storefrontId: string, client: Prisma.TransactionClient | typeof prisma = prisma) {
  return client.storefrontProductBinding.findMany({
    where: {
      status: "CONFIRMED",
      storefrontProduct: { storefrontId },
    },
    include: {
      localProduct: true,
      storefrontProduct: {
        include: {
          contentSource: true,
          bindings: { where: { status: "CONFIRMED" }, include: { localProduct: true } },
        },
      },
    },
  });
}

type MatchCandidate = {
  storefrontProductId: string;
  evidence: StorefrontIdentityEvidence;
  binding: IdentityBinding;
};

function candidatePriority(value: StorefrontIdentityEvidence) {
  if (value === "CONFIRMED_BINDING") return 0;
  if (value === "SOURCE_LINEAGE") return 1;
  if (value === "BARCODE") return 2;
  if (value === "BRAND_ARTICLE") return 3;
  return 4;
}

function findCandidate(product: StorefrontIdentityProduct & { sourceProductId?: string | null }, bindings: IdentityBinding[]) {
  const existing = bindings.find((binding) => binding.localProductId === product.id);
  if (existing) {
    return {
      candidate: {
        storefrontProductId: existing.storefrontProductId,
        evidence: "CONFIRMED_BINDING" as const,
        binding: existing,
      },
      ambiguous: false,
    };
  }

  const candidates = bindings.flatMap((binding): MatchCandidate[] => {
    if (binding.localProduct.archived || binding.storefrontProduct.contentSource.archived) return [];
    const sourceLineage = product.sourceProductId === binding.localProductId
      || binding.localProduct.sourceProductId === product.id;
    const evidence = storefrontIdentityEvidence(product, binding.localProduct, { sourceLineage });
    return evidence ? [{ storefrontProductId: binding.storefrontProductId, evidence, binding }] : [];
  });
  candidates.sort((left, right) => candidatePriority(left.evidence) - candidatePriority(right.evidence));
  const bestPriority = candidates[0] ? candidatePriority(candidates[0].evidence) : null;
  const best = bestPriority == null ? [] : candidates.filter((item) => candidatePriority(item.evidence) === bestPriority);
  const publicIds = new Set(best.map((item) => item.storefrontProductId));
  return { candidate: publicIds.size === 1 ? best[0] : null, ambiguous: publicIds.size > 1 };
}

function linkedConflicts(candidate: MatchCandidate | null, product: StorefrontIdentityProduct) {
  if (!candidate) return [];
  const source = candidate.binding.storefrontProduct.contentSource;
  const linked = candidate.binding.storefrontProduct.bindings
    .map((binding) => binding.localProduct)
    .filter((item) => item.id !== product.id);
  return storefrontTechnicalConflicts(source, [product, ...linked]);
}

function productProblems(
  state: StorefrontPublicationState,
  product: StorefrontIdentityProduct & {
    entityType?: string | null;
    archived?: boolean;
    salePriceCents?: number | null;
  },
  candidate: MatchCandidate | null,
  ambiguous: boolean
) {
  if (state === "HIDDEN") return [];
  const problems = storefrontPublicationReadiness(product);
  if (ambiguous) problems.push("Найдено несколько возможных общих карточек — требуется ручной выбор.");
  const conflicts = linkedConflicts(candidate, product);
  if (conflicts.length) problems.push(`Конфликт связанных карточек: ${conflicts.join(", ")}.`);
  if (
    candidate &&
    candidate.binding.branchId === product.branchId &&
    candidate.binding.localProductId !== product.id
  ) {
    problems.push("В этом филиале к общей карточке уже привязан другой товар.");
  }
  return [...new Set(problems)];
}

function selectionHash(products: Array<{ id: string; updatedAt: Date }>) {
  const value = products
    .map((product) => `${product.id}:${product.updatedAt.toISOString()}`)
    .sort()
    .join("\n");
  return crypto.createHash("sha256").update(value).digest("hex");
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function publicBranchSummary(storefront: StorefrontWithBranches) {
  return storefront.branches.map((configured) => ({
    id: configured.id,
    name: configured.publicName?.trim() || configured.branch.shortName || configured.branch.name,
    address: configured.publicAddress?.trim() || configured.branch.address || null,
    stores: configured.stores.map((item) => ({ id: item.store.id, name: item.store.name })),
  }));
}

async function resolveSelectedProductIds(
  context: BranchContext,
  input: { productIds?: unknown[]; selection?: unknown }
) {
  const explicit = Array.isArray(input.productIds)
    ? [...new Set(input.productIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0).map((id) => id.trim()))]
    : [];
  if (explicit.length > PUBLICATION_BATCH_LIMIT) {
    throw new StorefrontPublicationError(
      `За одну операцию можно обработать не более ${PUBLICATION_BATCH_LIMIT} товаров. Уточните выборку.`,
      400,
      "publication_selection_too_large"
    );
  }
  if (explicit.length) return { productIds: explicit, selection: { productIds: explicit } };
  if (!input.selection) {
    throw new StorefrontPublicationError("Выберите хотя бы один товар.", 400, "publication_selection_empty");
  }
  const resolved = await resolveCatalogProductSelection(input.selection, PUBLICATION_BATCH_LIMIT);
  if (!resolved.productIds.length) {
    throw new StorefrontPublicationError("В выбранной выборке нет товаров.", 400, "publication_selection_empty");
  }
  return { productIds: resolved.productIds, selection: resolved.snapshot };
}

export async function previewStorefrontPublication(
  context: BranchContext,
  input: { state?: unknown; productIds?: unknown[]; selection?: unknown }
) {
  requirePublicationPermission(context);
  if (!context.branchId) throw new StorefrontPublicationError("Выберите конкретный филиал.", 409, "branch_required");
  const state = parseState(input.state);
  const storefront = await activeStorefrontForGroup(context.businessGroupId);
  if (!storefront.branches.some((configured) => configured.branchId === context.branchId)) {
    throw new StorefrontPublicationError(
      "Текущий филиал не включён в клиентскую витрину.",
      409,
      "branch_not_in_storefront"
    );
  }
  const selected = await resolveSelectedProductIds(context, input);
  const products = await prisma.localProduct.findMany({
    where: { branchId: context.branchId, id: { in: selected.productIds } },
  });
  if (products.length !== selected.productIds.length) {
    throw new StorefrontPublicationError(
      "Состав выборки изменился или часть товаров не принадлежит текущему филиалу. Обновите список.",
      409,
      "publication_selection_changed"
    );
  }

  const bindings = await identityBindings(storefront.id);
  const selectedIdentityCounts = new Map<string, number>();
  for (const product of products) {
    const key = productIdentityKey(product);
    if (key) selectedIdentityCounts.set(key, (selectedIdentityCounts.get(key) ?? 0) + 1);
  }
  const previews = products.map((product) => {
    const { candidate, ambiguous } = findCandidate(product, bindings);
    const problems = productProblems(state, product, candidate, ambiguous);
    const identityKey = productIdentityKey(product);
    if (state === "PUBLISHED" && identityKey && (selectedIdentityCounts.get(identityKey) ?? 0) > 1) {
      problems.push("В выборке есть другая филиальная строка с той же точной SKU-идентичностью — устраните дубль в CRM.");
    }
    const currentState = candidate?.binding.storefrontProduct.publicationState ?? "HIDDEN";
    return {
      product,
      candidate,
      problems,
      currentState,
      publicKey: candidate?.storefrontProductId ?? `new:${product.id}`,
    };
  });
  const uniqueProducts = new Set(previews.map((item) => item.publicKey)).size;
  const alreadyDesired = previews.filter((item) => item.currentState === state && item.candidate).length;
  const readyItems = previews.filter((item) => item.problems.length === 0).length;
  const blockedItems = previews.length - readyItems;
  const expiresAt = new Date(Date.now() + PUBLICATION_BATCH_TTL_MS);

  const batch = await prisma.storefrontPublicationBatch.create({
    data: {
      storefrontId: storefront.id,
      requestedState: state,
      selectionJson: jsonValue(selected.selection),
      selectionHash: selectionHash(products),
      selectedRows: products.length,
      uniqueProducts,
      alreadyDesired,
      readyItems,
      blockedItems,
      createdByLogin: context.user.login,
      expiresAt,
      items: {
        create: previews.map((item) => ({
          branchId: item.product.branchId,
          localProductId: item.product.id,
          localProductUpdatedAt: item.product.updatedAt,
          storefrontProductId: item.candidate?.storefrontProductId ?? null,
          storefrontProductVersion: item.candidate?.binding.storefrontProduct.version ?? null,
          readinessJson: item.problems as Prisma.InputJsonValue,
          result: item.problems.length ? "BLOCKED" : "PENDING",
        })),
      },
    },
  });

  return {
    batchId: batch.id,
    state,
    expiresAt: expiresAt.toISOString(),
    selectedRows: products.length,
    uniqueProducts,
    alreadyDesired,
    readyItems,
    blockedItems,
    branches: publicBranchSummary(storefront),
    items: previews.map((item) => ({
      localProductId: item.product.id,
      name: item.product.name,
      currentState: item.currentState,
      storefrontProductId: item.candidate?.storefrontProductId ?? null,
      matchingEvidence: item.candidate?.evidence ?? null,
      ready: item.problems.length === 0,
      problems: item.problems,
    })),
  };
}

function newStorefrontProductId() {
  return crypto.randomUUID();
}

async function ensureBinding(
  tx: Prisma.TransactionClient,
  input: {
    storefrontId: string;
    product: Prisma.LocalProductGetPayload<object>;
    actorLogin: string;
  }
) {
  const bindings = await identityBindings(input.storefrontId, tx);
  const { candidate, ambiguous } = findCandidate(input.product, bindings);
  if (ambiguous) {
    throw new StorefrontPublicationError(
      "Найдено несколько возможных общих карточек — требуется ручной выбор.",
      409,
      "storefront_identity_ambiguous"
    );
  }
  const problems = productProblems("PUBLISHED", input.product, candidate, false);
  if (problems.length) {
    throw new StorefrontPublicationError(problems.join(" "), 409, "storefront_product_not_ready");
  }
  if (candidate) {
    if (candidate.evidence === "CONFIRMED_BINDING") return candidate.binding.storefrontProduct;
    const existingForBranch = candidate.binding.storefrontProduct.bindings.find(
      (binding) => binding.branchId === input.product.branchId
    );
    if (existingForBranch && existingForBranch.localProductId !== input.product.id) {
      throw new StorefrontPublicationError(
        "В этом филиале к общей карточке уже привязан другой товар.",
        409,
        "storefront_branch_binding_conflict"
      );
    }
    await tx.storefrontProductBinding.create({
      data: {
        storefrontProductId: candidate.storefrontProductId,
        branchId: input.product.branchId,
        localProductId: input.product.id,
        identityEvidence: candidate.evidence,
        confirmedByLogin: input.actorLogin,
        confirmedAt: new Date(),
      },
    });
    await tx.storefrontProductAudit.create({
      data: {
        storefrontProductId: candidate.storefrontProductId,
        actorLogin: input.actorLogin,
        action: "BIND_PRODUCT",
        metadata: {
          branchId: input.product.branchId,
          localProductId: input.product.id,
          evidence: candidate.evidence,
        },
      },
    });
    return candidate.binding.storefrontProduct;
  }

  const id = newStorefrontProductId();
  return tx.storefrontProduct.create({
    data: {
      id,
      storefrontId: input.storefrontId,
      slug: `oil-${id}`,
      publicationState: "HIDDEN",
      contentSourceBranchId: input.product.branchId,
      contentSourceProductId: input.product.id,
      bindings: {
        create: {
          branchId: input.product.branchId,
          localProductId: input.product.id,
          identityEvidence: "MANUAL",
          confirmedByLogin: input.actorLogin,
          confirmedAt: new Date(),
        },
      },
      audits: {
        create: {
          actorLogin: input.actorLogin,
          action: "CREATE_PUBLIC_PRODUCT",
          afterState: "HIDDEN",
          metadata: { branchId: input.product.branchId, localProductId: input.product.id },
        },
      },
    },
  });
}

async function applyPublicationItem(input: {
  batch: {
    id: string;
    storefrontId: string;
    requestedState: string;
    createdByLogin: string;
  };
  item: {
    id: string;
    branchId: string;
    localProductId: string;
    localProductUpdatedAt: Date;
    storefrontProductId: string | null;
    storefrontProductVersion: number | null;
    result: string;
  };
  actorLogin: string;
}) {
  if (input.item.result === "BLOCKED") return "BLOCKED";
  return prisma.$transaction(async (tx) => {
    const configuredBranch = await tx.storefrontBranch.findFirst({
      where: {
        storefrontId: input.batch.storefrontId,
        branchId: input.item.branchId,
        status: "ACTIVE",
        branch: { status: "active" },
        stores: { some: {} },
      },
      select: { id: true },
    });
    if (!configuredBranch) {
      throw new StorefrontPublicationError(
        "Филиал или его публичные склады изменились после предпросмотра. Подготовьте операцию заново.",
        409,
        "publication_branch_context_changed"
      );
    }
    const product = await tx.localProduct.findFirst({
      where: { branchId: input.item.branchId, id: input.item.localProductId },
    });
    if (!product || product.updatedAt.getTime() !== input.item.localProductUpdatedAt.getTime()) {
      throw new StorefrontPublicationError(
        "Карточка изменилась после предпросмотра. Подготовьте операцию заново.",
        409,
        "publication_version_conflict"
      );
    }

    let storefrontProduct = input.item.storefrontProductId
      ? await tx.storefrontProduct.findFirst({
          where: { id: input.item.storefrontProductId, storefrontId: input.batch.storefrontId },
        })
      : null;
    if (
      storefrontProduct &&
      input.item.storefrontProductVersion != null &&
      storefrontProduct.version !== input.item.storefrontProductVersion
    ) {
      throw new StorefrontPublicationError(
        "Общая карточка изменилась после предпросмотра. Подготовьте операцию заново.",
        409,
        "publication_version_conflict"
      );
    }

    const requestedState = parseState(input.batch.requestedState);
    if (requestedState === "PUBLISHED") {
      const boundProduct = await ensureBinding(tx, {
        storefrontId: input.batch.storefrontId,
        product,
        actorLogin: input.actorLogin,
      });
      if (storefrontProduct && boundProduct.id !== storefrontProduct.id) {
        throw new StorefrontPublicationError(
          "Связь товара изменилась после предпросмотра. Подготовьте операцию заново.",
          409,
          "publication_version_conflict"
        );
      }
      storefrontProduct = boundProduct;
    } else if (!storefrontProduct) {
      const binding = await tx.storefrontProductBinding.findUnique({
        where: { localProductId: product.id },
        include: { storefrontProduct: true },
      });
      storefrontProduct = binding?.storefrontProduct.storefrontId === input.batch.storefrontId
        ? binding.storefrontProduct
        : null;
    }

    if (!storefrontProduct) {
      await tx.storefrontPublicationBatchItem.update({
        where: { id: input.item.id },
        data: { result: "SKIPPED", errorCode: "not_linked", errorMessage: "Товар ещё не связан с витриной." },
      });
      return "SKIPPED";
    }
    if (storefrontProduct.publicationState === requestedState) {
      await tx.storefrontPublicationBatchItem.update({
        where: { id: input.item.id },
        data: { result: "SKIPPED", storefrontProductId: storefrontProduct.id },
      });
      return "SKIPPED";
    }

    const updated = await tx.storefrontProduct.update({
      where: { id: storefrontProduct.id },
      data: {
        publicationState: requestedState,
        publishedAt: requestedState === "PUBLISHED" ? new Date() : storefrontProduct.publishedAt,
        version: { increment: 1 },
      },
    });
    await tx.storefrontProductAudit.create({
      data: {
        storefrontProductId: updated.id,
        actorLogin: input.actorLogin,
        action: requestedState === "PUBLISHED" ? "PUBLISH" : "HIDE",
        beforeState: storefrontProduct.publicationState,
        afterState: requestedState,
        metadata: { batchId: input.batch.id, localProductId: product.id, branchId: product.branchId },
      },
    });
    await tx.storefrontPublicationBatchItem.update({
      where: { id: input.item.id },
      data: { result: "APPLIED", storefrontProductId: updated.id },
    });
    return "APPLIED";
  });
}

export async function applyStorefrontPublication(context: BranchContext, batchIdValue: unknown) {
  requirePublicationPermission(context);
  const batchId = typeof batchIdValue === "string" ? batchIdValue.trim() : "";
  if (!batchId) throw new StorefrontPublicationError("Не указан предпросмотр операции.", 400, "batch_required");
  const batch = await prisma.storefrontPublicationBatch.findFirst({
    where: { id: batchId, storefront: { businessGroupId: context.businessGroupId } },
    include: { items: { orderBy: { createdAt: "asc" } } },
  });
  if (!batch) throw new StorefrontPublicationError("Предпросмотр не найден.", 404, "batch_not_found");
  if (batch.status === "APPLIED" || batch.status === "PARTIAL") return publicationBatchResult(batch.id);
  if (batch.expiresAt.getTime() <= Date.now()) {
    await prisma.storefrontPublicationBatch.update({ where: { id: batch.id }, data: { status: "EXPIRED" } });
    throw new StorefrontPublicationError("Предпросмотр устарел. Подготовьте операцию заново.", 409, "batch_expired");
  }

  for (const item of batch.items) {
    if (item.result === "BLOCKED") continue;
    try {
      await applyPublicationItem({ batch, item, actorLogin: context.user.login });
    } catch (error) {
      const code = error instanceof StorefrontPublicationError ? error.code : "publication_item_failed";
      const message = error instanceof Error ? error.message : "Не удалось изменить публикацию.";
      await prisma.storefrontPublicationBatchItem.update({
        where: { id: item.id },
        data: { result: code === "publication_version_conflict" ? "CONFLICT" : "ERROR", errorCode: code, errorMessage: message },
      });
    }
  }

  const counts = await prisma.storefrontPublicationBatchItem.groupBy({
    by: ["result"],
    where: { batchId: batch.id },
    _count: { _all: true },
  });
  const count = new Map(counts.map((item) => [item.result, item._count._all]));
  const failedItems = (count.get("ERROR") ?? 0) + (count.get("CONFLICT") ?? 0);
  await prisma.storefrontPublicationBatch.update({
    where: { id: batch.id },
    data: {
      status: failedItems || (count.get("BLOCKED") ?? 0) ? "PARTIAL" : "APPLIED",
      appliedItems: count.get("APPLIED") ?? 0,
      skippedItems: count.get("SKIPPED") ?? 0,
      failedItems,
      appliedAt: new Date(),
    },
  });
  return publicationBatchResult(batch.id);
}

async function publicationBatchResult(batchId: string) {
  const batch = await prisma.storefrontPublicationBatch.findUniqueOrThrow({
    where: { id: batchId },
    include: {
      items: {
        include: { localProduct: { select: { name: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  return {
    batchId: batch.id,
    state: batch.requestedState,
    status: batch.status,
    selectedRows: batch.selectedRows,
    uniqueProducts: batch.uniqueProducts,
    appliedItems: batch.appliedItems,
    skippedItems: batch.skippedItems,
    failedItems: batch.failedItems,
    blockedItems: batch.blockedItems,
    items: batch.items.map((item) => ({
      localProductId: item.localProductId,
      name: item.localProduct.name,
      storefrontProductId: item.storefrontProductId,
      result: item.result,
      errorCode: item.errorCode,
      errorMessage: item.errorMessage,
    })),
  };
}

export async function getStorefrontPublicationStatus(context: BranchContext, localProductIdValue: unknown) {
  const localProductId = typeof localProductIdValue === "string" ? localProductIdValue.trim() : "";
  if (!localProductId || !context.branchId) return null;
  let storefront: StorefrontWithBranches;
  try {
    storefront = await activeStorefrontForGroup(context.businessGroupId);
  } catch (error) {
    if (error instanceof StorefrontPublicationError && error.code === "storefront_not_configured") {
      return {
        configured: false,
        canManage: canManageStorefrontPublication(context),
        state: "HIDDEN",
        ready: false,
        problems: [error.message],
        storefrontProductId: null,
        publicUrl: null,
        contentSourceProductId: null,
        bindingCandidates: [],
        branches: [],
      };
    }
    throw error;
  }
  const product = await prisma.localProduct.findFirst({
    where: { branchId: context.branchId, id: localProductId },
  });
  if (!product) return null;
  const binding = await prisma.storefrontProductBinding.findUnique({
    where: { localProductId },
    include: {
      storefrontProduct: {
        include: {
          contentSource: true,
          bindings: {
            where: { status: "CONFIRMED" },
            include: { localProduct: { include: { stockBalances: true } } },
          },
        },
      },
    },
  });
  const publicProduct = binding?.storefrontProduct.storefrontId === storefront.id ? binding.storefrontProduct : null;
  const candidateBindings = publicProduct ? [] : await identityBindings(storefront.id);
  const bindingCandidates = new Map<string, {
    storefrontProductId: string;
    name: string;
    state: StorefrontPublicationState;
    evidence: StorefrontIdentityEvidence;
    branches: string[];
  }>();
  for (const candidateBinding of candidateBindings) {
    const candidateProduct = candidateBinding.storefrontProduct;
    if (candidateBinding.localProduct.archived || candidateProduct.contentSource.archived) continue;
    if (candidateProduct.bindings.some((item) => item.branchId === product.branchId)) continue;
    const sourceLineage = product.sourceProductId === candidateBinding.localProductId
      || candidateBinding.localProduct.sourceProductId === product.id;
    const evidence = storefrontIdentityEvidence(product, candidateBinding.localProduct, { sourceLineage });
    if (!evidence || storefrontTechnicalConflicts(candidateProduct.contentSource, [
      product,
      ...candidateProduct.bindings.map((item) => item.localProduct),
    ]).length) continue;
    const previous = bindingCandidates.get(candidateProduct.id);
    if (previous && candidatePriority(previous.evidence) <= candidatePriority(evidence)) continue;
    bindingCandidates.set(candidateProduct.id, {
      storefrontProductId: candidateProduct.id,
      name: candidateProduct.publicName?.trim() || candidateProduct.contentSource.name,
      state: candidateProduct.publicationState as StorefrontPublicationState,
      evidence,
      branches: candidateProduct.bindings.map((item) => {
        const configured = storefront.branches.find((branch) => branch.branchId === item.branchId);
        return configured?.publicName?.trim() || configured?.branch.shortName || configured?.branch.name || item.branchId;
      }),
    });
  }
  const basicProblems = storefrontPublicationReadiness(product);
  const conflicts = publicProduct
    ? storefrontTechnicalConflicts(
        publicProduct.contentSource,
        publicProduct.bindings.map((item) => item.localProduct).filter((item) => item.id !== publicProduct.contentSourceProductId)
      )
    : [];
  const allowedStoreIds = new Set(storefront.branches.flatMap((configured) => configured.stores.map((item) => item.storeId)));
  const hasNegativeAllowedBalance = Boolean(publicProduct?.bindings.some((item) =>
    item.localProduct.stockBalances.some((balance) => allowedStoreIds.has(balance.storeId) && Number(balance.available) < 0)
  ));
  const problems = [
    ...basicProblems,
    ...(bindingCandidates.size > 1
      ? ["Найдено несколько безопасных общих карточек — владелец должен выбрать нужную связь."]
      : []),
    ...(publicProduct?.contentSource.archived
      ? ["Источник содержимого публичной карточки находится в архиве — выберите активный источник перед следующей публикацией."]
      : []),
    ...(hasNegativeAllowedBalance
      ? ["В разрешённом публичном складе найден отрицательный доступный остаток; на сайте он будет показан как ноль."]
      : []),
    ...(conflicts.length ? [`Конфликт связанных карточек: ${conflicts.join(", ")}.`] : []),
  ];
  const bindingsByBranch = new Map(publicProduct?.bindings.map((item) => [item.branchId, item]) ?? []);
  return {
    configured: true,
    canManage: canManageStorefrontPublication(context),
    state: publicProduct?.publicationState ?? "HIDDEN",
    ready: problems.length === 0,
    problems,
    storefrontProductId: publicProduct?.id ?? null,
    publicUrl: publicProduct ? `/client-site/#/product/${publicProduct.id}` : null,
    contentSourceProductId: publicProduct?.contentSourceProductId ?? product.id,
    bindingCandidates: [...bindingCandidates.values()].sort((left, right) =>
      candidatePriority(left.evidence) - candidatePriority(right.evidence) || left.name.localeCompare(right.name, "ru")
    ).slice(0, 20),
    branches: storefront.branches.map((configured) => {
      const linked = bindingsByBranch.get(configured.branchId);
      const allowedStoreIds = new Set(configured.stores.map((item) => item.storeId));
      const available = linked
        ? linked.localProduct.stockBalances
            .filter((balance) => allowedStoreIds.has(balance.storeId))
            .reduce((sum, balance) => sum + Number(balance.available), 0)
        : null;
      return {
        id: configured.id,
        name: configured.publicName?.trim() || configured.branch.shortName || configured.branch.name,
        address: configured.publicAddress?.trim() || configured.branch.address || null,
        linked: Boolean(linked),
        isContentSource: linked?.localProductId === publicProduct?.contentSourceProductId,
        localProductId: linked?.localProductId ?? null,
        available: available == null ? null : Math.max(0, available),
        uom: linked?.localProduct.uomName ?? null,
        price: linked && linked.localProduct.salePriceCents > 0 ? linked.localProduct.salePriceCents / 100 : null,
      };
    }),
  };
}

export async function bindStorefrontProductCandidate(
  context: BranchContext,
  localProductIdValue: unknown,
  storefrontProductIdValue: unknown
) {
  requirePublicationPermission(context);
  const localProductId = typeof localProductIdValue === "string" ? localProductIdValue.trim() : "";
  const storefrontProductId = typeof storefrontProductIdValue === "string" ? storefrontProductIdValue.trim() : "";
  if (!context.branchId || !localProductId || !storefrontProductId) {
    throw new StorefrontPublicationError("Не выбраны товар и общая карточка.", 400, "storefront_binding_required");
  }
  const storefront = await activeStorefrontForGroup(context.businessGroupId);
  if (!storefront.branches.some((configured) => configured.branchId === context.branchId)) {
    throw new StorefrontPublicationError("Текущий филиал не включён в клиентскую витрину.", 409, "branch_not_in_storefront");
  }

  await prisma.$transaction(async (tx) => {
    const product = await tx.localProduct.findFirst({ where: { branchId: context.branchId!, id: localProductId } });
    if (!product) throw new StorefrontPublicationError("Товар не найден.", 404, "storefront_product_not_found");
    const readiness = storefrontPublicationReadiness(product);
    if (readiness.length) {
      throw new StorefrontPublicationError(readiness.join(" "), 409, "storefront_product_not_ready");
    }
    const existing = await tx.storefrontProductBinding.findUnique({ where: { localProductId } });
    if (existing) {
      if (existing.storefrontProductId === storefrontProductId) return;
      throw new StorefrontPublicationError(
        "Товар уже связан с другой общей карточкой. Автоматическая перепривязка запрещена.",
        409,
        "storefront_binding_conflict"
      );
    }
    const target = await tx.storefrontProduct.findFirst({
      where: { id: storefrontProductId, storefrontId: storefront.id },
      include: {
        contentSource: true,
        bindings: { where: { status: "CONFIRMED" }, include: { localProduct: true } },
      },
    });
    if (!target) throw new StorefrontPublicationError("Общая карточка не найдена.", 404, "storefront_target_not_found");
    if (target.contentSource.archived) {
      throw new StorefrontPublicationError(
        "Источник выбранной общей карточки находится в архиве. Сначала выберите активный источник.",
        409,
        "storefront_content_source_archived"
      );
    }
    if (target.bindings.some((item) => item.branchId === product.branchId)) {
      throw new StorefrontPublicationError(
        "Для этого филиала у общей карточки уже есть другой товар.",
        409,
        "storefront_branch_binding_conflict"
      );
    }
    const evidence = target.bindings
      .filter((item) => !item.localProduct.archived)
      .map((item) => storefrontIdentityEvidence(product, item.localProduct, {
        sourceLineage: product.sourceProductId === item.localProductId || item.localProduct.sourceProductId === product.id,
      }))
      .filter((value): value is StorefrontIdentityEvidence => Boolean(value))
      .sort((left, right) => candidatePriority(left) - candidatePriority(right))[0];
    if (!evidence) {
      throw new StorefrontPublicationError(
        "Выбранная карточка не имеет доказуемого совпадения SKU, фасовки и единицы продажи.",
        409,
        "storefront_identity_not_proven"
      );
    }
    const conflicts = storefrontTechnicalConflicts(target.contentSource, [
      product,
      ...target.bindings.map((item) => item.localProduct),
    ]);
    if (conflicts.length) {
      throw new StorefrontPublicationError(
        `Связь заблокирована из-за конфликта: ${conflicts.join(", ")}.`,
        409,
        "storefront_identity_conflict"
      );
    }
    await tx.storefrontProductBinding.create({
      data: {
        storefrontProductId: target.id,
        branchId: product.branchId,
        localProductId: product.id,
        identityEvidence: "MANUAL",
        confirmedByLogin: context.user.login,
        confirmedAt: new Date(),
      },
    });
    await tx.storefrontProductAudit.create({
      data: {
        storefrontProductId: target.id,
        actorLogin: context.user.login,
        action: "BIND_PRODUCT",
        metadata: {
          branchId: product.branchId,
          localProductId: product.id,
          selectedEvidence: evidence,
          confirmation: "MANUAL",
        },
      },
    });
  });

  return getStorefrontPublicationStatus(context, localProductId);
}

export async function changeStorefrontProductContentSource(context: BranchContext, localProductIdValue: unknown) {
  requirePublicationPermission(context);
  const localProductId = typeof localProductIdValue === "string" ? localProductIdValue.trim() : "";
  if (!context.branchId || !localProductId) {
    throw new StorefrontPublicationError("Не выбран товар-источник.", 400, "storefront_source_required");
  }
  const storefront = await activeStorefrontForGroup(context.businessGroupId);
  await prisma.$transaction(async (tx) => {
    const product = await tx.localProduct.findFirst({ where: { branchId: context.branchId!, id: localProductId } });
    if (!product) throw new StorefrontPublicationError("Товар не найден.", 404, "storefront_product_not_found");
    const readiness = storefrontPublicationReadiness(product);
    if (readiness.length) {
      throw new StorefrontPublicationError(readiness.join(" "), 409, "storefront_product_not_ready");
    }
    const binding = await tx.storefrontProductBinding.findUnique({
      where: { localProductId },
      include: {
        storefrontProduct: {
          include: {
            contentSource: true,
            bindings: { where: { status: "CONFIRMED" }, include: { localProduct: true } },
          },
        },
      },
    });
    if (!binding || binding.storefrontProduct.storefrontId !== storefront.id) {
      throw new StorefrontPublicationError("Сначала свяжите товар с общей карточкой.", 409, "storefront_binding_required");
    }
    const publicProduct = binding.storefrontProduct;
    if (publicProduct.contentSourceProductId === product.id) return;
    const conflicts = storefrontTechnicalConflicts(product, publicProduct.bindings
      .map((item) => item.localProduct)
      .filter((item) => !item.archived && item.id !== product.id));
    if (conflicts.length) {
      throw new StorefrontPublicationError(
        `Источник нельзя сменить из-за конфликта: ${conflicts.join(", ")}.`,
        409,
        "storefront_identity_conflict"
      );
    }
    await tx.storefrontProduct.update({
      where: { id: publicProduct.id },
      data: {
        contentSourceBranchId: product.branchId,
        contentSourceProductId: product.id,
        version: { increment: 1 },
      },
    });
    await tx.storefrontProductAudit.create({
      data: {
        storefrontProductId: publicProduct.id,
        actorLogin: context.user.login,
        action: "CHANGE_CONTENT_SOURCE",
        metadata: {
          previousProductId: publicProduct.contentSourceProductId,
          nextProductId: product.id,
          nextBranchId: product.branchId,
        },
      },
    });
  });
  return getStorefrontPublicationStatus(context, localProductId);
}
