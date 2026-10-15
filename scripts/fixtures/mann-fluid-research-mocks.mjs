function catalogUpsert(name) {
 return async ({where,create}) => {
  const s=globalThis.fluidResearchTest;
  if(s.failCatalog && name==='links') throw new Error('catalog storage failed');
  const rows=s[name]??=[];
  let row=rows.find(row=>where.id ? row.id===where.id : row.requirementId===where.requirementId_mannVariantKey.requirementId&&row.mannVariantKey===where.requirementId_mannVariantKey.mannVariantKey);
  if(!row){row=create;rows.push(row);}
  return row;
 };
}
export async function requireBranchApi(){return {ok:true,context:{organizationId:"org1"}};}
export async function runWithBranchApiContext(_context,fn){return fn();}
export const prisma = {
  mannTechnicalAssociationRevision: {findMany:async()=>[]},
  mannFilterApplication: {
    findMany: async ({where}) => globalThis.fluidResearchTest.applications.filter(row => where.vehicleVariantKey.in.includes(row.vehicleVariantKey)),
  },
  fluidSourceRow: {upsert:catalogUpsert('sources')},
  vehicleFluidRequirement: {upsert:catalogUpsert('requirements')},
  mannFluidRequirementLink: {upsert:catalogUpsert('links'),findMany:async ({where})=>{
    const s=globalThis.fluidResearchTest;
    return (s.links??[]).filter(row=>where.mannVariantKey.in.includes(row.mannVariantKey)&&row.matchMethod===where.matchMethod&&where.status.in.includes(row.status)&&row.evidenceJson.organizationId===where.evidenceJson.equals).map(row=>{
      const requirement=s.requirements.find(r=>r.id===row.requirementId);
      return {...row,requirement:{...requirement,sourceRow:s.sources.find(r=>r.id===requirement.sourceRowId)}};
    });
  }},
  $transaction: async fn => {
    const s=globalThis.fluidResearchTest;
    const before=structuredClone({rows:s.rows,sources:s.sources,requirements:s.requirements,links:s.links});
    try{return await fn(prisma);}catch(error){Object.assign(s,before);throw error;}
  },
  $queryRaw: async () => { throw new Error("Failed to deserialize column of type 'void'"); },
  $executeRaw: async (sql, ...values) => {
    globalThis.fluidResearchTest.lock = {sql: sql.join('?'), values};
    return 1;
  },
  aIAgentTechnicalEvidence: {
    findMany: async ({where}) => globalThis.fluidResearchTest.rows.filter(r=>r.organizationId===where.organizationId&&r.vehicleKey===where.vehicleKey&&r.factType===where.factType&&!r.invalidatedAt&&where.status.in.includes(r.status)),
    findFirst: async ({where}) => [...globalThis.fluidResearchTest.rows].reverse().find(r=>r.organizationId===where.organizationId&&r.vehicleKey===where.vehicleKey&&r.aggregate===where.aggregate&&r.factType===where.factType&&!r.invalidatedAt&&where.OR.some(condition=>condition.status ? condition.status.in.includes(r.status) : r.validUntil>condition.validUntil.gt)),
    count: async () => globalThis.fluidResearchTest.limit ? 20 : 0,
    create: async ({data}) => {const row={...data,id:String(globalThis.fluidResearchTest.rows.length+1)};globalThis.fluidResearchTest.rows.push(row);return row;},
    update: async ({where,data}) => Object.assign(globalThis.fluidResearchTest.rows.find(r=>r.id===where.id),data),
  },
};
export async function assertOpenAIConnection(){if(globalThis.fluidResearchTest.networkFail)throw Error('private network diagnostic');return {ok:true};}
export function createOpenAIClient(){return {responses:{create:async request=>{const s=globalThis.fluidResearchTest;s.calls++;s.request=request;if(s.fail)throw Error('private provider error');return {id:'test-response',output_text:JSON.stringify(s.payload),output:[{type:'web_search_call',action:{sources:[{url:'https://example.com/manual'}]}}]};}}};}
