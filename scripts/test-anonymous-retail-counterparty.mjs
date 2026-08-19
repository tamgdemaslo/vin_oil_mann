#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import { resolve } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  alias: { "@": resolve(process.cwd(), "src") },
});
const anonymousRetail = await jiti.import("../src/lib/anonymous-retail-counterparty.ts");

const rows = new Map();
const fakeClient = {
  localCounterparty: {
    upsert: async ({ where, create, update }) => {
      const current = rows.get(where.id);
      const next = current
        ? { ...current, ...update, updatedAt: new Date() }
        : { ...create, createdAt: new Date(), updatedAt: new Date() };
      rows.set(where.id, next);
      return next;
    },
  },
};

const branchOneFirst = await anonymousRetail.ensureAnonymousRetailCounterparty("branch-one", fakeClient);
const branchOneSecond = await anonymousRetail.ensureAnonymousRetailCounterparty("branch-one", fakeClient);
const branchTwo = await anonymousRetail.ensureAnonymousRetailCounterparty("branch-two", fakeClient);

assert.equal(rows.size, 2, "repeat bootstrap must not create duplicates");
assert.equal(branchOneFirst.id, branchOneSecond.id, "the same branch must keep one stable id");
assert.notEqual(branchOneFirst.id, branchTwo.id, "branches must use different counterparties");
assert.equal(anonymousRetail.isAnonymousRetailCounterparty(branchOneSecond), true);
assert.equal(anonymousRetail.isAnonymousRetailCounterparty(branchTwo), true);
assert.equal(branchOneSecond.name, "Розничный покупатель");
assert.equal(branchOneSecond.phone, null);
assert.equal(branchOneSecond.archived, false);

const source = (path) => fs.readFileSync(resolve(process.cwd(), path), "utf8");
assert.match(source("src/lib/demand-create-payload.ts"), /agent\?: \{ meta: LocalEntityMeta \}/);
assert.match(source("src/lib/local-demand-write.ts"), /ensureAnonymousRetailCounterparty\(scope\.branchId\)/);
assert.match(source("src/lib/local-demand-write.ts"), /customerMode: isAnonymousRetailCounterparty\(counterparty\) \? "anonymous_retail"/);
assert.match(source("src/lib/branches.ts"), /ensureAnonymousRetailCounterparty\(created\.id, tx\)/);
assert.match(source("src/lib/local-inventory-admin.ts"), /System|system/i);
assert.match(source("src/lib/local-inventory-admin.ts"), /Системного контрагента нельзя изменить/);
assert.match(source("src/lib/client-notifications/client-notifications.ts"), /reason: "anonymous_retail"/);
assert.match(source("src/lib/customer-analytics.ts"), /anonymousRetailDocumentStats/);
assert.match(source("src/lib/customer-analytics.ts"), /anonymousRetailDemands/);
assert.match(source("src/lib/messenger/messenger-contact-actions.ts"), /нельзя отправлять сообщения/);
assert.match(source("src/lib/messenger/messenger-context.ts"), /нельзя привязать к диалогу или автомобилю/);
assert.match(source("src/lib/ai-agent/tools.ts"), /Для сохранения автомобиля нужно указать реального клиента/);
assert.match(source("src/app/shipment/new/NewShipmentPageClient.tsx"), /Без данных клиента/);
assert.match(source("src/app/shipment/new/NewShipmentPageClient.tsx"), /Указать клиента/);

console.log("Anonymous retail counterparty: PASS");
