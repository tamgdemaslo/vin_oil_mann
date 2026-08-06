import { Prisma } from "@prisma/client";
import type { BranchContext } from "@/lib/branch-context";
import { prisma } from "@/lib/db";
export type PriceLabelLegalEntity = {
  id: string;
  name: string;
  inn: string;
};

export type PriceLabelMode = "BY_PRODUCT" | "BY_QUANTITY";

export type PriceLabelRequestItem = {
  receiptItemId: string;
  /** An explicit override is only sent for the first receipt row of a product. */
  copies?: number;
};

export type PriceLabelRequest = {
  items: PriceLabelRequestItem[];
  mode: PriceLabelMode;
  legalEntityId?: string;
};

export type PriceLabel = {
  productId: string;
  receiptItemIds: string[];
  name: string;
  article: string;
  priceCents: number;
  receivedQuantity: number;
  copies: number;
  warning?: string;
};

export type PriceLabelValidationError = {
  code: "invalid_item" | "not_product" | "missing_price" | "missing_organization" | "missing_inn" | "organization_choice_required" | "invalid_copies" | "too_many_labels";
  message: string;
  receiptItemId?: string;
  productId?: string;
  productName?: string;
  article?: string;
};

export type PriceLabelPreview = {
  ok: boolean;
  receiptNumber?: string;
  branch?: { id: string; name: string };
  legalEntity?: PriceLabelLegalEntity;
  legalEntityOptions?: PriceLabelLegalEntity[];
  labels: PriceLabel[];
  validationErrors: PriceLabelValidationError[];
  warnings: string[];
  totalLabels: number;
  selectedProducts: number;
  selectedUnits: number;
};

const MAX_PRICE_LABELS = 5_000;

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isProduct(entityType: string | null | undefined) {
  return (entityType ?? "").trim().toLowerCase() === "product";
}

function numericQuantity(value: Prisma.Decimal) {
  return value.toNumber();
}

function toLegalEntity(id: string, value: { name: string; inn: string | null; fullLegalName?: string | null }): PriceLabelLegalEntity {
  return {
    id,
    name: cleanText(value.fullLegalName) || cleanText(value.name),
    inn: cleanText(value.inn),
  };
}

function error(code: PriceLabelValidationError["code"], message: string, extra: Omit<PriceLabelValidationError, "code" | "message"> = {}): PriceLabelValidationError {
  return { code, message, ...extra };
}

export function parsePriceLabelRequest(value: unknown): PriceLabelRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const mode = body.mode === "BY_QUANTITY" ? "BY_QUANTITY" : body.mode === "BY_PRODUCT" ? "BY_PRODUCT" : null;
  if (!mode || !Array.isArray(body.items)) return null;

  const items: PriceLabelRequestItem[] = [];
  for (const rawItem of body.items) {
    if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) return null;
    const item = rawItem as Record<string, unknown>;
    const receiptItemId = cleanText(item.receiptItemId);
    if (!receiptItemId) return null;
    if (item.copies !== undefined && (!Number.isInteger(item.copies) || Number(item.copies) < 1)) return null;
    items.push({ receiptItemId, ...(item.copies === undefined ? {} : { copies: Number(item.copies) }) });
  }

  return {
    items,
    mode,
    ...(cleanText(body.legalEntityId) ? { legalEntityId: cleanText(body.legalEntityId) } : {}),
  };
}

