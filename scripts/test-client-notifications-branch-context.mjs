#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AsyncLocalStorage } from 'node:async_hooks';
import vm from 'node:vm';
import ts from 'typescript';

function load(file, imports) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, require: (id) => {
    assert.ok(id in imports, `Unexpected import: ${id}`);
    return imports[id];
  } });
  return exports;
}
const tenant = load('src/lib/request-tenant-store.ts', { 'node:async_hooks': { AsyncLocalStorage } });
const sql = load('src/lib/branch-sql-context.ts', { '@/lib/request-tenant-store': tenant });
const requestScope = new AsyncLocalStorage();
const json = (body, options = {}) => ({ body, status: options.status ?? 200 });
const branchApi = load('src/lib/branch-api.ts', {
  'next/server': { NextResponse: { json } },
  '@/lib/request-tenant-store': tenant,
  '@/lib/branch-context': {
    requireBranchContext: async (options) => {
      assert.equal(options.allowAll, false);
      assert.equal(options.requireActive, true);
      await Promise.resolve();
      const { branchId, denied } = requestScope.getStore();
      if (denied) throw new Error('Choose an active branch');
      return { mode: 'branch', branchId, organizationId: 'org', businessGroupId: 'group',
        userId: 'owner', groupRole: 'owner', branches: [{ id: branchId }] };
    },
    branchErrorResponse: (error) => ({ error: error.message, code: 'BRANCH_REQUIRED', status: 409 }),
  },
});
const calls = [];
const serviceNames = ['createReminderRule', 'deleteNotificationRule', 'listClientNotificationSettings',
  'previewNotificationTemplate', 'processDueClientNotificationJobs', 'retryNotificationJob',
  'sendTestNotification', 'updateClientNotificationSettings', 'updateNotificationRule', 'updateNotificationTemplate'];
const services = Object.fromEntries(serviceNames.map(name => [name, async () => {
  const before = sql.requireSingleBranchSqlContext().branchId;
  await new Promise(resolve => setImmediate(resolve));
  const after = sql.requireSingleBranchSqlContext().branchId;
  assert.equal(before, requestScope.getStore().branchId);
  assert.equal(after, before);
  calls.push({ name, branchId: after });
  return [];
}]));
const routes = load('src/app/api/client-notifications/route.ts', {
  'next/server': { NextResponse: { json } },
  '@/lib/auth': { getSession: async () => {
    await Promise.resolve();
    const role = requestScope.getStore().role;
    return role ? { user: { role } } : null;
  } },
  '@/lib/branch-api': branchApi,
  '@/lib/client-notifications/client-notifications': services,
});
const cases = [ ['GET', {}], ...['rule', 'template', 'settings'].map(kind => ['PATCH', { kind }]),
  ...['create-reminder', 'delete-rule', 'preview', 'test', 'process', 'retry'].map(action => ['POST', { action }]) ];
await Promise.all(['branch-a', 'branch-b'].flatMap(branchId => cases.map(([method, body]) =>
  requestScope.run({ branchId, role: 'owner' }, async () => {
    const response = await routes[method]({ json: async () => ({ ...body, branchId: 'untrusted-branch' }) });
    assert.equal(response.status, 200);
  }))));
assert.equal(calls.length, 20);
assert.equal(new Set(calls.map(call => call.name)).size, 10);
assert.equal(tenant.getRequestTenant(), null);
for (const [method, body] of cases) {
  for (const [scope, expected] of [ [{ role: null }, 401], [{ role: 'employee' }, 403],
    [{ role: 'owner', denied: true }, 409] ]) {
    const response = await requestScope.run(scope, () => routes[method]({ json: async () => body }));
    assert.equal(response.status, expected);
  }
}
assert.equal(calls.length, 20, 'Denied requests must never reach notification services');
console.log('Client notification routes: async branch scope, concurrent isolation and access guards passed');
