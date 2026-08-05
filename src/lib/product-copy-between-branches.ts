import { Prisma, type LocalProduct } from "@prisma/client";
import { type BranchContext, type BranchSummary } from "@/lib/branch-context";
import { buildCatalogSearchText } from "@/lib/catalog-search";
import { dashboardPermissionsFromJson } from "@/lib/dashboard-variant";
import { prisma } from "@/lib/db";

export const PRODUCT_COPY_PERMISSION = "products.copy_between_branches";

export type DuplicateStrategy = "skip" | "update_empty" | "update_selected" | "force_create";
export type ProductCopyOptions = {
  copyRetailPrice: boolean;
  copyPurchasePrice: boolean;
  copyMinimumBalance: boolean;
  mapSupplierByInn: boolean;
  duplicateStrategy: DuplicateStrategy;
  selectedUpdateFields?: string[];
};

export type ProductCopyPreviewRow = {
  sourceProductId: string;
  productName: string;
  article: string | null;
  action: "CREATE" | "SKIP" | "UPDATE_EMPTY" | "UPDATE_SELECTED" | "FORCE_CREATE" | "REVIEW";
  matchingMethod: string | null;
  targetProductId: string | null;
  reason: string | null;
  warnings: string[];
};

export class ProductCopyError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
    public readonly code = "product_copy_invalid",
  ) {
    super(message);
  }
}

const COPYABLE_FIELDS = [
  "name", "entityType", "article", "code", "externalCode", "groupPath", "uomName",
  "description", "minPriceCents", "minPriceCurrencyName", "countryName", "vatLabel",
  "weight", "volume", "modificationCode", "tnvedCode", "sae", "oem", "acea",
  "apiSpec", "packageVolume", "avito", "brand", "atf", "ilsac", "aceaExtra",
  "oemAtf", "rosskoPartNumber", "rosskoBrand", "rosskoMin", "supplierAttribute",
  "oemParts", "params", "mannCharacteristicName", "imageHref", "attributes",
  "markingEnabled", "markingMode", "markingStatus", "markingSettings",
  "markingConfiguredManually", "markingConfiguredAt", "markingConfiguredByLogin",
  "archived", "salePriceCents", "buyPriceCents", "minimumBalance", "currencyName",
  "supplierCounterpartyId", "legacySupplierName",
] as const;

type SourceProduct = Prisma.LocalProductGetPayload<{
  include: {
    supplierCounterparty: { select: { id: true; inn: true; name: true; displayName: true } };
    photos: true;
    mannLinks: true;
  };
}>;

type TargetProduct = Pick<
  LocalProduct,
  "id" | "name" | "brand" | "article" | "code" | "barcodeEan13" | "barcodeEan8" | "barcodeCode128"
  | "sourceProductId" | "salePriceCents" | "buyPriceCents" | "minimumBalance" | "supplierCounterpartyId"
> & Record<string, unknown>;

function normalized(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("ru-RU")
    .replace(/[ё]/g, "е")
    .replace(/[^a-zа-я0-9]+/giu, "");
}