async function resolveLegalEntity(input: {
  context: BranchContext;
  receiptStoreOrganization: { id: string; name: string; fullLegalName: string | null; inn: string | null } | null;
  requestedId?: string;
}): Promise<{ entity?: PriceLabelLegalEntity; options?: PriceLabelLegalEntity[]; validationError?: PriceLabelValidationError }> {
  if (input.receiptStoreOrganization) {
    return { entity: toLegalEntity(`local:${input.receiptStoreOrganization.id}`, input.receiptStoreOrganization) };
  }

  const branchId = input.context.branchId;
  if (!branchId) return { validationError: error("missing_organization", "Для печати выберите конкретный филиал.") };

  const branchEntities = await prisma.branchLegalEntity.findMany({
    where: { branchId },
    orderBy: [{ isPrimary: "desc" }, { name: "asc" }],
    select: { id: true, name: true, inn: true, isPrimary: true },
  });
  const options = branchEntities.map((entity) => ({
    id: `branch:${entity.id}`,
    name: cleanText(entity.name),
    inn: cleanText(entity.inn),
    source: "branch" as const,
  }));

  if (input.requestedId) {
    const selected = options.find((option) => option.id === input.requestedId);
    if (!selected) return { validationError: error("missing_organization", "Выбранная организация недоступна для этого филиала.") };
    return { entity: selected };
  }

  const primary = options.filter((option) => branchEntities.find((entity) => `branch:${entity.id}` === option.id)?.isPrimary);
  if (primary.length === 1) return { entity: primary[0] };
  if (options.length === 1) return { entity: options[0] };
  if (options.length > 1) {
    return {
      options,
      validationError: error("organization_choice_required", "Выберите организацию для ценников."),
    };
  }

  const legacyOrganizationId = input.context.branch?.legacyOrganizationId;
  if (legacyOrganizationId) {
    const organization = await prisma.localOrganization.findUnique({
      where: { id: legacyOrganizationId },
      select: { id: true, name: true, fullLegalName: true, inn: true },
    });
    if (organization) return { entity: toLegalEntity(`local:${organization.id}`, organization) };
  }

  return { validationError: error("missing_organization", "Для филиала не настроена юридическая организация.") };
}

/**
 * Builds a safe price-label model. The request contains only receipt row IDs and
 * optional copy counts; all printable fields are reloaded from the branch data.
 */
