import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const compiled = ts.transpileModule(fs.readFileSync("src/app/shipment/ShipmentListWorkspace.tsx", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
}).outputText;
let refreshCount = 0;
const router = { refresh() { refreshCount += 1; } };
const listeners = new Map();
const eventTarget = {
  addEventListener(name, listener) { listeners.set(name, listener); },
  removeEventListener(name, listener) { if (listeners.get(name) === listener) listeners.delete(name); },
};
const document = { ...eventTarget, visibilityState: "visible" };
const effects = [];
const react = {
  useRef: value => ({ current: value }),
  useState: value => [typeof value === "function" ? value() : value, () => {}],
  useMemo: callback => callback(),
  useEffect: callback => effects.push(callback),
};
const exports = {};
vm.runInNewContext(compiled, {
  exports, document, window: eventTarget,
  require(name) {
    if (name === "react") return react;
    if (name === "next/navigation") return { useRouter: () => router };
    if (name === "react/jsx-runtime") return { jsx: () => null, jsxs: () => null };
    return {};
  },
});
for (let mount = 0; mount < 6; mount += 1) {
  effects.length = 0;
  exports.ShipmentListWorkspace({ rows: [], totalCount: 0, totalSumLabel: "0", emptyMessage: "" });
  const cleanups = effects.map(callback => callback());
  assert.equal(refreshCount, 0, "Opening/remounting the journal must not request another navigation");
  if (mount < 5) cleanups.forEach(cleanup => cleanup?.());
}
listeners.get("pageshow")({ persisted: false });
assert.equal(refreshCount, 0, "A normal page load must not refresh");
listeners.get("pageshow")({ persisted: true });
assert.equal(refreshCount, 1, "Returning from browser cache must refresh stale rows once");
document.visibilityState = "hidden";
listeners.get("visibilitychange")();
assert.equal(refreshCount, 1);
document.visibilityState = "visible";
listeners.get("visibilitychange")();
assert.equal(refreshCount, 2, "Returning to a tab must still refresh its journal");
console.log("Shipment journal navigation lifecycle regression passed.");
