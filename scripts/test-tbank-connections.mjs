import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import crypto from 'node:crypto';
const source = fs.readFileSync('src/lib/tbank.ts', 'utf8');
const ast = ts.createSourceFile('tbank.ts', source, ts.ScriptTarget.Latest, true);
const names = new Set(['getIntegration', 'listTBankConnections', 'getTBankIntegrationStatus', 'saveTBankIntegrationSettings']);
const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name?.text)).map(node => node.getText(ast)).join('\n');
let branch = 'branch-a';
const rows = [];
const matches = (row, where) => Object.entries(where).every(([key, value]) => row[key] === value);
const context = {
  exports: {}, crypto,
  prisma: { tBankIntegration: {
    findFirst: async ({ where }) => rows.find(row => matches(row, where)) ?? null,
    findMany: async ({ where }) => rows.filter(row => matches(row, where)),
    upsert: async ({ where, create, update }) => {
      const key = where.branchId_organizationId_connectionKey;
      const old = rows.find(row => matches(row, key));
      if (old) { Object.assign(old, update); return old; }
      const row = { ...key, ...create, id: crypto.randomUUID(), accounts: [] };
      rows.push(row); return row;
    },
  } },
  getScopedBranchId: () => branch, getMessengerOrganizationId: () => 'org',
  mapIntegrationStatus: row => ({ id: row?.id ?? '', name: row?.name ?? '', accounts: row?.accounts ?? [] }),
  ensureOwner: user => user.role === 'owner' ? null : 'denied', organizationId: () => 'org',
  cleanText: value => String(value ?? '').trim(), cleanDigits: value => String(value ?? '').replace(/\D/g, ''),
  centsFromRub: () => null, toJson: value => value, parseAllowedInns: () => [], defaultWebhookUrl: () => '',
  encryptText: token => `encrypted:${token}`, tokenPreview: () => 'configured', auditTBank: async () => {},
};
vm.runInNewContext(ts.transpileModule(functions + '\nexports.lookup = getIntegration;', { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
const { saveTBankIntegrationSettings: save, getTBankIntegrationStatus: status, lookup } = context.exports;
const owner = { role: 'owner', login: 'owner' };
assert.equal((await save({ name: 'First', token: 'first-token' }, owner)).ok, true);
const first = rows[0];
assert.equal((await save({ createNew: true, name: 'Second', token: 'second-token' }, owner)).ok, true);
const second = rows[1];
assert.notEqual(first.connectionKey, second.connectionKey);
assert.equal(first.tokenEncrypted, 'encrypted:first-token');
assert.equal(second.tokenEncrypted, 'encrypted:second-token');
assert.equal((await status(second.id)).id, second.id);
assert.equal((await status()).connections.length, 2);
await save({ connectionId: second.id, name: 'Renamed', token: '' }, owner);
assert.equal(second.name, 'Renamed');
assert.equal(second.tokenEncrypted, 'encrypted:second-token');
assert.equal(first.name, 'First');
assert.equal((await save({ createNew: true, name: 'Missing token' }, owner)).status, 400);
assert.equal((await save({ createNew: true, name: 'Third', token: 'x' }, { role: 'admin' })).status, 403);
branch = 'branch-b';
assert.equal(await lookup('org', second.id), null);
assert.equal((await status()).connections.length, 0);
assert.equal((await save({ connectionId: second.id, token: 'overwrite' }, owner)).status, 404);
assert.equal(second.tokenEncrypted, 'encrypted:second-token');
console.log('T-Bank connections: separate encrypted tokens, edit isolation, blank token preservation, permissions and branch isolation passed');
