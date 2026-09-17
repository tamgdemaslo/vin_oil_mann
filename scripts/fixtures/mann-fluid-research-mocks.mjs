export const prisma = {
  mannFilterApplication: {
    findMany: async ({where}) => globalThis.fluidResearchTest.applications.filter(row => where.vehicleVariantKey.in.includes(row.vehicleVariantKey)),
  },
  $transaction: async fn => fn(prisma),
  $queryRaw: async () => { throw new Error("Failed to deserialize column of type 'void'"); },
  $executeRaw: async (sql, ...values) => {
    globalThis.fluidResearchTest.lock = {sql: sql.join('?'), values};
    return 1;
  },
  aIAgentTechnicalEvidence: {
    findFirst: async ({where}) => [...globalThis.fluidResearchTest.rows].reverse().find(r=>r.organizationId===where.organizationId&&r.vehicleKey===where.vehicleKey&&r.aggregate===where.aggregate&&r.validUntil>where.validUntil.gt),
    count: async () => globalThis.fluidResearchTest.limit ? 20 : 0,
    create: async ({data}) => {const row={...data,id:String(globalThis.fluidResearchTest.rows.length+1)};globalThis.fluidResearchTest.rows.push(row);return row;},
    update: async ({where,data}) => Object.assign(globalThis.fluidResearchTest.rows.find(r=>r.id===where.id),data),
  },
};
export async function assertOpenAIConnection(){if(globalThis.fluidResearchTest.networkFail)throw Error('private network diagnostic');return {ok:true};}
export function createOpenAIClient(){return {responses:{create:async request=>{const s=globalThis.fluidResearchTest;s.calls++;s.request=request;if(s.fail)throw Error('private provider error');return {id:'test-response',output_text:JSON.stringify(s.payload),output:[{type:'web_search_call',action:{sources:[{url:'https://example.com/manual'}]}}]};}}};}
