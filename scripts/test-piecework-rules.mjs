import assert from "node:assert/strict";
import { resolve } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": resolve(process.cwd(), "src") } });
const {
  normalizeProductGroupName,
  resolveProductGroupPieceworkRule,
  resolveProductGroupTargetId,
} = await jiti.import("../src/lib/piecework-rules.ts");

const transmissionRule = {
  targetType: "product_group",
  targetId: "transmission-oil-cans",
  targetName: "Масло в канистрах трансмиссионное",
  role: "admin",
  mode: "percent",
  fixedCents: null,
  percentBasisPoints: 1000,
  isDefault: false,
};
const rules = new Map([["product_group:transmission-oil-cans:admin", transmissionRule]]);

for (const groupName of [
  "Масло в канистрах трансмиссионное",
  "Maслo в канистрах трансмиссионное",
  "Авто > Масло в канистрах трансмиссионное",
  "Масло в канистрах трансмиссионное\u200B",
]) {
  assert.equal(resolveProductGroupTargetId(groupName), "transmission-oil-cans");
  assert.deepEqual(resolveProductGroupPieceworkRule({ ruleMap: rules, groupPath: groupName, role: "admin" }), {
    targetId: "transmission-oil-cans",
    rule: transmissionRule,
  });
}

assert.equal(normalizeProductGroupName("Уплотнительныe кольца и прокладки"), "уплотнительные кольца и прокладки");
console.log("Piecework group matching checks passed.");
