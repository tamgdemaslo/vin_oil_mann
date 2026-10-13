import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source = fs.readFileSync('src/app/shipment/new/NewShipmentPageClient.tsx', 'utf8');
const start = source.indexOf('  const positionAssortmentKey =');
const end = source.indexOf('  useEffect(() => {\n    if (!authChecked || !nonstockProductOpen)', start);
assert.ok(start > 0 && end > start);
const compiled = ts.transpileModule(`function render(positions, selectedStore, authChecked) { ${source.slice(start, end)} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2020 },
}).outputText;
let slot = 0;
const effects = [];
const calls = [];
const context = vm.createContext({
  URLSearchParams, AbortController, Set,
  isNonstockProduct: p => p.nonstock,
  setStockByAssortment() {}, setCellByAssortment() {},
  safeJson: async () => ({}),
  fetch: async (url, options) => { calls.push({ url, signal: options.signal }); return {}; },
  useEffect(callback, deps) {
    const index = slot++;
    const old = effects[index];
    if (old && deps.every((value, i) => Object.is(value, old.deps[i]))) return;
    old?.cleanup?.();
    effects[index] = { deps, cleanup: callback() };
  },
});
vm.runInContext(compiled, context);
const render = (positions, store = { id: 'store-a', name: 'Main' }, auth = true) => {
  slot = 0; context.render(positions, store, auth);
};
const product = { assortmentMeta: { href: 'product-a' }, quantity: 1, price: 100 };
render([product], undefined, false);
assert.equal(calls.length, 0);
render([product]);
assert.equal(calls.length, 2);
for (let i = 0; i < 15; i++) render([{ ...product, quantity: i + 2, price: i * 100 }]);
assert.equal(calls.length, 2, 'Quantity/price edits must not reload stock and cells');
render([product, { ...product, quantity: 3 }]);
assert.equal(calls.length, 2, 'Duplicate product lines must share the same read');
render([product], { id: 'store-b', name: 'Other' });
assert.equal(calls.length, 3, 'Store change reloads stock only');
assert.equal(calls[0].signal.aborted, true);
render([product, { assortmentMeta: { href: 'product-b' } }], { id: 'store-b', name: 'Other' });
assert.equal(calls.length, 5, 'New product reloads stock and cells');
render([], { id: 'store-b', name: 'Other' });
assert.equal(calls[3].signal.aborted, true);
assert.equal(calls[4].signal.aborted, true);
console.log('Shipment stock/cell read lifecycle passed.');
