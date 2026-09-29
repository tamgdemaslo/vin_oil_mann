import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { createJiti } from "jiti";
import { PrismaClient } from "@prisma/client";

const url = new URL(process.env.DATABASE_URL || "http://invalid");
assert.ok(["127.0.0.1", "localhost"].includes(url.hostname) && url.pathname === "/eco_barrels_test", "Use a disposable local database named eco_barrels_test; production URLs are forbidden.");
const jiti = createJiti(import.meta.url, { alias: { "@": resolve(process.cwd(), "src") } });
const lib = await jiti.import("../src/lib/bulk-oil-barrels.ts");
const { runWithRequestTenant } = await jiti.import("../src/lib/request-tenant-store.ts");
const { prisma } = await jiti.import("../src/lib/db.ts");
const admin = await jiti.import("../src/lib/local-inventory-admin.ts");
const { enqueueAqsiFiscalization } = await jiti.import("../src/lib/aqsi-fiscalization.ts");
const seed = new PrismaClient();
const prefix = `barrel-test-${randomUUID()}`;
const branchId = `${prefix}-branch`, storeId = `${prefix}-store`, productId = `${prefix}-oil`;
const code = (n) => `010460123456789021${String(n).padStart(13, "0")}\u001d93abcd`;
const tenant = { mode: "branch", branchId, organizationId: branchId, allowedBranchIds: [branchId] };
const actor = { login: "barrel-test", name: "Тест", role: "owner" };
const tx = (fn) => prisma.$transaction(fn, { timeout: 15000 });
const movement = (qty, mark = code(2)) => [{ productId, volumeLiters: qty, markingCode: mark, storeId }];
const product = () => prisma.localProduct.findFirst({ where: { id: productId, branchId } });
const list = () => lib.listProductBarrels(branchId, productId);
const switchTo = async (barrelId, confirmEmpty = false, reason = "") => {
  const data = await list();
  return tx((t) => lib.switchBarrelTx(t, { branchId, productId, barrelId, expectedActiveId: data.settings.activeBarrelId, expectedRemainingLiters: data.settings.currentVolumeLiters, confirmEmpty, reason, actor }, async (old) => {
    const result = await admin.createLocalStockDocument({ type: "writeoff", storeId: old.storeId, applicable: true, adjustmentType: "expense", adjustmentMethod: "WRITE_OFF_QUANTITY", adjustmentReason: "Другое фактическое списание", description: reason, positions: [{ productId, quantity: old.remainingLiters }] }, actor, { transaction: t });
    assert.equal(result.ok, true, result.error); return result.document.id;
  }));
};
let checks = 0;
async function check(name, fn) { await fn(); checks++; console.log(`PASS ${name}`); }
try {
  await seed.businessGroup.create({ data: { id: `${prefix}-group`, name: "Barrel queue test", slug: `${prefix}-group` } });
  await seed.branch.create({ data: { id: branchId, businessGroupId: `${prefix}-group`, name: "Branch test", shortName: "TEST", slug: branchId } });
  await seed.aqsiCashRegister.create({ data: { id: `${prefix}-register`, branchId, businessGroupId: `${prefix}-group`, organizationId: branchId, name: "Local test queue", credentialsEncrypted: {} } });
  await seed.localStore.create({ data: { id: storeId, branchId, name: "Склад теста" } });
  await seed.localProduct.create({ data: { id: productId, branchId, name: "Тестовое разливное масло", uomName: "л", markingEnabled: true, markingMode: "BULK_OIL_FROM_MARKED_BARREL", markingStatus: "BULK_OIL_READY", markingSettings: { allowRepeatedBarrelCode: true, partialWithdrawalEnabled: true, declaredVolumeLiters: 208, currentVolumeLiters: 12, activeBarrelMarkingCode: code(1), activeBarrelName: "Старая бочка" } } });
  await seed.localStockBalance.create({ data: { branchId, productId, storeId, quantity: 12, available: 12, buyPriceCents: 10000 } });
  await runWithRequestTenant(tenant, async () => {
    await check("receipt validates code, duplicate scan, volume and litre total", async () => {
      assert.equal(lib.parseBarrelReceipts([{ markingCode: code(2), volumeLiters: 208 }], 208).length, 1);
      for (const data of [[{ markingCode: "bad", volumeLiters: 208 }], [{ markingCode: code(2), volumeLiters: -1 }], [{ markingCode: code(2), volumeLiters: 1.0001 }], [{ markingCode: code(2), volumeLiters: 208 }, { markingCode: code(2), volumeLiters: 208 }]]) assert.throws(() => lib.parseBarrelReceipts(data, 208));
      assert.throws(() => lib.parseBarrelReceipts([{ markingCode: code(2), volumeLiters: 208 }], 1));
    });
    await check("missing scan rolls back the entire posted receipt", async () => {
      const result = await admin.createLocalStockDocument({ type: "receipt", storeId, positions: [{ productId, quantity: 208, price: 100 }] }, actor);
      assert.equal(result.ok, false); assert.match(result.error, /Отсканируйте/);
      assert.equal((await prisma.localStockBalance.findFirst({ where: { productId, storeId } })).quantity.toNumber(), 12);
      assert.equal(await prisma.localInventoryDocument.count({ where: { branchId } }), 0);
    });
    let receipt;
    await check("receive sealed drum, preserve current code/12 litres, total stock becomes 220", async () => {
      receipt = await admin.createLocalStockDocument({ type: "receipt", storeId, positions: [{ productId, quantity: 208, price: 100, barrels: [{ markingCode: code(2), volumeLiters: 208 }] }] }, actor);
      assert.equal(receipt.ok, true, receipt.error);
      const data = await list(); assert.equal(data.barrels.length, 2);
      assert.equal(data.settings.activeBarrelMarkingCode, code(1)); assert.equal(data.settings.currentVolumeLiters, 12);
      assert.equal(data.barrels.find((b) => b.markingCode === code(2)).status, "SEALED");
      assert.equal((await prisma.localStockBalance.findFirst({ where: { productId, storeId } })).quantity.toNumber(), 220);
    });
    const nextId = (await list()).barrels.find((b) => b.markingCode === code(2)).id;
    await check("duplicate receipt is rejected without adding any stock", async () => {
      const result = await admin.createLocalStockDocument({ type: "receipt", storeId, positions: [{ productId, quantity: 208, price: 100, barrels: [{ markingCode: code(2), volumeLiters: 208 }] }] }, actor);
      assert.equal(result.ok, false); assert.match(result.error, /уже принята/);
      assert.equal((await prisma.localStockBalance.findFirst({ where: { productId, storeId } })).quantity.toNumber(), 220);
    });
    await check("switch requires empty confirmation and reason when old stock remains", async () => {
      await assert.rejects(switchTo(nextId), /Подтвердите/);
      assert.equal((await list()).settings.activeBarrelMarkingCode, code(1));
    });
    await check("switch creates real discrepancy writeoff and connects new drum", async () => {
      await switchTo(nextId, true, "Проверка: старая бочка пуста");
      const data = await list(); assert.equal(data.settings.activeBarrelMarkingCode, code(2)); assert.equal(data.settings.currentVolumeLiters, 208);
      assert.equal(data.barrels.find((b) => b.markingCode === code(1)).status, "CLOSED");
      const evt = await prisma.localBulkOilBarrelEvent.findFirst({ where: { branchId, action: "DISCREPANCY" } });
      assert.equal(evt.volumeLiters.toNumber(), 12); assert.ok(evt.documentId);
      assert.equal((await prisma.localStockBalance.findFirst({ where: { productId, storeId } })).quantity.toNumber(), 208);
    });
    await check("sale uses active drum and retries withdraw only once", async () => {
      await tx((t) => lib.consumeBulkOilTx(t, branchId, `${prefix}-sale1`, movement(5), actor));
      await tx((t) => lib.consumeBulkOilTx(t, branchId, `${prefix}-sale1`, movement(5), actor));
      assert.equal((await list()).settings.currentVolumeLiters, 203);
      assert.equal(await prisma.localBulkOilBarrelEvent.count({ where: { branchId, action: "SALE" } }), 1);
    });
    await check("excess volume, wrong code and wrong warehouse cannot debit stock", async () => {
      await assert.rejects(tx((t) => lib.consumeBulkOilTx(t, branchId, `${prefix}-too-much`, movement(204), actor)), /недостаточно/);
      await assert.rejects(tx((t) => lib.consumeBulkOilTx(t, branchId, `${prefix}-old-code`, movement(1, code(1)), actor)), /изменилась/);
      await assert.rejects(tx((t) => lib.consumeBulkOilTx(t, branchId, `${prefix}-wrong-store`, [{ ...movement(1)[0], storeId: "foreign-store" }], actor)), /другом складе/);
      assert.equal((await list()).settings.currentVolumeLiters, 203);
    });
    await check("two positions of the same product are aggregated", async () => {
      await assert.rejects(tx((t) => lib.consumeBulkOilTx(t, branchId, `${prefix}-aggregate`, [...movement(110), ...movement(110)], actor)), /недостаточно/);
      assert.equal((await list()).settings.currentVolumeLiters, 203);
    });
    await check("parallel sales serialize and cannot make barrel negative", async () => {
      const results = await Promise.allSettled([tx((t) => lib.consumeBulkOilTx(t, branchId, `${prefix}-parallel1`, movement(150), actor)), tx((t) => lib.consumeBulkOilTx(t, branchId, `${prefix}-parallel2`, movement(150), actor))]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal((await list()).settings.currentVolumeLiters, 53);
    });
    await check("receipt reversal fails once its drum has been opened", async () => {
      await assert.rejects(tx((t) => lib.cancelReceiptBarrelsTx(t, branchId, receipt.document.id, actor)), /уже использовалась/);
    });
    await check("barrel and event queries enforce branch isolation", async () => {
      await assert.rejects(prisma.localBulkOilBarrel.findMany({ where: { branchId: "foreign" } }), /другого филиала/);
      assert.equal(await prisma.localBulkOilBarrel.count({ where: { productId: "foreign" } }), 0);
    });
    await check("card edits cannot replace managed code or undo tracking", async () => {
      const result = await admin.updateLocalAdminProduct(productId, { markingSettings: { ...(await list()).settings, activeBarrelMarkingCode: code(9) } }, actor, branchId);
      assert.equal(result.ok, false); assert.match(result.error, /управляются/);
      assert.equal((await list()).settings.activeBarrelMarkingCode, code(2));
    });
    let draft;
    await check("draft saves scans; posting registers only sealed drums", async () => {
      draft = await admin.createLocalStockDocument({ type: "receipt", storeId, applicable: false, positions: [{ productId, quantity: 208, price: 100, barrels: [{ markingCode: code(3), volumeLiters: 208 }] }] }, actor);
      assert.equal(draft.ok, true, draft.error); assert.equal((await list()).barrels.length, 2);
      const posted = await admin.postLocalReceipt(draft.document.id, actor); assert.equal(posted.ok, true, posted.error);
      assert.equal((await list()).barrels.find((b) => b.markingCode === code(3)).status, "SEALED");
      assert.equal((await list()).settings.activeBarrelMarkingCode, code(2));
    });
    await check("reversal cancels sealed drum; repost reuses its identity", async () => {
      const before = (await list()).barrels.find((b) => b.markingCode === code(3));
      const result = await admin.unpostLocalReceipt(draft.document.id, actor); assert.equal(result.ok, true, result.error);
      assert.equal((await list()).barrels.find((b) => b.id === before.id).status, "CANCELLED");
      const repost = await admin.postLocalReceipt(draft.document.id, actor); assert.equal(repost.ok, true, repost.error);
      assert.equal((await list()).barrels.find((b) => b.markingCode === code(3)).id, before.id);
    });
    await check("AQSI outbox and litre withdrawal commit together; retry pins first code", async () => {
      const demandId = `${prefix}-queue-sale`;
      const payload = { id: demandId, number: "QA", dateTime: new Date().toISOString(), comment: "", customer: "", items: [{ name: "Oil", quantity: 2, unitPrice: 100, markingRequired: true, markingCode: code(2), measuredPour: true }] };
      const before = (await list()).settings.currentVolumeLiters;
      const record = await enqueueAqsiFiscalization(payload, `${prefix}-register`, (t) => lib.consumeBulkOilTx(t, branchId, demandId, movement(2), actor));
      const repeated = await enqueueAqsiFiscalization({ ...payload, items: [{ ...payload.items[0], markingCode: code(3) }] }, `${prefix}-register`, () => { throw new Error("Retry must not debit again"); });
      assert.equal(repeated.id, record.id); assert.equal(repeated.payloadJson.items[0].markingCode, code(2));
      assert.equal((await list()).settings.currentVolumeLiters, before - 2);
    });
    await check("failed outbox creation rolls back litre withdrawal and sale event", async () => {
      const demandId = `${prefix}-queue-fail`, before = (await list()).settings.currentVolumeLiters;
      const payload = { id: demandId, number: "QA", dateTime: new Date().toISOString(), comment: "", customer: "", items: [] };
      await assert.rejects(enqueueAqsiFiscalization(payload, "missing-register", (t) => lib.consumeBulkOilTx(t, branchId, demandId, movement(2), actor)));
      assert.equal((await list()).settings.currentVolumeLiters, before);
      assert.equal(await prisma.localBulkOilBarrelEvent.count({ where: { branchId, operationKey: `sale:${demandId}:${productId}` } }), 0);
    });
    await check("switch after empty drum requires no discrepancy and old queue retry stays idempotent", async () => {
      const current = (await list()).settings.currentVolumeLiters;
      await tx((t) => lib.consumeBulkOilTx(t, branchId, `${prefix}-empty`, movement(current), actor));
      const sealed = (await list()).barrels.find((b) => b.markingCode === code(3));
      await switchTo(sealed.id);
      await tx((t) => lib.consumeBulkOilTx(t, branchId, `${prefix}-queue-sale`, movement(2), actor));
      assert.equal((await list()).settings.currentVolumeLiters, 208); assert.equal((await list()).settings.activeBarrelMarkingCode, code(3));
    });
  });
  console.log(`Bulk oil barrels: ${checks} checks passed.`);
} finally { await seed.$disconnect(); await prisma.$disconnect(); }
