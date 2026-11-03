import assert from 'node:assert/strict';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url);
const { fetchTBank, tbankDispatcher } = await jiti.import('../src/lib/tbank-transport.ts');
const bank = tbankDispatcher('https://business.tbank.ru/openapi/api/v4/bank-accounts');
assert.ok(bank);
assert.equal(tbankDispatcher('https://business.tbank.ru/another-path'), bank);
assert.equal(tbankDispatcher('https://business.tbank.ru.attacker.example/path'), undefined);
assert.equal(tbankDispatcher('http://business.tbank.ru/path'), undefined);
assert.equal(tbankDispatcher('https://business.tbank.ru:8443/path'), undefined);
assert.equal(tbankDispatcher('https://example.com/path'), undefined);
const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.redirect, 'error', 'bank credentials cannot follow an HTTP redirect');
    assert.equal(options.dispatcher, bank);
    return { status: 401 };
  };
  assert.equal((await fetchTBank('https://business.tbank.ru/openapi/api/v4/bank-accounts')).status, 401);
} finally { globalThis.fetch = originalFetch; await bank.close(); }
console.log('T-Bank transport: trusted CA integrity, exact HTTPS origins, port isolation and redirect protection passed');