function normalizedName(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("ru-RU")
    .replace(/[ё]/g, "е")
    .replace(/[^a-zа-я0-9]+/giu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function sameNonEmpty(left: string | null | undefined, right: string | null | undefined) {
  const a = normalized(left);
  const b = normalized(right);
  return Boolean(a && b && a === b);
}

function parseOptions(input: unknown): ProductCopyOptions {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const strategy = source.duplicateStrategy;
  return {
    copyRetailPrice: source.copyRetailPrice !== false,
    copyPurchasePrice: source.copyPurchasePrice === true,
    copyMinimumBalance: source.copyMinimumBalance === true,
    mapSupplierByInn: source.mapSupplierByInn === true,
    duplicateStrategy: strategy === "update_empty" || strategy === "update_selected" || strategy === "force_create" ? strategy : "skip",
    selectedUpdateFields: Array.isArray(source.selectedUpdateFields)
      ? source.selectedUpdateFields.filter((value): value is string => typeof value === "string").slice(0, 50)
      : [],
  };
}

function canManageProductCopy(context: BranchContext) {
  return context.user.role === "owner" ||
    context.groupRole === "group_owner" ||
    context.groupRole === "group_admin";
}

function hasCopyPermission(value: unknown) {
  return dashboardPermissionsFromJson(value).has(PRODUCT_COPY_PERMISSION);
}

export async function getProductCopyCapabilities(context: BranchContext) {
  if (!context.branchId || !context.branch) {
    return { canCopy: false, sourceBranch: null, targetBranches: [] as BranchSummary[] };
  }

  const activeCandidates = context.branches.filter((branch) =>
    branch.id !== context.branchId &&
    branch.businessGroupId === context.businessGroupId &&
    branch.status === "active"
  );
  if (canManageProductCopy(context)) {
    return { canCopy: true, sourceBranch: context.branch, targetBranches: activeCandidates };
  }

  const memberships = await prisma.branchMembership.findMany({
    where: {
      userId: context.userId,
      status: "active",
      branchId: { in: [context.branchId, ...activeCandidates.map((branch) => branch.id)] },
    },
    select: { branchId: true, permissionsJson: true },
  });
  const permitted = new Set(memberships.filter((membership) => hasCopyPermission(membership.permissionsJson)).map((membership) => membership.branchId));
  const canCopy = permitted.has(context.branchId);
  return {
    canCopy,
    sourceBranch: context.branch,
    targetBranches: canCopy ? activeCandidates.filter((branch) => permitted.has(branch.id)) : [],
  };
}

async function requireTargetBranch(context: BranchContext, targetBranchId: string) {
  const capabilities = await getProductCopyCapabilities(context);
  if (!capabilities.canCopy) {
    throw new ProductCopyError("Нет права копировать карточки товаров между филиалами", 403, "product_copy_forbidden");
  }
  const target = capabilities.targetBranches.find((branch) => branch.id === targetBranchId) ?? null;
  if (!target) {
    throw new ProductCopyError("Целевой филиал недоступен, неактивен или не входит в вашу группу", 403, "target_branch_forbidden");
  }
  return { source: capabilities.sourceBranch!, target };
}

function uniqueIds(input: unknown) {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.filter((id): id is string => typeof id === "string" && id.trim().length > 0).map((id) => id.trim()))].slice(0, 500);
}

async function loadSources(sourceBranchId: string, productIds: string[]): Promise<SourceProduct[]> {
  return prisma.localProduct.findMany({
    where: { branchId: sourceBranchId, id: { in: productIds } },
    include: {
      supplierCounterparty: { select: { id: true, inn: true, name: true, displayName: true } },
      photos: true,
      mannLinks: true,
    },
  });
}

type DuplicateMatch = { product: TargetProduct; method: string } | null;

async function findDuplicate(targetBranchId: string, source: SourceProduct): Promise<DuplicateMatch> {
  // Local products have no ProductMaster. Source lineage is therefore the
  // strongest stable match and fulfills the master-card intent for this model.
  const lineage = await prisma.localProduct.findFirst({
    where: { branchId: targetBranchId, sourceProductId: source.id },
    select: duplicateSelect,
  });
  if (lineage) return { product: lineage as TargetProduct, method: "SOURCE_LINEAGE" };

  const or: Prisma.LocalProductWhereInput[] = [];
  if (source.article) or.push({ article: { equals: source.article, mode: "insensitive" } });
  if (source.code) or.push({ code: { equals: source.code, mode: "insensitive" } });
  if (source.barcodeEan13) or.push({ barcodeEan13: source.barcodeEan13 });
  if (source.barcodeEan8) or.push({ barcodeEan8: source.barcodeEan8 });
  if (source.barcodeCode128) or.push({ barcodeCode128: source.barcodeCode128 });
  if (!or.length) return null;

  const candidates = await prisma.localProduct.findMany({
    where: { branchId: targetBranchId, OR: or },
    select: duplicateSelect,
    take: 60,
  }) as TargetProduct[];
  const articleBrand = candidates.find((candidate) => sameNonEmpty(candidate.article as string | null, source.article) && sameNonEmpty(candidate.brand as string | null, source.brand));
  if (articleBrand) return { product: articleBrand, method: "BRAND_ARTICLE" };
  const barcode = candidates.find((candidate) =>
    sameNonEmpty(candidate.barcodeEan13 as string | null, source.barcodeEan13) ||
    sameNonEmpty(candidate.barcodeEan8 as string | null, source.barcodeEan8) ||
    sameNonEmpty(candidate.barcodeCode128 as string | null, source.barcodeCode128)
  );
  if (barcode) return { product: barcode, method: "BARCODE" };
  const code = candidates.find((candidate) => sameNonEmpty(candidate.code as string | null, source.code));
  return code ? { product: code, method: "CODE" } : null;
}

