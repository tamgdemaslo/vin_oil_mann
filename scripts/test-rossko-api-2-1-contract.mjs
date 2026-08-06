#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, alias: { "@": resolve(process.cwd(), "src") } });
const { rosskoCheckoutOptions, validateRosskoCheckoutSelection } = await jiti.import("../src/lib/rossko.ts");

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

const [integration, settingsRoute, form] = await Promise.all([
  readFile("src/lib/rossko-integration.ts", "utf8"),
  readFile("src/app/api/integrations/rossko/route.ts", "utf8"),
  readFile("src/app/cabinet/integrations/IntegrationsClient.tsx", "utf8"),
]);
assert.doesNotMatch(settingsRoute, /profile:\s*z\./);
assert.doesNotMatch(settingsRoute, /preferredStore:\s*z\./);
assert.doesNotMatch(form, />Профиль ROSSKO</);
assert.doesNotMatch(form, />Предпочитаемый склад</);
assert.match(integration, /"contactComment"/);
assert.match(integration, /"offerPriority"/);

console.log("ROSSKO API 2.1 checkout mapping and form contract — passed");
