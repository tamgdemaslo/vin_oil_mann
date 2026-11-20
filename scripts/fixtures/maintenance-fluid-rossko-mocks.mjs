const state=()=>globalThis[Symbol.for('maintenance-fluid-rossko-test')];
export async function getSession(){return state().authenticated?{id:'test-user'}:null;}
export async function requireBranchApi(){return state().denied?{ok:false,response:Response.json({error:'Denied'},{status:403})}:{ok:true,context:{branchId:'branchA',organizationId:'orgA',branch:{timezone:'Europe/Kaliningrad'}}};}
export async function runWithBranchApiContext(context,fn){state().contexts.push(context);return fn();}
export const prisma={localStore:{findFirst:async({where})=>state().stores.find(store=>store.id===where.id&&store.branchId===where.branchId)??null},localProduct:{findMany:async args=>{
 state().queries.push(args);const {branchId}=args.where,storeId=args.select.stockBalances.where.storeId;
 return state().rows.filter(row=>row.branchId===branchId&&!row.archived&&row.entityType!=='service'&&(!args.where.id||args.where.id===row.id)&&(!args.where.stockBalances||row.stockBalances.some(stock=>stock.branchId===branchId&&stock.storeId===storeId&&stock.available>0))).map(row=>({...row,stockBalances:row.stockBalances.filter(stock=>stock.branchId===branchId&&stock.storeId===storeId)}));
}}};
export async function rosskoConfig(){state().configCalls++;return state().config;}
export async function rosskoSearch(cfg,args){state().supplierCalls.push({cfg,args});if(state().supplierFail)throw Error('private supplier password');return state().raw;}
export async function getAgentSettings(organizationId){state().settingsCalls.push(organizationId);return {rosskoMarkupRules:state().rules};}
export function rosskoIntegrationError(){return {code:'ROSSKO_PROVIDER_ERROR',error:'Не удалось получить предложения поставщика.'};}
