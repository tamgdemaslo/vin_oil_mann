import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Exercise the actual input handlers and React state across rerenders.
const source = fs.readFileSync('src/components/MoneyInput.tsx', 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
function mount(initialValue, extra = {}) {
  const states = [];
  let cursor = 0;
  let value = initialValue;
  const changes = [];
  const exports = {};
  vm.runInNewContext(code, { exports, require: (name) => {
    if (name === 'react') return { useState(initial) {
      const index = cursor++;
      if (!(index in states)) states[index] = initial;
      return [states[index], (next) => { states[index] = next; }];
    } };
    if (name === 'react/jsx-runtime') return { jsx: (_, props) => props };
    throw new Error(name);
  } });
  const render = () => { cursor = 0; return exports.default({ value, onValueChange: (next, draft) => { value = next; changes.push(draft); }, ...extra }); };
  return { render, changes, value: () => value, exports };
}
for (const options of [{}, { fractionDigits: 3, minimumFractionDigits: 0 }]) {
  const input = mount(0, options);
  let selected = false;
  input.render().onFocus({ currentTarget: { select() { selected = true; } } });
  assert.equal(selected, true);
  assert.equal(input.render().value, '');
  for (const draft of ['2', '2,', '2,5', '', '7.25']) {
    input.render().onChange({ target: { value: draft } });
    assert.equal(input.render().value, draft.replace('.', ','));
  }
  assert.equal(input.value(), 7.25);
  input.render().onBlur({});
  assert.equal(input.render().value, '7,25');
}
const quantity = mount(208, { fractionDigits: 3, minimumFractionDigits: 0 });
quantity.render().onFocus({ currentTarget: { select() {} } });
quantity.render().onChange({ target: { value: '' } });
assert.equal(quantity.render().value, '');
quantity.render().onChange({ target: { value: '0,125' } });
assert.equal(quantity.value(), 0.125);
quantity.render().onBlur({});
assert.equal(quantity.render().value, '0,125');
assert.equal(quantity.exports.sanitizeMoneyInput('00025,125', 3), '25,125');
console.log('Numeric input: clearing zero, replacement, comma/dot, fractional drafts and precision passed.');
