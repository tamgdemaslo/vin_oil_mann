import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync('src/app/warehouse/inventory/WarehouseInventoryClient.tsx', 'utf8');
const start = source.indexOf('  async function mutateSession(');
const end = source.indexOf('  function cancelCurrentSession(', start);
const code = ts.transpileModule(`${source.slice(start, end)}\nexports.run = mutateSession;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;
async function exercise({ drafts, saved = {}, fail = false, active = [] }) {
  const calls = [];
  const messages = [];
  const exports = {};
  vm.runInNewContext(code, {
    Error, exports, current: { id: 'session' }, working: false, isDetail: true,
    lines: [], inputValues: drafts, persistedCountValues: { current: { ...saved } },
    activeCountSaves: { current: new Set(active) },
    setWorking() {}, setMessage(value) { messages.push(value); },
    setLines() {}, setSaveState() {}, setCurrent() {},
    async loadReconciliation() {},
    async requestJson(url, options) {
      calls.push({ url, body: JSON.parse(options.body) });
      if (url.endsWith('/count')) {
        if (fail) throw new Error('Сохранение не удалось');
        return { line: { id: url.split('/').at(-2), finalQuantity: Number(JSON.parse(options.body).quantity.replace(',', '.')) } };
      }
      return {};
    },
  });
  await exports.run('complete-counting');
  return { calls, messages };
}
let result = await exercise({ drafts: { a: '12', b: '2,5', 'comment:a': 'Полка' }, saved: { a: 1, b: 1 } });
assert.deepEqual(result.calls.map(({ body }) => body.quantity), ['12', '2,5', undefined]);
assert.equal(result.calls.at(-1).url, '/api/inventory/sessions/session/complete-counting');
assert.equal(result.calls[0].body.comment, 'Полка');
result = await exercise({ drafts: { a: '0', b: '1' }, saved: { a: 1, b: 1 } });
assert.equal(result.calls.length, 2);
assert.equal(result.calls[0].body.confirmZero, true);
result = await exercise({ drafts: { hidden: '7' } });
assert.equal(result.calls[0].body.quantity, '7');
for (const value of ['', '-1', 'oops']) {
  result = await exercise({ drafts: { a: '12', b: value }, saved: { a: 1, b: 1 } });
  assert.equal(result.calls.length, 0);
  assert.match(result.messages.at(-1), /корректное/);
}
result = await exercise({ drafts: { a: '12' }, saved: { a: 1 }, fail: true });
assert.equal(result.calls.length, 1);
assert.match(result.messages.at(-1), /Сохранение не удалось/);
let release;
const pending = new Promise((resolve) => { release = resolve; });
let finished = false;
const run = exercise({ drafts: { a: '12' }, saved: { a: 1 }, active: [pending] }).then((value) => { finished = true; return value; });
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(finished, false);
release();
result = await run;
assert.equal(result.calls.at(-1).url.endsWith('/complete-counting'), true);
console.log('Inventory completion: quantities, decimals, zero, filtered drafts, validation, failure and pending saves passed.');

const saveStart = source.indexOf('  async function saveCount(');
const saveEnd = source.indexOf('  async function saveResolution(', saveStart);
const saveCode = ts.transpileModule(`${source.slice(saveStart, saveEnd)}\nexports.save = saveCount;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;
function mountSave() {
  const calls = [];
  const persisted = { current: { a: 1 } };
  const active = { current: new Set() };
  const exports = {};
  let rejectNext = false;
  vm.runInNewContext(saveCode, {
    Error, exports, current: { id: 'session' }, working: false,
    inputValues: { a: '1' }, persistedCountValues: persisted,
    activeCountSaves: active, countSaveByLine: { current: new Map() },
    setSaveState() {}, setMessage() {}, setLines() {}, window: { setTimeout() {} },
    async requestJson(url, options) {
      const body = JSON.parse(options.body);
      calls.push(body);
      if (rejectNext) { rejectNext = false; throw new Error('Offline'); }
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { line: { id: 'a', finalQuantity: body.confirmZero ? 0 : Number(body.quantity) } };
    },
  });
  return { save: exports.save, calls, persisted, active, failNext() { rejectNext = true; } };
}
const line = { id: 'a', finalQuantity: 1 };
let mounted = mountSave();
// A blur must save the event's value, even if the state snapshot is still 1.
await mounted.save(line, false, 'MANUAL', '4');
assert.equal(mounted.persisted.current.a, 4);
assert.equal(mounted.calls[0].quantity, '4');
await mounted.save(line, false, 'MANUAL', '4');
assert.equal(mounted.calls.length, 1, 'Blur + Save must not add a duplicate recount');
mounted = mountSave();
const first = mounted.save(line, false, 'MANUAL', '4');
const second = mounted.save(line, false, 'MANUAL', '5');
assert.equal(mounted.active.current.size, 2);
await Promise.all([first, second]);
assert.deepEqual(mounted.calls.map((body) => body.quantity), ['4', '5']);
assert.equal(mounted.persisted.current.a, 5);
assert.equal(mounted.active.current.size, 0);
mounted = mountSave();
mounted.failNext();
await mounted.save(line, false, 'MANUAL', '4');
assert.equal(mounted.persisted.current.a, 1);
await mounted.save(line, false, 'MANUAL', '4');
assert.equal(mounted.persisted.current.a, 4);
assert.equal(mounted.calls.length, 2);
assert.match(source, /onBlur=.*saveCount.*event.currentTarget.value/);
console.log('Inventory autosave: explicit blur value, duplicate protection, serialized edits and retry passed.');

const rowStart = source.indexOf('const InventoryCountRow = memo(');
const rowEnd = source.indexOf('function actionOptionsForLine(', rowStart);
const rowCode = ts.transpileModule(`${source.slice(rowStart, rowEnd)}\nexports.Row = InventoryCountRow;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
function exerciseRow(value, finalQuantity, extra = {}) {
  const effects = [], timers = [], calls = [], exports = {};
  const component = (type, props) => ({ type, props });
  vm.runInNewContext(rowCode, {
    exports, memo: (value) => value, useRef: (current) => ({ current }),
    useEffect: (effect) => effects.push(effect),
    window: { setTimeout: (callback) => { timers.push(callback); return timers.length; }, clearTimeout() {} },
    require: () => ({ jsx: component, jsxs: component }),
    EcoInput: 'input', EcoButton: 'button', EcoBadge: 'badge',
    CheckCircle2: 'icon', Trash2: 'icon', LINE_STATUS_LABELS: {},
    statusTone: () => 'neutral', qty: String, money: String,
  });
  const tree = exports.Row({
    line: { id: 'a', finalQuantity, comment: null, name: 'Oil', status: 'COUNTED' },
    index: 0, inputValue: value, commentValue: '', saveStatus: 'idle',
    highlighted: false, showAccounting: false, paused: false, working: false,
    setInputValues() {}, saveCount: (...args) => { calls.push(args); return Promise.resolve(); }, removeLine() {}, ...extra,
  });
  for (const effect of effects) effect();
  for (const timer of timers) timer();
  const buttons = [];
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(visit);
    if (node.type === 'button') buttons.push(node.props.children);
    visit(node.props?.children);
  }
  visit(tree);
  return { calls, buttons };
}
let row = exerciseRow('4', 1);
assert.equal(row.calls.length, 1);
assert.equal(row.calls[0][3], '4');
assert.equal(row.buttons.length, 1, 'Only Remove should remain');
row = exerciseRow('0', 1);
assert.equal(row.calls[0][1], true);
assert.equal(exerciseRow('1', 1).calls.length, 0);
assert.equal(exerciseRow('', 1).calls.length, 0);
assert.equal(exerciseRow('4', 1, { paused: true }).calls.length, 0);
assert.equal(exerciseRow('4', 1, { working: true }).calls.length, 0);
console.log('Count row: automatic input saving, explicit zero, unchanged/empty drafts and only Remove passed.');

const serverSource = fs.readFileSync('src/lib/warehouse-inventory.ts', 'utf8');
const serverStart = serverSource.indexOf('export async function countInventoryLine(');
const serverEnd = serverSource.indexOf('function readImportRows(', serverStart);
const serverCode = ts.transpileModule(serverSource.slice(serverStart, serverEnd), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;
async function exerciseManualCount(source) {
  const exports = {}, updates = [];
  const decimal = (number) => ({ toNumber: () => number, plus: () => decimal(number) });
  const tx = {
    inventorySession: {
      async findUnique() { return { id: 'session', status: 'COUNTING', warehouseMode: 'LOCKED' }; },
      async update(value) { updates.push(value.data); },
    },
    inventoryLine: {
      async findFirst() { return { id: 'a', status: 'NOT_COUNTED', snapshotQuantity: decimal(4), firstCountQuantity: null }; },
      async update(value) { updates.push(value.data); return value.data; },
    },
    inventoryCountEntry: { async count() { return 0; }, async create() {} },
  };
  vm.runInNewContext(serverCode, {
    exports, ZERO: decimal(0), decimalFromInput: decimal, COUNTABLE_STATUSES: ['COUNTING'],
    prisma: { $transaction: (callback) => callback(tx) },
    countOutcome: () => ({ difference: decimal(-3), cost: 0, status: 'RECOUNT_REQUIRED', proposedAction: 'SHORTAGE_EXPENSE', requiresRecount: true }),
    cleanText: (value) => value ?? null, mapLine: (value) => value,
    async recalculateSessionSummary() {}, async writeAudit() {},
  });
  const result = await exports.countInventoryLine('session', 'a', { quantity: 1, source }, { login: 'tester' });
  return { result, updates };
}
for (const source of ['MANUAL', undefined]) {
  const { result, updates } = await exerciseManualCount(source);
  assert.equal(result.ok, true);
  assert.equal(updates[0].requiresRecount, false, 'Manual count must not require a hidden recount button');
  assert.equal(updates[0].status, 'COUNTED');
  assert.equal(updates[1].status, 'COUNTING');
}
console.log('Manual count: saves discrepancies without a mandatory second count passed.');
mounted = mountSave();
await mounted.save({ ...line, requiresRecount: true }, false, 'MANUAL', '1');
assert.equal(mounted.calls.length, 1, 'Legacy recount must be confirmed even when quantity is unchanged');
row = exerciseRow('1', 1, { line: { ...line, comment: null, name: 'Oil', status: 'RECOUNT_REQUIRED', requiresRecount: true } });
assert.equal(row.calls.length, 1, 'Legacy recount must not need a removed button');
console.log('Legacy recount: unchanged quantities can be confirmed automatically passed.');