const duplicateSelect = {
  id: true,
  name: true,
  brand: true,
  article: true,
  code: true,
  barcodeEan13: true,
  barcodeEan8: true,
  barcodeCode128: true,
  sourceProductId: true,
  salePriceCents: true,
  buyPriceCents: true,
  minimumBalance: true,
  supplierCounterpartyId: true,
} as const;

async function supplierForTarget(source: SourceProduct, targetBranchId: string, enabled: boolean) {
  if (!enabled || !source.supplierCounterparty?.inn?.trim()) {
    return { supplierCounterpartyId: null as string | null, supplierName: null as string | null, warning: null as string | null };
  }
  const suppliers = await prisma.localCounterparty.findMany({
    where: {
      branchId: targetBranchId,
      inn: source.supplierCounterparty.inn,
      archived: false,
      status: "ACTIVE",
      category: "SUPPLIER",
    },
    select: { id: true, name: true, displayName: true },
    take: 2,
  });
  if (suppliers.length !== 1) {
    return {
      supplierCounterpartyId: null,
      supplierName: null,
      warning: suppliers.length > 1
        ? "В целевом филиале найдено несколько поставщиков с тем же ИНН — поставщик не назначен."
        : "Поставщик с тем же ИНН в целевом филиале не найден — поставщик не назначен.",
    };
  }
  const supplier = suppliers[0];
  return { supplierCounterpartyId: supplier.id, supplierName: supplier.displayName || supplier.name, warning: null };
}

function copyData(source: SourceProduct, input: {
  targetBranchId: string;
  batchId: string;
  userId: string;
  options: ProductCopyOptions;
  supplierCounterpartyId: string | null;
  supplierName: string | null;
}) {
  const { options } = input;
  const salePriceCents = options.copyRetailPrice ? source.salePriceCents : 0;
  const buyPriceCents = options.copyPurchasePrice ? source.buyPriceCents : null;
  const minimumBalance = options.copyMinimumBalance ? source.minimumBalance : null;
  const data: Prisma.LocalProductUncheckedCreateInput = {
    branchId: input.targetBranchId,
    name: source.name,
    entityType: source.entityType,
    article: source.article,
    code: source.code,
    externalCode: source.externalCode,
    groupPath: source.groupPath,
    uomName: source.uomName,
    salePriceCents,
    pricingMode: source.pricingMode,
    buyPriceCents,
    currencyName: source.currencyName,
    minimumBalance,
    barcodeEan13: source.barcodeEan13,
    barcodeEan8: source.barcodeEan8,
    barcodeCode128: source.barcodeCode128,
    description: source.description,
    minPriceCents: source.minPriceCents,
    minPriceCurrencyName: source.minPriceCurrencyName,
    countryName: source.countryName,
    vatLabel: source.vatLabel,
    legacySupplierName: input.supplierName,
    supplierCounterpartyId: input.supplierCounterpartyId,
    weight: source.weight,
    volume: source.volume,
    modificationCode: source.modificationCode,
    tnvedCode: source.tnvedCode,
    sae: source.sae,
    oem: source.oem,
    acea: source.acea,
    apiSpec: source.apiSpec,
    packageVolume: source.packageVolume,
    avito: source.avito,
    brand: source.brand,
    atf: source.atf,
    ilsac: source.ilsac,
    aceaExtra: source.aceaExtra,
    oemAtf: source.oemAtf,
    mannName: null,
    rosskoPartNumber: source.rosskoPartNumber,
    rosskoBrand: source.rosskoBrand,
    rosskoMin: source.rosskoMin,
    supplierAttribute: source.supplierAttribute,
    oemParts: source.oemParts,
    cell: null,
    params: source.params,
    mannCharacteristicName: source.mannCharacteristicName,
    imageHref: source.imageHref,
    attributes: copyAttributesWithoutLocations(source.attributes) as Prisma.InputJsonValue | undefined,
    markingEnabled: source.markingEnabled,
    markingMode: source.markingMode,
    markingStatus: source.markingStatus,
    markingSettings: source.markingSettings as Prisma.InputJsonValue | undefined,
    markingConfiguredManually: source.markingConfiguredManually,
    markingConfiguredAt: source.markingConfiguredAt,
    markingConfiguredByLogin: source.markingConfiguredByLogin,
    archived: source.archived,
    raw: { origin: "branch_copy", sourceProductId: source.id, sourceBranchId: source.branchId, copyBatchId: input.batchId },
    syncedAt: new Date(),
    origin: "BRANCH_COPY",
    sourceProductId: source.id,
    sourceBranchId: source.branchId,
    copyBatchId: input.batchId,
    copiedAt: new Date(),
    createdById: input.userId,
    priceNeedsSetup: !options.copyRetailPrice,
    searchText: "",
  };
  data.searchText = buildCatalogSearchText({
    ...data,
    supplierName: input.supplierName,
    cell: null,
  });
  return data;
}

