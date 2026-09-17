import assert from "node:assert/strict";
import { resolve } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, alias: { "@": resolve(process.cwd(), "src") } });
const { getClientOilOemApprovals, inferClientOilType } = await jiti.import("../src/lib/client-oil-metadata.ts");

assert.equal(inferClientOilType({ apiSpec: "SP" }), "Бензин");
assert.equal(inferClientOilType({ apiSpec: "SN/CF" }), "Бензин · Дизель");
assert.equal(inferClientOilType({ acea: "A3/B4" }), "Бензин · Дизель");
assert.equal(inferClientOilType({ acea: "C3" }), "Бензин · Дизель · DPF");
assert.equal(inferClientOilType({ apiSpec: "CK-4" }), "Дизель");
assert.equal(inferClientOilType({ name: "Low SAPS DPF", acea: "C3" }), "Бензин · Дизель · DPF");
assert.deepEqual(
  getClientOilOemApprovals({ oem: "BMW Longlife-04; MB 229.51; VW 504.00" }),
  ["BMW Longlife-04", "MB 229.51", "VW 504.00"]
);

console.log("client oil metadata: ok");
