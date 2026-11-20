export const prisma={localProduct:{findMany:async args=>{
 const state=globalThis[Symbol.for('maintenance-quote-stock-test')];state.queries.push(args);
 const {branchId}=args.where,storeId=args.select.stockBalances.where.storeId;
 return state.rows.filter(row=>row.branchId===branchId&&!row.archived&&(!args.where.stockBalances||row.stockBalances.some(stock=>stock.branchId===branchId&&stock.storeId===storeId&&stock.available>0))).map(row=>({...row,stockBalances:row.stockBalances.filter(stock=>stock.branchId===branchId&&stock.storeId===storeId)}));
}}};