function emptyValue(value: unknown) {
  if (value == null) return true;
  if (typeof value === "string") return !value.trim();
  if (typeof value === "number") return value === 0;
  return false;
}

function copyAttributesWithoutLocations(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .filter((item) => {
        if (!item || typeof item !== "object") return true;
        const name = normalized(String((item as Record<string, unknown>).name ?? ""));
        return !["cell", "slot", "warehouse", "store", "ячейка", "склад"].some((term) => name.includes(normalized(term)));
      })
      .map(copyAttributesWithoutLocations);
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !["cell", "slot", "warehouse", "store", "ячейка", "склад"].includes(normalized(key)))
      .map(([key, nested]) => [key, copyAttributesWithoutLocations(nested)])
  );
}

function updateDataForDuplicate(source: SourceProduct, target: TargetProduct, createData: Prisma.LocalProductUncheckedCreateInput, options: ProductCopyOptions) {
  const selectedDefaults = [
    ...(options.copyRetailPrice ? ["salePriceCents"] : []),
    ...(options.copyPurchasePrice ? ["buyPriceCents"] : []),
    ...(options.copyMinimumBalance ? ["minimumBalance"] : []),
    ...(options.mapSupplierByInn ? ["supplierCounterpartyId", "legacySupplierName"] : []),
  ];
  const allowed = options.duplicateStrategy === "update_selected"
    ? new Set(options.selectedUpdateFields?.length
      ? options.selectedUpdateFields.filter((field) => COPYABLE_FIELDS.includes(field as typeof COPYABLE_FIELDS[number]))
      : selectedDefaults)
    : new Set<string>(COPYABLE_FIELDS);
  const update: Record<string, unknown> = {};
  for (const field of COPYABLE_FIELDS) {
    if (!allowed.has(field)) continue;
    const value = createData[field as keyof typeof createData];
    if (options.duplicateStrategy === "update_empty" && !emptyValue(target[field])) continue;
    update[field] = value;
  }
  if (Object.keys(update).length) {
    update.searchText = buildCatalogSearchText({
      ...createData,
      supplierName: createData.legacySupplierName ?? null,
      cell: null,
    });
  }
  return update as Prisma.LocalProductUncheckedUpdateInput;
}

function actionForDuplicate(strategy: DuplicateStrategy): ProductCopyPreviewRow["action"] {
  if (strategy === "update_empty") return "UPDATE_EMPTY";
  if (strategy === "update_selected") return "UPDATE_SELECTED";
  if (strategy === "force_create") return "FORCE_CREATE";
  return "SKIP";
}

function similarNameWarning(source: SourceProduct, matches: TargetProduct[]) {
  const sourceName = normalizedName(source.name);
  if (!sourceName) return null;
  return matches.find((candidate) => normalizedName(candidate.name as string) === sourceName)
    ? "Похоже по названию на карточку в целевом филиале, но автоматического совпадения нет."
    : null;
}

