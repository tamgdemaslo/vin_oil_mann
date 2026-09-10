const state = () => globalThis.__tgmReplay;
const equal = (actual, query) => {
  if (query === undefined) return true;
  if (query === null || typeof query !== 'object' || query instanceof Date) return actual === query;
  if ('in' in query && !query.in.includes(actual)) return false;
  if ('equals' in query && String(actual).toLowerCase() !== String(query.equals).toLowerCase()) return false;
  if ('contains' in query && !String(actual ?? '').toLowerCase().includes(String(query.contains).toLowerCase())) return false;
  if ('startsWith' in query && !String(actual ?? '').startsWith(query.startsWith)) return false;
  if ('lt' in query && !(actual < query.lt)) return false;
  if ('lte' in query && !(actual <= query.lte)) return false;
  if ('gte' in query && !(actual >= query.gte)) return false;
  return true;
};
const matches = (row, where = {}) => Object.entries(where).every(([key, query]) => key === 'OR' ? query.some(q => matches(row, q)) : key === 'AND' ? (Array.isArray(query) ? query : [query]).every(q => matches(row, q)) : equal(row[key], query));
const table = name => new Proxy({}, { get(_, method) { return async (args = {}) => {
  const s = state(); s.dbCalls.push({ name, method, args });
  if (!s.tables[name]) s.tables[name] = [];
  const rows = s.tables[name];
  let found = rows.filter(row => matches(row, args.where));
  const orders = args.orderBy ? (Array.isArray(args.orderBy) ? args.orderBy : [args.orderBy]).flatMap(Object.entries) : [];
  if (orders.length) found = [...found].sort((a,b) => {
    for (const [key, direction] of orders) {
      const difference = a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0;
      if (difference) return difference * (direction === 'desc' ? -1 : 1);
    }
    return 0;
  });
  if (args.take) found = found.slice(0, args.take);
  if (method === 'findMany') return found;
  if (method === 'findFirst' || method === 'findUnique') return found[0] ?? null;
  if (method === 'count') return found.length;
  if (method === 'create') { const row = { id: `fixture-${++s.ids}`, createdAt: new Date(), startedAt: new Date(), cancelledAt: null, ...args.data }; rows.push(row); return row; }
  if (method === 'createMany') { rows.push(...args.data); return { count: args.data.length }; }
  if (method === 'update') { if (!found[0]) throw new Error(`Missing fixture ${name}`); Object.assign(found[0], args.data); return found[0]; }
  if (method === 'updateMany') { found.forEach(row => Object.assign(row,args.data)); return { count: found.length }; }
  throw new Error(`Unexpected DB operation ${name}.${String(method)}`);
}; }});
export const prisma = new Proxy({}, { get(_, name) { if (name === '$transaction') return async fn => fn(prisma); if (name === '$queryRaw') return async () => []; return table(name); } });
