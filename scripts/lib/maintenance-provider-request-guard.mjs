import { createHash } from 'node:crypto';

const hashVin = vin => createHash('sha256').update(vin).digest('hex');
const validVin = vin => typeof vin === 'string' && /^[A-HJ-NPR-Z0-9]{17}$/.test(vin);
const methods = new Set(['vindecode', 'vindecode2']);

/** One-off CLI fetch gate. Persist the ledger externally; never retry a started request.
 * Accepts URL/string only, with exactly key and vin query parameters. Returned errors
 * deliberately discard provider/network messages, which can contain credentials.
 */
export function createMaintenanceProviderRequestGuard({ allowedVins, fetchImpl, maxRequests, previousEvents = [], appendEvent }) {
  if (!Array.isArray(allowedVins) || !allowedVins.length || !allowedVins.every(validVin)
    || typeof fetchImpl !== 'function' || typeof appendEvent !== 'function'
    || !Number.isSafeInteger(maxRequests) || maxRequests < 0 || !Array.isArray(previousEvents)) {
    throw new Error('Invalid provider guard configuration');
  }
  const allowed = new Set(allowedVins);
  const used = new Set();
  let spent = 0;
  for (const event of previousEvents) {
    if (!event || !/^[a-f0-9]{64}$/.test(event.vinHash) || !methods.has(event.providerMethod)
      || !['started', 'completed', 'error'].includes(event.state)) throw new Error('Invalid provider ledger');
    used.add(`${event.vinHash}:${event.providerMethod}`);
    if (event.state === 'started') spent++;
  }
  // Terminal-only old records still count against the budget; fail closed on incomplete history.
  spent = Math.max(spent, used.size);
  return async function guardedFetch(input, init = {}) {
    let url;
    try {
      if (!(typeof input === 'string' || input instanceof URL)) throw new Error();
      url = new URL(input);
    } catch { throw new Error('Provider request blocked'); }
    const method = url.pathname.match(/^\/(vindecode|vindecode2)\.ashx$/)?.[1];
    const names = [...url.searchParams.keys()];
    const vin = url.searchParams.get('vin');
    if (url.protocol !== 'https:' || url.hostname !== 'data.tronk.info' || url.port
      || url.username || url.password || url.hash || !method
      || (init.method ?? 'GET') !== 'GET' || init.body != null
      || (init.redirect !== undefined && init.redirect !== 'error')
      || names.length !== 2 || new Set(names).size !== 2 || !names.includes('key') || !names.includes('vin')
      || !url.searchParams.get('key')?.trim() || !allowed.has(vin)) throw new Error('Provider request blocked');
    const vinHash = hashVin(vin), identity = `${vinHash}:${method}`;
    if (used.has(identity) || spent >= maxRequests) throw new Error('Provider request already attempted or budget exhausted');
    // Synchronous reservation prevents concurrent callers racing while appendEvent awaits.
    used.add(identity); spent++;
    const event = state => ({ vinHash, providerMethod: method, state });
    try { await appendEvent(event('started')); }
    catch { throw new Error('Provider ledger persistence failed; request not sent'); }
    let response;
    try {
      response = await fetchImpl(url.toString(), { ...init, method: 'GET', redirect: 'error' });
      if (response.redirected || (response.status >= 300 && response.status < 400)) throw new Error();
    } catch {
      try { await appendEvent(event('error')); } catch { /* Started remains authoritative. */ }
      throw new Error('Provider request failed; attempt consumed');
    }
    try {
      await appendEvent({ ...event(response.ok ? 'completed' : 'error'), httpStatus: response.status });
    } catch { throw new Error('Provider ledger persistence failed; attempt consumed'); }
    return response;
  };
}
