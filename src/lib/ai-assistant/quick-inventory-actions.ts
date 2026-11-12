import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createLocalAdminProduct, createLocalStockDocument, postLocalReceipt } from "@/lib/local-inventory-admin";
import type { AIAssistantAccess } from "./access";

type Product = { kind: "product"; name: string; article: string; brand: string; groupPath: string; uomName: string };
type Receipt = {
  kind: "receipt";
  storeId: string;
  supplierId: string;
  post: boolean;
  lines: { productId: string; quantity: number; unitPriceRubles: number }[];
};
type InventoryAction = Product | Receipt | { kind: "post_receipt"; receiptId: string; updatedAt: string };
type SignedAction = { branchId: string; actor: string; key: string; expires: number; action: InventoryAction };

function signature(payload: string) {
  const secret = process.env.SESSION_SECRET?.trim() || process.env.MESSENGER_CREDENTIAL_ENCRYPTION_KEY?.trim();
  if (!secret) throw new Error("Подтверждение складских операций не настроено.");
  return createHmac("sha256", secret).update("quick-inventory:" + payload).digest();
}

function sign(action: SignedAction) {
  const payload = Buffer.from(JSON.stringify(action)).toString("base64url");
  return payload + "." + signature(payload).toString("base64url");
}

function readToken(token: string, access: AIAssistantAccess) {
  const [payload, hash, extra] = token.split(".");
  if (!payload || !hash || extra || token.length > 20000) return null;
  const expected = signature(payload);
  const actual = Buffer.from(hash, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  const decoded: SignedAction = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  return decoded.branchId === access.branchId && decoded.actor === access.context.userId && decoded.expires >= Date.now()
    ? decoded : null;
}

export async function quickInventoryOptions(access: AIAssistantAccess, supplier: string) {
  const [stores, suppliers] = await Promise.all([
    prisma.localStore.findMany({ where: { branchId: access.branchId, archived: false }, select: { id: true, name: true }, take: 20 }),
    supplier ? prisma.localCounterparty.findMany({
      where: { branchId: access.branchId, category: "SUPPLIER", archived: false, name: { contains: supplier, mode: "insensitive" } },
      select: { id: true, name: true }, take: 5,
    }) : [],
  ]);
  return { stores, suppliers };
}

export async function prepareQuickExistingReceipt(access: AIAssistantAccess, reference: string) {
  if (access.context.branch?.status !== "active") return { error: "Филиал доступен только для чтения." };
  if (!reference) return { error: "Укажите номер или идентификатор черновика приёмки." };
  const matches = await prisma.localInventoryDocument.findMany({
    where: { branchId: access.branchId, type: "receipt", status: "draft", applicable: false, isDeleted: false,
      OR: [{ id: reference }, { name: reference }] },
    select: { id: true, name: true, updatedAt: true, storeNameSnapshot: true, counterpartyNameSnapshot: true,
      positions: { select: { productName: true, quantity: true, priceCentsPerUnit: true }, take: 31 } },
    take: 2,
  });
  if (matches.length !== 1) return { error: matches.length
    ? "Найдено несколько черновиков. Уточните идентификатор."
    : "Черновик приёмки не найден в текущем филиале." };
  const [receipt] = matches;
  if (!receipt.positions.length || receipt.positions.length > 30) {
    return { error: "Откройте документ в разделе приёмок, чтобы проверить все позиции." };
  }
  const action = { kind: "post_receipt" as const, receiptId: receipt.id, updatedAt: receipt.updatedAt.toISOString() };
  return { inventory: {
    title: `Проведение приёмки №${receipt.name}`,
    details: [`Склад: ${receipt.storeNameSnapshot || "не указан"}`, `Поставщик: ${receipt.counterpartyNameSnapshot || "не указан"}`,
      ...receipt.positions.map(line => `${line.productName}: ${line.quantity.toString()} × ${line.priceCentsPerUnit / 100} ₽`)],
    token: sign({ branchId: access.branchId, actor: access.context.userId, key: randomUUID(), expires: Date.now() + 86400000, action }),
  } };
}

export async function prepareQuickInventory(access: AIAssistantAccess, action: Product | Receipt) {
  if (access.context.branch?.status !== "active") return { error: "Филиал доступен только для чтения." };
  let details: string[];
  let title: string;
  if (action.kind === "product") {
    if (!action.name || !action.article || !action.groupPath || !action.uomName) {
      return { error: "Для товара нужны название, артикул, группа и единица измерения." };
    }
    title = "Создание товара";
    details = [action.name, `Артикул: ${action.article}`, `Группа: ${action.groupPath}`, `Единица: ${action.uomName}`];
    if (action.brand) details.push(`Бренд: ${action.brand}`);
  } else {
    if (!action.lines.length || action.lines.some(line => !line.productId || !Number.isFinite(line.quantity)
      || line.quantity <= 0 || !Number.isFinite(line.unitPriceRubles) || line.unitPriceRubles < 0)) {
      return { error: "Укажите товары, положительные количества и закупочные цены." };
    }
    const [store, supplier, products] = await Promise.all([
      prisma.localStore.findFirst({ where: { branchId: access.branchId, id: action.storeId, archived: false }, select: { name: true } }),
      prisma.localCounterparty.findFirst({ where: { branchId: access.branchId, id: action.supplierId, category: "SUPPLIER", archived: false }, select: { name: true } }),
      prisma.localProduct.findMany({ where: { branchId: access.branchId, id: { in: action.lines.map(line => line.productId) }, archived: false, entityType: { not: "service" } }, select: { id: true, name: true, article: true } }),
    ]);
    const byId = new Map(products.map(product => [product.id, product]));
    if (!store || !supplier || action.lines.some(line => !byId.has(line.productId))) {
      return { error: "Проверьте склад, поставщика и товары выбранного филиала." };
    }
    title = action.post ? "Проведение приёмки" : "Создание черновика приёмки";
    details = [`Склад: ${store.name}`, `Поставщик: ${supplier.name}`, ...action.lines.map(line => {
      const product = byId.get(line.productId)!;
      return `${product.name}${product.article ? " · " + product.article : ""}: ${line.quantity} × ${line.unitPriceRubles} ₽`;
    })];
  }
  return { inventory: {
    title, details,
    token: sign({ branchId: access.branchId, actor: access.context.userId, key: randomUUID(), expires: Date.now() + 86400000, action }),
  } };
}

export async function confirmQuickInventory(access: AIAssistantAccess, token: string) {
  const signed = readToken(token, access);
  if (!signed || access.context.branch?.status !== "active") return { error: "Черновик истёк или филиал изменился." };
  const { action, key } = signed;
  const externalCode = "assistant-" + key;
  const actor = access.session.user;
  if (action.kind === "post_receipt") {
    const result = await postLocalReceipt(action.receiptId, actor, { expectedUpdatedAt: action.updatedAt });
    return result.ok ? { id: result.document.id, kind: action.kind, posted: true } : { error: result.error };
  }
  return prisma.$transaction(async tx => {
    await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${externalCode}))::text`);
    if (action.kind === "product") {
      const existing = await tx.localProduct.findFirst({ where: { branchId: access.branchId, externalCode }, select: { id: true } });
      if (existing) return { id: existing.id, kind: action.kind };
      const result = await createLocalAdminProduct({ ...action, externalCode }, actor, access.branchId, { transaction: tx });
      if (!result.ok) return { error: result.error };
      return { id: result.product.id, kind: action.kind };
    }
    const existing = await tx.localInventoryDocument.findFirst({
      where: { branchId: access.branchId, source: "assistant", externalCode },
      select: { id: true, applicable: true },
    });
    if (existing) return { id: existing.id, kind: action.kind, posted: existing.applicable };
    const result = await createLocalStockDocument({
      type: "receipt", storeId: action.storeId, counterpartyId: action.supplierId, applicable: action.post,
      positions: action.lines.map(line => ({
        productId: line.productId, quantity: line.quantity, price: line.unitPriceRubles,
      })),
    }, actor, {
      transaction: tx,
      sourceMetadata: {
        source: "assistant", externalCode, raw: { assistant: true },
        positions: action.lines.map((_, index) => ({ source: "assistant", externalCode: `${externalCode}:${index}`, raw: {} })),
      },
    });
    if (!result.ok) throw new Error(result.error);
    return { id: result.document.id, kind: action.kind, posted: action.post };
  }, { timeout: 30_000 });
}
