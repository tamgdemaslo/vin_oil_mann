export const getScopedBranchId = () => 'test-branch';
const state = () => globalThis.vehicleKnowledgeTest;
export const prisma = {
 vehicleLookupCache: {
  findFirst: async ({where}) => {
   state().where = where;
   return [...state().rows].reverse().find(row => row.organizationId === where.organizationId && row.inputType === where.inputType && row.normalizedInputHash === where.normalizedInputHash && row.method === where.method && row.status === where.status && (!where.expiresAt || row.expiresAt > where.expiresAt.gt));
  },
  create: async ({data}) => { if (state().failWrite) throw new Error("storage failed"); const row = {...data, id: String(state().rows.length + 1)}; state().rows.push(row); return row; },
  updateMany: async () => ({count: 1}),
 },
 $queryRaw: async (sql) => {state().sql = sql.join('?'); return [{payload: state().payload}];},
 $executeRaw: async (sql, ...values) => {if (state().failWrite) throw new Error("storage failed"); state().writeValues = values; return 1;},
};
const decode = async method => {state().paid++; return {ok:true, method, data:{result:{Make:'FORD',Model:'Mondeo',Year:'2018',Engine:'ABC',EngineVolume:'1999',Fuel:'Petrol',Transmission:'Automatic'}}, durationMs:0};};
export const tronkClient = {decodeVinPrimary: () => decode('vindecode'), decodeVinExtended: () => decode('vindecode2')};
