import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getMotorOilMarkingCodeError, isRecognizedMotorOilMarkingCode, normalizeMarkingCodeInput, parseMarkingCodesInput } from "@/lib/marking";
import { deriveProductMarkingStatus, normalizeProductMarkingSettings, type ProductMarkingSettings } from "@/lib/product-marking";

export type BarrelReceiptInput = { markingCode: string; volumeLiters: number };
export type BulkOilMovement = { productId: string; volumeLiters: number; markingCode: string; storeId: string };
type Actor = { login?: string; name?: string | null };
type Product = { id: string; name: string; markingEnabled: boolean; markingMode: string; markingStatus: string; markingSettings: unknown; uomName: string | null };

export function parseBarrelReceipts(value: unknown, quantity: number): BarrelReceiptInput[] {
  if (!Array.isArray(value) || !value.length) throw new Error("Отсканируйте код каждой принимаемой бочки и укажите её объём.");
  const seen = new Set<string>();
  const barrels = value.map((item) => {
    if (!item || typeof item !== "object") throw new Error("Неверные данные бочки.");
    const row = item as Record<string, unknown>;
    const markingCode = normalizeMarkingCodeInput(String(row.markingCode ?? ""));
    const volumeLiters = Number(String(row.volumeLiters ?? "").replace(",", "."));
    const codeError = getMotorOilMarkingCodeError(markingCode);
    if (codeError) throw new Error(codeError);
    if (seen.has(markingCode)) throw new Error("Одна бочка указана в приёмке дважды.");
    if (!Number.isFinite(volumeLiters) || volumeLiters <= 0 || volumeLiters > 99999999999 || Math.abs(volumeLiters * 1000 - Math.round(volumeLiters * 1000)) > 0.00001) throw new Error("Объём бочки должен быть положительным числом, не более трёх знаков после запятой.");
    seen.add(markingCode);
    return { markingCode, volumeLiters };
  });
  const total = barrels.reduce((sum, barrel) => sum + barrel.volumeLiters, 0);
  if (Math.abs(total - quantity) > 0.000001) throw new Error(`Объём бочек (${total} л) должен совпадать с количеством позиции (${quantity} л).`);
  return barrels;
}

export function receiptBarrelsFromRaw(raw: unknown): unknown {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>).barrels : undefined;
}

