import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source = fs.readFileSync('src/lib/tbank.ts', 'utf8').split('// Read-only statement:')[1].split('\n').slice(1).join('\n');
let calls = 0;
let usedConnection = '';
let payload = { saldoIn: 100, saldoOut: 174.75, income: 100, outcome: 25.25, operation: [
  { operationId: 'in', date: '2026-11-01', amount: 100, recipientAccount: '1'.repeat(20), payerName: 'Клиент' },
  { operationId: 'out', date: '2026-11-02', amount: 25.25, payerAccount: '1'.repeat(20), recipient: 'Поставщик' },
] };
const context = { exports: {}, ensureFinanceStatusAccess: user => user.role !== 'owner',
  getMessengerOrganizationId: () => 'org',
  hashSecret: value => 'hash:' + value,
  bankOperationCategoryData: async () => ({ categories: [], assignments: new Map() }),
  getIntegration: async (_org, connectionId) => { if (connectionId === 'foreign') return null; return ({ id: connectionId || 'first', tokenEncrypted: 'encrypted', accounts: [{ id: 'own', isDefault: true, accountNumberEncrypted: 'encrypted', currency: 'RUB' }] }); },
  decryptText: () => '1'.repeat(20), callTBankJson: async (_integration, path) => { calls++; usedConnection = _integration.id; assert.match(path, /from=2026-11-01&till=2026-11-03/); return { body: payload }; },
  asRecord: value => value ?? {}, cleanText: value => String(value ?? '').trim(), maskAccount: () => '**** 1111',
  URLSearchParams, TBankApiError: class extends Error {}, tbankPublicError: () => 'Bank error',
};
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
const get = context.exports.getTBankStatement;
const input = { dateFrom: '2026-11-01', dateTo: '2026-11-03' };
const result = await get(input, { role: 'owner' });
assert.equal(result.ok, true);
assert.equal(result.statement.operations[0].direction, 'expense');
assert.equal(result.statement.operations[0].amountCents, 2525);
assert.equal(result.statement.operations[1].direction, 'income');
assert.equal(result.statement.closingCents, 17475);
assert.equal((await get(input, { role: 'mechanic' })).status, 403);
assert.equal((await get({ ...input, accountId: 'other-branch' }, { role: 'owner' })).status, 404);
assert.equal((await get({ ...input, dateFrom: '2026-02-30' }, { role: 'owner' })).status, 400);
assert.equal((await get({ ...input, connectionId: 'foreign' }, { role: 'owner' })).status, 409);
assert.equal(calls, 1);
assert.equal((await get({ ...input, connectionId: 'second' }, { role: 'owner' })).ok, true);
assert.equal(usedConnection, 'second');
payload = { ...payload, operation: [{ amount: 12, payerAccount: 'foreign', recipientAccount: 'foreign' }] };
assert.equal((await get(input, { role: 'owner' })).ok, false);
payload = { ...payload, operation: null };
assert.equal((await get(input, { role: 'owner' })).ok, false);
console.log('T-Bank statement: amounts, direction, access, account isolation, dates and invalid responses passed');