export async function preparePriceLabels(
  context: BranchContext,
  receiptId: string,
  request: PriceLabelRequest
): Promise<PriceLabelPreview> {
  const branchId = context.branchId;
  const empty = (validationErrors: PriceLabelValidationError[], additions: Partial<PriceLabelPreview> = {}): PriceLabelPreview => ({
    ok: false,
    labels: [],
    validationErrors,
    warnings: [],
    totalLabels: 0,
    selectedProducts: 0,
    selectedUnits: 0,
    ...additions,
  });
  if (!branchId) return empty([error("missing_organization", "Для печати выберите конкретный филиал.")]);
  if (!request.items.length) return empty([error("invalid_item", "Выберите товары, для которых нужно сформировать ценники.")]);
  if (request.items.length > 500) return empty([error("invalid_item", "Выбрано слишком много строк приёмки. Сократите выбор и повторите попытку.")]);

  const receipt = await prisma.localInventoryDocument.findFirst({
    where: { id: receiptId, branchId, type: "receipt", isDeleted: false },
    include: {
      store: {
        include: { organization: { select: { id: true, name: true, fullLegalName: true, inn: true } } },
      },
      positions: {
        include: {
          product: {
            select: { id: true, name: true, article: true, code: true, entityType: true, salePriceCents: true },
          },
        },
        orderBy: { id: "asc" },
      },
    },
  });
  if (!receipt) return empty([error("invalid_item", "Приёмка недоступна в активном филиале. Переключитесь в филиал документа и повторите попытку.")]);

  const requestedById = new Map<string, PriceLabelRequestItem>();
  for (const item of request.items) requestedById.set(item.receiptItemId, item);
  const errors: PriceLabelValidationError[] = [];
  const selected = receipt.positions.filter((position) => requestedById.has(position.id));
  for (const receiptItemId of requestedById.keys()) {
    if (!receipt.positions.some((position) => position.id === receiptItemId)) {
      errors.push(error("invalid_item", "Позиция не принадлежит этой приёмке.", { receiptItemId }));
    }
  }

  const groups = new Map<string, {
    productId: string;
    receiptItemIds: string[];
    name: string;
    article: string;
    priceCents: number;
    quantity: number;
    overrides: number[];
  }>();
  for (const position of selected) {
    const product = position.product;
    if (!position.productId || !product || !isProduct(product.entityType)) {
      errors.push(error("not_product", "В ценники можно включать только товарные позиции.", {
        receiptItemId: position.id,
        productName: position.productName,
      }));
      continue;
    }
    const selectedItem = requestedById.get(position.id)!;
    const current = groups.get(product.id) ?? {
      productId: product.id,
      receiptItemIds: [],
      name: cleanText(product.name) || cleanText(position.productName),
      article: cleanText(product.article) || cleanText(product.code),
      priceCents: product.salePriceCents,
      quantity: 0,
      overrides: [],
    };
    current.receiptItemIds.push(position.id);
    current.quantity += numericQuantity(position.quantity);
    if (selectedItem.copies !== undefined) current.overrides.push(selectedItem.copies);
    groups.set(product.id, current);
  }

  const labelRows: PriceLabel[] = [];
  for (const group of groups.values()) {
    if (group.priceCents <= 0) {
      errors.push(error("missing_price", "Не указана розничная цена", {
        productId: group.productId,
        productName: group.name,
        article: group.article,
      }));
      continue;
    }
    if (group.overrides.length > 1) {
      errors.push(error("invalid_copies", "Для товара можно указать только одно количество ценников.", {
        productId: group.productId,
        productName: group.name,
        article: group.article,
      }));
      continue;
    }
    const automaticCopies = request.mode === "BY_PRODUCT"
      ? 1
      : Number.isInteger(group.quantity) && group.quantity > 0
        ? Math.round(group.quantity)
        : 1;
    const copies = group.overrides[0] ?? automaticCopies;
    if (!Number.isInteger(copies) || copies < 1 || copies > MAX_PRICE_LABELS) {
      errors.push(error("invalid_copies", "Количество ценников должно быть целым числом не меньше 1.", {
        productId: group.productId,
        productName: group.name,
        article: group.article,
      }));
      continue;
    }
    labelRows.push({
      productId: group.productId,
      receiptItemIds: group.receiptItemIds,
      name: group.name,
      article: group.article,
      priceCents: group.priceCents,
      receivedQuantity: group.quantity,
      copies,
      ...(group.name.length > 96 ? { warning: "Длинное название будет напечатано уменьшенным шрифтом." } : {}),
    });
  }

  const organizationResult = await resolveLegalEntity({
    context,
    receiptStoreOrganization: receipt.store?.organization ?? null,
    requestedId: request.legalEntityId,
  });
  if (organizationResult.validationError) errors.push(organizationResult.validationError);
  const legalEntity = organizationResult.entity;
  if (legalEntity && !legalEntity.inn) errors.push(error("missing_inn", "У связанной организации не указан ИНН."));

  const totalLabels = labelRows.reduce((sum, label) => sum + label.copies, 0);
  if (totalLabels > MAX_PRICE_LABELS) errors.push(error("too_many_labels", `Нельзя сформировать больше ${MAX_PRICE_LABELS.toLocaleString("ru-RU")} ценников за один раз.`));
  const warnings = labelRows.flatMap((label) => label.warning ? [label.warning] : []);

  return {
    ok: errors.length === 0,
    receiptNumber: receipt.name,
    branch: { id: branchId, name: context.branch?.name ?? receipt.store?.name ?? "Филиал" },
    ...(legalEntity ? { legalEntity } : {}),
    ...(organizationResult.options ? {
      legalEntityOptions: organizationResult.options.map((option) => ({ id: option.id, name: option.name, inn: option.inn })),
    } : {}),
    labels: labelRows,
    validationErrors: errors,
    warnings,
    totalLabels,
    selectedProducts: groups.size,
    selectedUnits: [...groups.values()].reduce((sum, group) => sum + group.quantity, 0),
  };
}

export async function recordPriceLabelsGenerated(input: {
  receiptId: string;
  context: BranchContext;
  request: PriceLabelRequest;
  preview: PriceLabelPreview;
}) {
  await prisma.localInventoryDocumentAuditLog.create({
    data: {
      documentId: input.receiptId,
      action: "PRICE_LABELS_GENERATED",
      statusBefore: null,
      statusAfter: null,
      message: `Сформировано ${input.preview.totalLabels} ценников (${input.request.mode === "BY_PRODUCT" ? "по наименованиям" : "по количеству"}).`,
      newValue: {
        branchId: input.context.branchId,
        mode: input.request.mode,
        legalEntity: input.preview.legalEntity,
        totalLabels: input.preview.totalLabels,
        labels: input.preview.labels.map((label) => ({
          productId: label.productId,
          receiptItemIds: label.receiptItemIds,
          copies: label.copies,
          priceCents: label.priceCents,
        })),
      },
      createdById: input.context.user.login,
      createdByName: input.context.user.name,
    },
  });
}