async function previewRows(sourceBranchId: string, targetBranchId: string, productIds: string[], options: ProductCopyOptions) {
  const sources = await loadSources(sourceBranchId, productIds);
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const missing = productIds.filter((id) => !sourceById.has(id)).map<ProductCopyPreviewRow>((id) => ({
    sourceProductId: id, productName: "Карточка недоступна", article: null, action: "REVIEW", matchingMethod: null,
    targetProductId: null, reason: "Карточка не принадлежит активному филиалу или была удалена.", warnings: [],
  }));
  const targetNames = sources.length
    ? await prisma.localProduct.findMany({
        where: { branchId: targetBranchId, name: { in: sources.map((source) => source.name) } },
        select: duplicateSelect,
        take: Math.min(500, sources.length * 3),
      }) as TargetProduct[]
    : [];
  const rows = await Promise.all(sources.map(async (source): Promise<ProductCopyPreviewRow> => {
    const duplicate = await findDuplicate(targetBranchId, source);
    const supplier = await supplierForTarget(source, targetBranchId, options.mapSupplierByInn);
    const warnings = [
      supplier.warning,
      !options.copyRetailPrice ? "Розничная цена не будет перенесена: карточка потребует настройки цены." : null,
      !duplicate ? similarNameWarning(source, targetNames) : null,
    ].filter((value): value is string => Boolean(value));
    if (!duplicate) {
      return { sourceProductId: source.id, productName: source.name, article: source.article, action: "CREATE", matchingMethod: null, targetProductId: null, reason: null, warnings };
    }
    return {
      sourceProductId: source.id,
      productName: source.name,
      article: source.article,
      action: actionForDuplicate(options.duplicateStrategy),
      matchingMethod: duplicate.method,
      targetProductId: duplicate.product.id,
      reason: options.duplicateStrategy === "skip" ? "Найдена похожая карточка по правилу дублей." : null,
      warnings,
    };
  }));
  return [...rows, ...missing];
}

export async function previewProductCopy(context: BranchContext, input: { targetBranchId: string; productIds: unknown; options?: unknown }) {
  if (!context.branchId) throw new ProductCopyError("Выберите исходный филиал", 409, "source_branch_required");
  const productIds = uniqueIds(input.productIds);
  if (!productIds.length) throw new ProductCopyError("Выберите хотя бы одну карточку", 400, "products_required");
  const { target } = await requireTargetBranch(context, input.targetBranchId);
  const options = parseOptions(input.options);
  const rows = await previewRows(context.branchId, target.id, productIds, options);
  const counts = rows.reduce((result, row) => {
    result[row.action] = (result[row.action] ?? 0) + 1;
    return result;
  }, {} as Record<string, number>);
  return {
    sourceBranch: context.branch,
    targetBranch: target,
    options,
    totalSelected: productIds.length,
    rows,
    counts,
  };
}

function batchResult(batch: Prisma.BranchProductCopyBatchGetPayload<{ include: { items: true } }>) {
  return {
    id: batch.id,
    status: batch.status,
    sourceBranchId: batch.sourceBranchId,
    targetBranchId: batch.targetBranchId,
    totalSelected: batch.totalSelected,
    created: batch.totalCreated,
    updated: batch.totalUpdated,
    skipped: batch.totalSkipped,
    failed: batch.totalFailed,
    priceNeedsSetup: batch.totalPriceNeedsSetup,
    suppliersUnmapped: batch.totalSuppliersUnmapped,
    createdAt: batch.createdAt.toISOString(),
    completedAt: batch.completedAt?.toISOString() ?? null,
    items: batch.items.map((item) => ({
      sourceProductId: item.sourceProductId,
      targetProductId: item.targetProductId,
      action: item.action,
      status: item.status,
      matchingMethod: item.matchingMethod,
      reason: item.reason,
      errorCode: item.errorCode,
      errorMessage: item.errorMessage,
    })),
  };
}

async function getAuthorizedBatch(context: BranchContext, batchId: string) {
  const batch = await prisma.branchProductCopyBatch.findUnique({
    where: { id: batchId },
    include: { items: { orderBy: { createdAt: "asc" } } },
  });
  if (!batch || batch.businessGroupId !== context.businessGroupId) {
    throw new ProductCopyError("Пакет копирования не найден", 404, "copy_batch_not_found");
  }
  const capabilities = await getProductCopyCapabilities(context);
  const targetAllowed = capabilities.targetBranches.some((branch) => branch.id === batch.targetBranchId);
  if (!capabilities.canCopy || batch.sourceBranchId !== context.branchId || !targetAllowed) {
    throw new ProductCopyError("Нет доступа к этому пакету копирования", 403, "copy_batch_forbidden");
  }
  return batch;
}

