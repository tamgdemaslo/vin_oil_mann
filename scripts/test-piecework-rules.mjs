import assert from "node:assert/strict";
import { resolve } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": resolve(process.cwd(), "src") } });
const { resolvePieceworkRule } = await jiti.import("../src/lib/piecework-rules.ts");

const productGroupId = "grp_4bd78d2bd445d3ed73b8f66066a02633";
const serviceId = "svc_change_engine_oil_9f1d";
const adminRule = {
  targetType: "product_group",
  targetId: productGroupId,
  targetName: "Масло в канистрах трансмиссионное",
  role: "admin",
  mode: "percent",
  fixedCents: null,
  percentBasisPoints: 1000,
  isConfigured: true,
  isDefault: false,
};
const masterRule = {
  targetType: "service",
  targetId: serviceId,
  targetName: "Замена моторного масла",
  role: "master",
  mode: "fixed",
  fixedCents: 150_000,
  percentBasisPoints: null,
  isConfigured: true,
  isDefault: false,
};
const rules = new Map([
  [`product_group:${productGroupId}:admin`, adminRule],
  [`service:${serviceId}:master`, masterRule],
]);

assert.equal(
  resolvePieceworkRule({ ruleMap: rules, targetId: productGroupId, targetType: "product_group", role: "admin" }),
  adminRule
);
assert.equal(
  resolvePieceworkRule({ ruleMap: rules, targetId: serviceId, targetType: "service", role: "master" }),
  masterRule
);
assert.equal(
  resolvePieceworkRule({ ruleMap: rules, targetId: "svc_same_caption_but_other_id", targetType: "service", role: "master" }),
  undefined
);
assert.equal(
  resolvePieceworkRule({ ruleMap: rules, targetId: productGroupId, targetType: "product_group", role: "master" }),
  undefined
);

console.log("Piecework service and product-group ID checks passed.");
