import assert from "node:assert/strict";
import { resolve, join } from "node:path";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createJiti } from "jiti";
const fixtures = mkdtempSync(join(tmpdir(), "automatic-sales-plan-bonus-"));
writeFileSync(join(fixtures, "context.mjs"), `export const getBranchContext = async () => ({branchId:'bonus-test',branch:{timezone:'Europe/Moscow'}}); export const requireBranchContext = getBranchContext;`);
writeFileSync(join(fixtures, "analytics.mjs"), `export const getSalesPlanPositionKeys = async () => ({complete:true,actuals:new Map([['bonus-test:product:AIR_FILTER',{count:30,revenueCents:100000,grossProfitCents:50000}]])});`);
const jiti = createJiti(import.meta.url, { alias: {
  "@/lib/branch-context": join(fixtures, "context.mjs"),
  "@/lib/sales-performance-analytics": join(fixtures, "analytics.mjs"),
  "@": resolve(process.cwd(), "src"),
} });
process.env.AUTH_USERS = "maksim:fixture-only:Максим:master";
const parts = new Intl.DateTimeFormat("en-CA", {timeZone:"Europe/Moscow",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
const year = parts.find((p)=>p.type==='year').value, monthPart = parts.find((p)=>p.type==='month').value;
const month = `${year}-${monthPart}`, dateFrom = `${month}-01`, dateTo = `${month}-${new Date(Date.UTC(Number(year),Number(monthPart),0)).getUTCDate()}`;
const ledger = [];
let awards = 0, auditEntries = 0;
const read = async () => [];
const tx = {
  $executeRaw: async () => 1,
  $queryRaw: async (strings) => {
    if(strings.join('').includes('SELECT version')) return [{version:1,month,rowKey:"product:AIR_FILTER",completionBonusCents:500000}];
    if(ledger.length) return [];
    awards++;
    ledger.push({id:'bonus-once',employeeId:'maksim',amountCents:500000,type:'BONUS',status:'ACTIVE',sourceType:'SALES_PLAN_BONUS',sourceId:JSON.stringify([month,'product:AIR_FILTER']),periodFrom:dateFrom,periodTo:dateTo});
    return [{id:'bonus-once'}];
  },
  changeLog:{create:async()=>{auditEntries++;}},
};
globalThis.prisma = {
  branchSalesPlan:{findMany:async()=>[{id:'plan',month,rowKey:'product:AIR_FILTER',version:1,targetCount:30,completionBonusCents:500000}]},
  branchMembership:{findMany:async()=>[{roleId:'master',user:{login:'maksim',name:'Максим'}}]},
  user:{findMany:read},authPassword:{findMany:read},
  bonusPenalty:{findMany:async()=>[{userLogin:'maksim',type:'bonus',amountCents:100000}]},
  scheduledWorkingDay:{findMany:read},pieceworkRule:{findMany:read},localProduct:{findMany:read},localCatalogGroup:{findMany:read},localDemand:{findMany:read},
  $queryRaw:async(strings)=>strings.join('').includes('FROM payroll_adjustments')?ledger:[],
  $transaction:async(action)=>action(tx),
};
try {
  const {computePayroll}=await jiti.import('../src/lib/payroll.ts');
  const {runWithRequestTenant}=await jiti.import('../src/lib/request-tenant-store.ts');
  for(let i=0;i<3;i++) {
    const result=await runWithRequestTenant({mode:'branch',branchId:'bonus-test',allowedBranchIds:['bonus-test'],organizationId:null},()=>computePayroll({dateFrom,dateTo,targetLogin:'maksim'}));
    assert.equal(result.byLogin.maksim.bonusCents,600000,'base 1,000 ₽ plus the automatic 5,000 ₽ bonus');
    assert.equal(result.byLogin.maksim.totalCents,600000);
    assert.equal(result.byLogin.maksim.remainingCents,600000);
    assert.deepEqual(result.salesPlanBonusIds,['bonus-once']);
  }
  assert.equal(awards,1);assert.equal(auditEntries,1);
  console.log('Automatic plan bonus: first payroll includes the award, recursive base calculation terminates, and repeated calculations do not duplicate it.');
} finally { rmSync(fixtures,{recursive:true,force:true}); }
