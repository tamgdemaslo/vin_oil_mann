import assert from "node:assert/strict";
import { resolve } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": resolve(process.cwd(), "src") } });
const { resolveGroupPieceworkRule } = await jiti.import("../src/lib/piecework-rules.ts");

const groupId = "grp_4bd78d2bd445d3ed73b8f66066a02633";
const rule = {
  targetType: "product_group",
  targetId: groupId,
  targetName: "Масло в канистрах трансмиссионное",
  role: "admin",
  mode: "percent",
  fixedCents: null,
  percentBasisPoints: 1000,
  isConfigured: true,
  isDefault: false,
};
const rules = new Map([["product_group:grp_4bd78d2bd445d3ed73b8f66066a02633:admin", rule]]);

assert.equal(
  resolveGroupPieceworkRule({ ruleMap: rules, groupId, targetType: "product_group", role: "admin" }),
  rule
);
assert.equal(
  resolveGroupPieceworkRule({
    ruleMap: rules,
    groupId: "grp_different_group_with_same_caption",
    targetType: "product_group",
    role: "admin",
  }),
  undefined
);
assert.equal(
  resolveGroupPieceworkRule({ ruleMap: rules, groupId, targetType: "service_group", role: "master" }),
  undefined
);

console.log("Piecework group ID checks passed.");
