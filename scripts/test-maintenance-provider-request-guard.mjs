import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createMaintenanceProviderRequestGuard as guard } from './lib/maintenance-provider-request-guard.mjs';
const vin = 'WDB2030451A000001', other = 'WVWZZZ1KZAW000001';
const url = (method = 'vindecode', v = vin) => `https://data.tronk.info/${method}.ashx?key=secret-test&vin=${v}`;
const events = [], calls = [];
let release;
const ready = new Promise(resolve => { release = resolve; });
const fetch = guard({ allowedVins: [vin], maxRequests: 2, appendEvent: async e => { events.push(e); if(e.state === 'started') await ready; }, fetchImpl: async (...args) => { calls.push(args); return {ok: false, status: 429}; } });
for (const [input, init] of [
  [url().replace('data.tronk.info', 'evil.test'), {}], [url().replace('https:', 'http:'), {}],
  [url().replace('.info/', '.info:444/'), {}], [url(), { method: 'POST' }],
  [url(), { redirect: 'follow' }], [url().replace('secret-test', ''), {}], [url('vindecode', other), {}],
  [url('number2vin'), {}], [url()+'&vin='+vin, {}], [url()+'&extra=1', {}],
]) await assert.rejects(fetch(input, init));
assert.equal(calls.length, 0);
assert.equal(events.length, 0, 'blocked requests consume no ledger or network');
const pending = fetch(url());
assert.equal(events[0].state, 'started');
assert.equal(calls.length, 0, 'durable started must precede network');
await assert.rejects(fetch(url()), /already attempted/);
release(); await pending;
assert.equal(events[1].state, 'error');
assert.equal(events[1].httpStatus, 429);
assert.equal(calls[0][1].redirect, 'error');
await assert.rejects(fetch(url()), /already attempted/);
await fetch(url('vindecode2'));
assert.equal(calls.length, 2);
assert.ok(!JSON.stringify(events).includes(vin));
assert.ok(!JSON.stringify(events).includes('secret-test'));
assert.ok(!JSON.stringify(events).includes('https:'));
assert.deepEqual(Object.keys(events[0]).sort(), ['providerMethod','state','vinHash']);
const hash = createHash('sha256').update(vin).digest('hex');
const replay = guard({ allowedVins: [vin], maxRequests: 2, previousEvents: [{vinHash: hash, providerMethod:'vindecode', state:'started'}], appendEvent: async () => {}, fetchImpl: async () => { throw new Error('network must not happen'); } });
await assert.rejects(replay(url()), /already attempted/);
const failedEvents = [];
const failed = guard({ allowedVins:[vin], maxRequests:1, appendEvent: async e => failedEvents.push(e), fetchImpl:async () => {throw new Error(url());} });
await assert.rejects(failed(url()), error => !error.message.includes('secret-test') && /attempt consumed/.test(error.message));
await assert.rejects(failed(url('vindecode2')), /budget exhausted/);
assert.deepEqual(failedEvents.map(e=>e.state), ['started','error']);
let sent = false;
const brokenLedger = guard({allowedVins:[vin],maxRequests:1,appendEvent:async()=>{throw Error('secret-test');},fetchImpl:async()=>{sent=true;}});
await assert.rejects(brokenLedger(url()), /request not sent/); assert.equal(sent,false);
const redirect = guard({allowedVins:[vin],maxRequests:1,appendEvent:async()=>{},fetchImpl:async()=>({ok:false,status:302})});
await assert.rejects(redirect(url()), /attempt consumed/);
console.log('PASS provider guard allowlist, durable reservation, replay, concurrency, budget, redirect and secret-free ledger');