// Used by receipts, switching, product editing and sales; always in product-id order.
export async function lockBarrelProducts(tx: Prisma.TransactionClient, branchId: string, productIds: string[]) {
  for (const id of [...new Set(productIds)].sort()) {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM local_products WHERE branch_id = ${branchId} AND id = ${id} FOR UPDATE`);
  }
}

async function writeSettings(tx: Prisma.TransactionClient, branchId: string, product: Product, settings: ProductMarkingSettings, actor?: Actor) {
  // Match the millilitre precision of the barrel table; legacy card values may
  // contain floating point tails such as 3.69000000000001.
  settings = { ...settings, currentVolumeLiters: settings.currentVolumeLiters == null ? null : Math.round(settings.currentVolumeLiters * 1000) / 1000 };
  const markingStatus = deriveProductMarkingStatus({ markingEnabled: true, markingMode: "BULK_OIL_FROM_MARKED_BARREL", uomName: product.uomName, settings });
  await tx.localProduct.update({ where: { id: product.id, branchId }, data: {
    markingSettings: settings as unknown as Prisma.InputJsonValue, markingStatus,
  } });
  const before = { markingEnabled: product.markingEnabled, markingMode: product.markingMode, markingStatus: product.markingStatus, markingSettings: normalizeProductMarkingSettings(product.markingSettings) };
  const after = { ...before, markingStatus, markingSettings: settings };
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    await tx.productMarkingAuditLog.create({ data: { branchId, productId: product.id,
      oldValue: before as unknown as Prisma.InputJsonValue, newValue: after as unknown as Prisma.InputJsonValue,
      performedByLogin: actor?.login, performedByName: actor?.name,
    } });
  }
}

async function event(tx: Prisma.TransactionClient, branchId: string, barrelId: string, action: string, actor?: Actor, extra: { volumeLiters?: number; reason?: string; documentId?: string; operationKey?: string } = {}) {
  return tx.localBulkOilBarrelEvent.create({ data: { branchId, barrelId, action, createdByLogin: actor?.login, ...extra, operationKey: extra.operationKey ?? randomUUID() } });
}

/** Preserve the current open drum when moving from the old card-only settings. No stock is added. */
export async function enableBarrelTrackingTx(tx: Prisma.TransactionClient, branchId: string, product: Product, storeId: string, actor?: Actor) {
  const settings = normalizeProductMarkingSettings(product.markingSettings);
  if (settings.barrelTrackingEnabled) return settings;
  if (!product.markingEnabled || product.markingMode !== "BULK_OIL_FROM_MARKED_BARREL") throw new Error("Сначала сохраните товар со сценарием «Масло на разлив из бочки».");
  const store = await tx.localStore.findFirst({ where: { id: storeId, branchId, archived: false } });
  if (!store) throw new Error("Выберите склад текущего филиала.");
  let activeBarrelId = "";
  if (settings.activeBarrelMarkingCode) {
    const code = normalizeMarkingCodeInput(settings.activeBarrelMarkingCode);
    if (!isRecognizedMotorOilMarkingCode(code) || settings.currentVolumeLiters == null || !settings.declaredVolumeLiters || settings.currentVolumeLiters > settings.declaredVolumeLiters) throw new Error("Проверьте код, объём и остаток текущей бочки перед включением учёта.");
    const existing = await tx.localBulkOilBarrel.findFirst({ where: { branchId, markingCode: code } });
    if (existing) throw new Error(`Код уже зарегистрирован: ${existing.number}.`);
    const barrel = await tx.localBulkOilBarrel.create({ data: {
      branchId, productId: product.id, storeId, number: settings.activeBarrelName || `Б-${randomUUID().slice(0, 8).toUpperCase()}`,
      markingCode: code, gtin: code.slice(2, 16), status: "OPEN", receivedLiters: settings.declaredVolumeLiters,
      remainingLiters: settings.currentVolumeLiters, openedAt: new Date(), createdByLogin: actor?.login,
    } });
    activeBarrelId = barrel.id;
    await event(tx, branchId, barrel.id, "LEGACY_ADOPTED", actor, { volumeLiters: settings.currentVolumeLiters, reason: "Перенесена текущая бочка из карточки товара. Складской остаток не изменён." });
  }
  const next = { ...settings, allowRepeatedBarrelCode: true, partialWithdrawalEnabled: true, barrelTrackingEnabled: true, activeBarrelId };
  await writeSettings(tx, branchId, product, next, actor);
  return next;
}

export async function registerReceiptBarrelsTx(tx: Prisma.TransactionClient, input: { branchId: string; documentId: string; storeId: string; positions: Array<{ productId: string; quantity: number; raw: unknown }>; actor?: Actor }) {
  await lockBarrelProducts(tx, input.branchId, input.positions.map((p) => p.productId));
  for (const position of input.positions) {
    const product = await tx.localProduct.findFirst({ where: { id: position.productId, branchId: input.branchId } });
    if (!product) throw new Error("Товар приёмки не найден в филиале.");
    if (!product.markingEnabled || product.markingMode !== "BULK_OIL_FROM_MARKED_BARREL") continue;
    const entries = parseBarrelReceipts(receiptBarrelsFromRaw(position.raw), position.quantity);
    const settings = normalizeProductMarkingSettings(product.markingSettings);
    if (!settings.barrelTrackingEnabled && settings.activeBarrelMarkingCode) {
      const stores = await tx.localStockBalance.findMany({ where: { branchId: input.branchId, productId: product.id, quantity: { gt: 0 } } });
      if (stores.length > 1) throw new Error(`У товара «${product.name}» остатки на нескольких складах. В карточке товара сначала укажите склад текущей бочки.`);
      await enableBarrelTrackingTx(tx, input.branchId, product, stores[0]?.storeId ?? input.storeId, input.actor);
    } else {
      await enableBarrelTrackingTx(tx, input.branchId, product, input.storeId, input.actor);
    }
    for (const entry of entries) {
      const existing = await tx.localBulkOilBarrel.findFirst({ where: { branchId: input.branchId, markingCode: entry.markingCode } });
      if (existing && !(existing.status === "CANCELLED" && existing.receiptDocumentId === input.documentId && existing.productId === product.id)) throw new Error(`Бочка ${existing.number} уже принята. Повторная приёмка кода запрещена.`);
      const data = { storeId: input.storeId, status: "SEALED", receivedLiters: entry.volumeLiters, remainingLiters: entry.volumeLiters, receivedAt: new Date(), closedAt: null };
      const barrel = existing
        ? await tx.localBulkOilBarrel.update({ where: { id: existing.id, branchId: input.branchId }, data })
        : await tx.localBulkOilBarrel.create({ data: { ...data, branchId: input.branchId, productId: product.id, number: `Б-${randomUUID().slice(0, 8).toUpperCase()}`, markingCode: entry.markingCode, gtin: entry.markingCode.slice(2, 16), receiptDocumentId: input.documentId, createdByLogin: input.actor?.login } });
      await event(tx, input.branchId, barrel.id, "RECEIVED", input.actor, { volumeLiters: entry.volumeLiters, documentId: input.documentId });
    }
  }
}

export async function cancelReceiptBarrelsTx(tx: Prisma.TransactionClient, branchId: string, documentId: string, actor?: Actor) {
  const barrels = await tx.localBulkOilBarrel.findMany({ where: { branchId, receiptDocumentId: documentId, status: { not: "CANCELLED" } } });
  await lockBarrelProducts(tx, branchId, barrels.map((b) => b.productId));
  // Re-read after acquiring the product lock: a concurrent switch must prevent reversal.
  const current = await tx.localBulkOilBarrel.findMany({ where: { branchId, receiptDocumentId: documentId, status: { not: "CANCELLED" } } });
  for (const barrel of current) {
    if (barrel.status !== "SEALED" || !barrel.remainingLiters.equals(barrel.receivedLiters)) throw new Error(`Бочка ${barrel.number} уже использовалась. Отмена приёмки запрещена.`);
    await tx.localBulkOilBarrel.update({ where: { id: barrel.id, branchId }, data: { status: "CANCELLED", remainingLiters: 0, closedAt: new Date() } });
    await event(tx, branchId, barrel.id, "RECEIPT_REVERSED", actor, { documentId });
  }
}

export async function listProductBarrels(branchId: string, productId: string) {
  const product = await prisma.localProduct.findFirst({ where: { id: productId, branchId } });
  if (!product) throw new Error("Товар не найден.");
  const barrels = await prisma.localBulkOilBarrel.findMany({ where: { branchId, productId }, include: { store: { select: { name: true } } }, orderBy: { receivedAt: "desc" } });
  const settings = normalizeProductMarkingSettings(product.markingSettings);
  const active = barrels.find((barrel) => barrel.id === settings.activeBarrelId && barrel.status === "OPEN");
  const eligibleCorrections = active
    ? await prisma.localInventoryDocument.findMany({
        where: {
          branchId, type: "writeoff", adjustmentType: "technical", applicable: true, isDeleted: false,
          status: "posted", storeId: active.storeId,
          positions: { some: { productId } },
        },
        select: { id: true, name: true, momentAt: true, positions: { where: { productId }, select: { quantity: true } } },
        orderBy: [{ momentAt: "desc" }, { id: "desc" }],
        take: 20,
      })
    : [];
  return {
    settings,
    barrels: barrels.map((b) => ({ ...b, receivedLiters: b.receivedLiters.toNumber(), remainingLiters: b.remainingLiters.toNumber(), storeName: b.store.name, store: undefined })),
    eligibleCorrections: eligibleCorrections.map((document) => ({ id: document.id, name: document.name, moment: document.momentAt.toISOString(), quantity: document.positions[0]?.quantity.toNumber() ?? 0 })),
  };
}

async function assertBarrelWarehouseStock(tx: Prisma.TransactionClient, branchId: string, productId: string, storeId: string, alreadyClosedLiters = 0) {
  const barrelStock = await tx.localBulkOilBarrel.aggregate({ where: { branchId, productId, storeId, status: { in: ["OPEN", "SEALED"] } }, _sum: { remainingLiters: true } });
  const warehouseStock = await tx.localStockBalance.findFirst({ where: { branchId, productId, storeId } });
  const barrelLiters = Math.round(((barrelStock._sum.remainingLiters?.toNumber() ?? 0) - alreadyClosedLiters) * 1000) / 1000;
  const warehouseLiters = warehouseStock?.quantity.toNumber() ?? 0;
  if (Math.abs(barrelLiters - warehouseLiters) > 0.000001) throw new Error(`Сумма остатков бочек (${barrelLiters} л) не совпадает со складским остатком (${warehouseLiters} л). Перед сменой бочки требуется сверка учёта.`);
}

export async function switchBarrelTx(tx: Prisma.TransactionClient, input: { branchId: string; productId: string; barrelId?: string; scannedCode?: string; expectedActiveId: string; expectedRemainingLiters: number | null; confirmEmpty: boolean; reason: string; alreadyAdjustedDocumentId?: string; actor?: Actor }, writeoff: (barrel: { storeId: string; remainingLiters: number; number: string }) => Promise<string>) {
  await lockBarrelProducts(tx, input.branchId, [input.productId]);
  const product = await tx.localProduct.findFirst({ where: { id: input.productId, branchId: input.branchId } });
  if (!product || !product.markingEnabled || product.markingMode !== "BULK_OIL_FROM_MARKED_BARREL") throw new Error("Товар не настроен для разлива.");
  const settings = normalizeProductMarkingSettings(product.markingSettings);
  if (!settings.barrelTrackingEnabled) throw new Error("Сначала включите отдельный учёт бочек.");
  const code = normalizeMarkingCodeInput(input.scannedCode ?? "");
  if (!input.barrelId && !code) throw new Error("Выберите или отсканируйте новую бочку.");
  const next = await tx.localBulkOilBarrel.findFirst({ where: { branchId: input.branchId, productId: input.productId, ...(input.barrelId ? { id: input.barrelId } : { markingCode: code }) } });
  if (!next || next.status !== "SEALED") throw new Error("Выберите принятую запечатанную бочку этого товара.");
  if (settings.activeBarrelId !== input.expectedActiveId || settings.currentVolumeLiters !== input.expectedRemainingLiters) throw new Error("Текущая бочка или её остаток изменились. Обновите список и повторите смену.");
  if (settings.activeBarrelId) {
    const old = await tx.localBulkOilBarrel.findFirst({ where: { id: settings.activeBarrelId, branchId: input.branchId, productId: product.id, status: "OPEN" } });
    if (!old) throw new Error("Текущая бочка не найдена. Требуется проверка учёта.");
    const remaining = old.remainingLiters.toNumber();
    if (settings.currentVolumeLiters == null || Math.abs(remaining - settings.currentVolumeLiters) > 0.000001) throw new Error("Остаток бочки не совпадает с карточкой. Требуется проверка учёта.");
    let documentId: string | undefined;
    let discrepancyLiters = remaining;
    let discrepancyReason = input.reason.trim();
    if (remaining > 0) {
      if (!input.confirmEmpty || !input.reason.trim()) throw new Error(`В старой бочке числится ${remaining} л. Подтвердите, что она пуста, и укажите причину расхождения.`);
      if (input.alreadyAdjustedDocumentId) {
        const adjustment = await tx.localInventoryDocument.findFirst({
          where: {
            id: input.alreadyAdjustedDocumentId, branchId: input.branchId, type: "writeoff", adjustmentType: "technical",
            applicable: true, isDeleted: false, status: "posted", storeId: old.storeId,
            positions: { some: { productId: input.productId } },
          },
          select: { id: true, positions: { where: { productId: input.productId }, select: { quantity: true } } },
        });
        if (!adjustment) throw new Error("Выбранная корректировка не относится к этому товару и складу.");
        documentId = adjustment.id;
        const adjustedLiters = adjustment.positions[0]?.quantity.toNumber();
        if (adjustedLiters == null) throw new Error("В корректировке не найдено количество для этого товара.");
        // The referenced document already debited the warehouse. Before closing
        // the old record, ensure all other drums still retain their full stock.
        await assertBarrelWarehouseStock(tx, input.branchId, product.id, old.storeId, remaining);
        discrepancyLiters = Math.round(Math.abs(remaining - adjustedLiters) * 1000) / 1000;
        discrepancyReason = `Корректировка ${adjustment.id} списала ${adjustedLiters} л; в старой записи бочки числилось ${remaining} л. Разница ${discrepancyLiters} л. ${discrepancyReason}`;
      } else {
        await assertBarrelWarehouseStock(tx, input.branchId, product.id, old.storeId);
        documentId = await writeoff({ storeId: old.storeId, remainingLiters: remaining, number: old.number });
      }
      await event(tx, input.branchId, old.id, "DISCREPANCY", input.actor, { volumeLiters: discrepancyLiters, reason: discrepancyReason, documentId });
    } else {
      await assertBarrelWarehouseStock(tx, input.branchId, product.id, old.storeId);
    }
    await tx.localBulkOilBarrel.update({ where: { id: old.id, branchId: input.branchId }, data: { status: "CLOSED", remainingLiters: 0, closedAt: new Date() } });
    await event(tx, input.branchId, old.id, "CLOSED", input.actor, { documentId });
  }
  await tx.localBulkOilBarrel.update({ where: { id: next.id, branchId: input.branchId }, data: { status: "OPEN", openedAt: new Date() } });
  await event(tx, input.branchId, next.id, "OPENED", input.actor, { documentId: next.receiptDocumentId ?? undefined });
  await writeSettings(tx, input.branchId, product, { ...settings, activeBarrelId: next.id, activeBarrelName: next.number, activeBarrelMarkingCode: next.markingCode, activeBarrelGtin: next.gtin, declaredVolumeLiters: next.receivedLiters.toNumber(), currentVolumeLiters: next.remainingLiters.toNumber() }, input.actor);
}

/** Executed in the same transaction as the durable AQSI outbox record. */
export async function consumeBulkOilTx(tx: Prisma.TransactionClient, branchId: string, demandId: string, movements: BulkOilMovement[], actor?: Actor) {
  const aggregated = new Map<string, BulkOilMovement>();
  for (const movement of movements) {
    if (!Number.isFinite(movement.volumeLiters) || movement.volumeLiters <= 0) throw new Error("Неверный объём продажи на разлив.");
    const previous = aggregated.get(movement.productId);
    if (previous && (previous.markingCode !== movement.markingCode || previous.storeId !== movement.storeId)) throw new Error("В одной продаже указан разный код бочки одного товара.");
    aggregated.set(movement.productId, { ...movement, volumeLiters: Math.round(((previous?.volumeLiters ?? 0) + movement.volumeLiters) * 1000) / 1000 });
  }
  await lockBarrelProducts(tx, branchId, [...aggregated.keys()]);
  for (const movement of aggregated.values()) {
    const operationKey = `sale:${demandId}:${movement.productId}`;
    if (await tx.localBulkOilBarrelEvent.findFirst({ where: { branchId, operationKey } })) continue;
    const product = await tx.localProduct.findFirst({ where: { id: movement.productId, branchId } });
    if (!product) throw new Error("Товар продажи не найден.");
    const settings = normalizeProductMarkingSettings(product.markingSettings);
    if (!product.markingEnabled || product.markingMode !== "BULK_OIL_FROM_MARKED_BARREL" || !settings.partialWithdrawalEnabled || !settings.allowRepeatedBarrelCode) throw new Error("Настройки разлива изменились. Обновите предчек.");
    if (!settings.barrelTrackingEnabled) {
      // Existing installations continue to work until their current drum is adopted.
      if (settings.currentVolumeLiters == null || normalizeMarkingCodeInput(settings.activeBarrelMarkingCode) !== movement.markingCode || movement.volumeLiters > settings.currentVolumeLiters + 0.000001) throw new Error("Изменился код бочки или недостаточно остатка. Обновите предчек.");
      await writeSettings(tx, branchId, product, { ...settings, currentVolumeLiters: Math.round((settings.currentVolumeLiters - movement.volumeLiters) * 1000) / 1000 }, actor);
      continue;
    }
    const barrel = await tx.localBulkOilBarrel.findFirst({ where: { branchId, id: settings.activeBarrelId, productId: movement.productId, status: "OPEN" } });
    if (!barrel || barrel.markingCode !== movement.markingCode) throw new Error("Активная бочка изменилась. Обновите предчек.");
    if (barrel.storeId !== movement.storeId) throw new Error("Активная бочка находится на другом складе. Выберите склад бочки для отгрузки.");
    if (barrel.remainingLiters.toNumber() + 0.000001 < movement.volumeLiters) throw new Error(`В бочке ${barrel.number} недостаточно масла. Остаток: ${barrel.remainingLiters} л. Смените бочку.`);
    const remaining = Math.round((barrel.remainingLiters.toNumber() - movement.volumeLiters) * 1000) / 1000;
    await tx.localBulkOilBarrel.update({ where: { id: barrel.id, branchId }, data: { remainingLiters: remaining } });
    await event(tx, branchId, barrel.id, "SALE", actor, { operationKey, volumeLiters: movement.volumeLiters, documentId: demandId });
    await writeSettings(tx, branchId, product, { ...settings, currentVolumeLiters: remaining }, actor);
  }
}

export function barrelCodesForReceipt(codes: string, volumeLiters: number): BarrelReceiptInput[] {
  return parseMarkingCodesInput(codes).map((markingCode) => ({ markingCode, volumeLiters }));
}