export async function getProductCopyBatch(context: BranchContext, batchId: string) {
  return batchResult(await getAuthorizedBatch(context, batchId));
}

export async function executeProductCopy(context: BranchContext, input: {
  targetBranchId: string;
  productIds: unknown;
  options?: unknown;
  idempotencyKey: unknown;
}) {
  if (!context.branchId) throw new ProductCopyError("Выберите исходный филиал", 409, "source_branch_required");
  const productIds = uniqueIds(input.productIds);
  const idempotencyKey = typeof input.idempotencyKey === "string" ? input.idempotencyKey.trim() : "";
  if (!productIds.length) throw new ProductCopyError("Выберите хотя бы одну карточку", 400, "products_required");
  if (!idempotencyKey || idempotencyKey.length > 200) throw new ProductCopyError("Не передан ключ идемпотентности", 400, "idempotency_key_required");

  const { target } = await requireTargetBranch(context, input.targetBranchId);
  const options = parseOptions(input.options);
  const existing = await prisma.branchProductCopyBatch.findUnique({
    where: { idempotencyKey },
    include: { items: { orderBy: { createdAt: "asc" } } },
  });
  if (existing) {
    if (
      existing.businessGroupId !== context.businessGroupId ||
      existing.sourceBranchId !== context.branchId ||
      existing.targetBranchId !== target.id
    ) {
      throw new ProductCopyError("Ключ идемпотентности уже использован для другой операции", 409, "idempotency_key_conflict");
    }
    return batchResult(existing);
  }

  let batch: { id: string };
  try {
    batch = await prisma.branchProductCopyBatch.create({
      data: {
        businessGroupId: context.businessGroupId,
        sourceBranchId: context.branchId,
        targetBranchId: target.id,
        createdById: context.userId,
        idempotencyKey,
        status: "RUNNING",
        optionsJson: options as Prisma.InputJsonValue,
        totalSelected: productIds.length,
        startedAt: new Date(),
      },
      select: { id: true },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const retry = await prisma.branchProductCopyBatch.findUnique({
        where: { idempotencyKey },
        include: { items: { orderBy: { createdAt: "asc" } } },
      });
      if (retry && retry.businessGroupId === context.businessGroupId && retry.sourceBranchId === context.branchId && retry.targetBranchId === target.id) {
        return batchResult(retry);
      }
    }
    throw error;
  }

  const sources = await loadSources(context.branchId, productIds);
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  let priceNeedsSetup = 0;
  let suppliersUnmapped = 0;

  for (const sourceId of productIds) {
    const source = sourceById.get(sourceId);
    if (!source) {
      failed += 1;
      await prisma.branchProductCopyItem.create({
        data: {
          batchId: batch.id,
          sourceProductId: sourceId,
          action: "REVIEW",
          status: "FAILED",
          errorCode: "source_product_not_found",
          errorMessage: "Карточка не принадлежит исходному филиалу или была удалена.",
        },
      });
      continue;
    }

    try {
      const duplicate = await findDuplicate(target.id, source);
      const supplier = await supplierForTarget(source, target.id, options.mapSupplierByInn);
      const createData = copyData(source, {
        targetBranchId: target.id,
        batchId: batch.id,
        userId: context.userId,
        options,
        supplierCounterpartyId: supplier.supplierCounterpartyId,
        supplierName: supplier.supplierName,
      });
      if (supplier.warning) suppliersUnmapped += 1;
      let targetProductId: string | null = null;
      let action: ProductCopyPreviewRow["action"] = "CREATE";
      let reason: string | null = supplier.warning;

      if (duplicate && options.duplicateStrategy === "skip") {
        skipped += 1;
        action = "SKIP";
        targetProductId = duplicate.product.id;
        reason = reason ?? "Найдена похожая карточка по правилу дублей.";
        await prisma.branchProductCopyItem.create({
          data: {
            batchId: batch.id,
            sourceProductId: source.id,
            targetProductId,
            matchingMethod: duplicate.method,
            action,
            status: "SKIPPED",
            reason,
          },
        });
        continue;
      }

      if (duplicate && options.duplicateStrategy !== "force_create") {
        const existingTarget = await prisma.localProduct.findFirst({
          where: { id: duplicate.product.id, branchId: target.id },
        });
        const update = existingTarget
          ? updateDataForDuplicate(source, existingTarget as TargetProduct, createData, options)
          : {};
        if (Object.keys(update).length) {
          await prisma.localProduct.update({ where: { id: duplicate.product.id }, data: update });
        }
        targetProductId = duplicate.product.id;
        action = options.duplicateStrategy === "update_empty" ? "UPDATE_EMPTY" : "UPDATE_SELECTED";
        updated += 1;
      } else {
        const createdProduct = await prisma.localProduct.create({ data: createData, select: { id: true } });
        targetProductId = createdProduct.id;
        action = duplicate ? "FORCE_CREATE" : "CREATE";
        if (source.photos.length) {
          await prisma.localProductPhoto.createMany({
            data: source.photos.map((photo) => ({
              branchId: target.id,
              productId: createdProduct.id,
              fileName: photo.fileName,
              contentType: photo.contentType,
              sizeBytes: photo.sizeBytes,
              data: photo.data,
              createdAt: photo.createdAt,
            })),
          });
        }
        if (source.mannLinks.length) {
          await prisma.productMannLink.createMany({
            data: source.mannLinks.map((link) => ({
              branchId: target.id,
              organizationId: target.legacyOrganizationId ?? target.id,
              productId: createdProduct.id,
              mannArticle: link.mannArticle,
              mannArticleNormalized: link.mannArticleNormalized,
              linkType: link.linkType,
              confidence: link.confidence,
              createdById: context.userId,
            })),
            skipDuplicates: true,
          });
        }
      }

      if (action === "CREATE" || action === "FORCE_CREATE") created += 1;
      if (!options.copyRetailPrice) priceNeedsSetup += 1;
      await prisma.branchProductCopyItem.create({
        data: {
          batchId: batch.id,
          sourceProductId: source.id,
          targetProductId,
          matchingMethod: duplicate?.method ?? null,
          action,
          status: "COMPLETED",
          reason,
          copiedFieldsJson: { fields: COPYABLE_FIELDS, copyRetailPrice: options.copyRetailPrice, copyPurchasePrice: options.copyPurchasePrice, copyMinimumBalance: options.copyMinimumBalance },
        },
      });
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : "Неизвестная ошибка";
      await prisma.branchProductCopyItem.create({
        data: {
          batchId: batch.id,
          sourceProductId: source.id,
          action: "REVIEW",
          status: "FAILED",
          errorCode: "copy_failed",
          errorMessage: message.slice(0, 2000),
        },
      });
    }
  }

  const status = failed ? (created || updated || skipped ? "COMPLETED_WITH_ERRORS" : "FAILED") : "COMPLETED";
  const completed = await prisma.branchProductCopyBatch.update({
    where: { id: batch.id },
    data: {
      status,
      totalCreated: created,
      totalUpdated: updated,
      totalSkipped: skipped,
      totalFailed: failed,
      totalPriceNeedsSetup: priceNeedsSetup,
      totalSuppliersUnmapped: suppliersUnmapped,
      completedAt: new Date(),
    },
    include: { items: { orderBy: { createdAt: "asc" } } },
  });

  await prisma.changeLog.createMany({
    data: [
      {
        branchId: context.branchId,
        entityType: "PRODUCT_COPY_BATCH",
        entityId: batch.id,
        action: "create",
        newValue: { targetBranchId: target.id, totalSelected: productIds.length, created, updated, skipped, failed },
        performedByLogin: context.user.login,
      },
      {
        branchId: target.id,
        entityType: "PRODUCT_COPY_BATCH",
        entityId: batch.id,
        action: "create",
        newValue: { sourceBranchId: context.branchId, totalSelected: productIds.length, created, updated, skipped, failed },
        performedByLogin: context.user.login,
      },
    ],
  });

  return batchResult(completed);
}
