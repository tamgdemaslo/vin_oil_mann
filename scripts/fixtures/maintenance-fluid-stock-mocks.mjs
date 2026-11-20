const state=()=>globalThis[Symbol.for('maintenance-fluid-stock-test')];
export async function getSession(){return state().authenticated?{id:'test-user'}:null;}
export async function requireBranchApi(){return state().denied?{ok:false,response:Response.json({error:'Denied'},{status:403})}:{ok:true,context:{branchId:'branchA',organizationId:'orgA'}};}
export async function runWithBranchApiContext(context,operation){state().contexts.push(context);return operation();}
export const prisma={
 localStore:{findFirst:async({where})=>{state().storeQueries.push(where);return state().stores.find(store=>store.id===where.id&&store.branchId===where.branchId)??null;}},
 localProduct:{findMany:async args=>{
  state().productQueries.push(args);if(state().fail)throw Error('private database URL must not escape');
  const {branchId}=args.where,storeId=args.select.stockBalances.where.storeId;
  return state().rows.filter(row=>row.branchId===branchId&&!row.archived&&row.entityType!=='service'&&row.stockBalances.some(stock=>stock.branchId===branchId&&stock.storeId===storeId&&stock.available>0)).map(row=>({...row,stockBalances:row.stockBalances.filter(stock=>stock.branchId===branchId&&stock.storeId===storeId)}));
 }},
};
