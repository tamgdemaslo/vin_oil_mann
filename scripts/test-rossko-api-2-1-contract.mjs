#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, alias: { "@": resolve(process.cwd(), "src") } });
const { recoverableRosskoClient, rosskoCheckoutOptions, validateRosskoCheckoutSelection } = await jiti.import("../src/lib/rossko.ts");

const clientCache = new Map();
let clientAttempts = 0;
const createRecoverableClient = async () => {
  clientAttempts += 1;
  if (clientAttempts === 1) throw new Error("temporary WSDL failure");
  return { connected: true };
};
await assert.rejects(() => recoverableRosskoClient(clientCache, "branch", createRecoverableClient), /temporary WSDL failure/);
assert.equal(clientCache.size, 0, "a failed SOAP client promise must not remain cached");
assert.deepEqual(await recoverableRosskoClient(clientCache, "branch", createRecoverableClient), { connected: true });
assert.equal(clientAttempts, 2, "the next request must be able to recreate the SOAP client");

const details = {
  success: true,
  DeliveryType: { delivery: [{ id: "pickup", name: "Самовывоз" }, { id: "courier", name: "Курьер" }] },
  PaymentType: { payment: [{ id: "1", name: "Картой" }] },
  DeliveryAddress: {
    address: [{
      id: "address-1",
      city: "Калининград",
      street: "Дачная",
      house: "6В",
      office: "3",
      Delivery: { ids: { id: ["courier"] } },
    }],
  },
  CompanyList: { company: [{ id: "company-1", name: "ИП Тест", requisite: "ИНН 123456789012" }] },
};

const options = rosskoCheckoutOptions(details);
assert.deepEqual(options.delivery, [{ id: "pickup", name: "Самовывоз" }, { id: "courier", name: "Курьер" }]);
assert.deepEqual(options.payment, [{ id: "1", name: "Картой" }]);
assert.equal(options.address[0]?.label, "Калининград, Дачная, д. 6В, оф. 3");
assert.deepEqual(options.address[0]?.deliveryIds, ["courier"]);
assert.deepEqual(options.company, [{ id: "company-1", name: "ИП Тест", requisite: "ИНН 123456789012" }]);

assert.deepEqual(
  validateRosskoCheckoutSelection(options, { deliveryId: "courier", addressId: "address-1", paymentId: "1", requisiteId: "company-1" }),
  []
);
assert.match(
  validateRosskoCheckoutSelection(options, { deliveryId: "pickup", addressId: "address-1", paymentId: "1", requisiteId: "company-1" }).join(" "),
  /адрес не поддерживает/i
);

const [integration, settingsRoute, orderRoute, restockClient, form] = await Promise.all([
  readFile("src/lib/rossko-integration.ts", "utf8"),
  readFile("src/app/api/integrations/rossko/route.ts", "utf8"),
  readFile("src/app/api/rossko/order/route.ts", "utf8"),
  readFile("src/app/operations/restock/RestockClient.tsx", "utf8"),
  readFile("src/app/cabinet/integrations/IntegrationsClient.tsx", "utf8"),
]);
assert.doesNotMatch(settingsRoute, /profile:\s*z\./);
assert.doesNotMatch(settingsRoute, /preferredStore:\s*z\./);
assert.doesNotMatch(form, />Профиль ROSSKO</);
assert.doesNotMatch(form, />Предпочитаемый склад</);
assert.match(integration, /"contactComment"/);
assert.match(integration, /"offerPriority"/);
assert.match(restockClient, /contact_name:\s*DEFAULT_RSSK_CONTACT_NAME/);
assert.match(restockClient, /contact_phone:\s*DEFAULT_RSSK_CONTACT_PHONE/);
assert.match(orderRoute, /cfg\.contactName\?\.trim\(\) \|\| requestText\(body\.contact_name, 180\)/);
assert.match(orderRoute, /cfg\.contactPhone\?\.trim\(\) \|\| requestText\(body\.contact_phone, 80\)/);

console.log("ROSSKO API 2.1 checkout mapping and form contract — passed");
