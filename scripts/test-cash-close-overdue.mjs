import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createJiti} from 'jiti';

const dir=mkdtempSync(join(tmpdir(),'cash-close-overdue-'));
const previousImport=process.env.CASHBOX_DISABLE_LEGACY_IMPORT;
const previousPath=process.env.CASHBOX_DB_PATH;
process.env.CASHBOX_DISABLE_LEGACY_IMPORT='1';
process.env.CASHBOX_DB_PATH=join(dir,'no-legacy-cash.json');
function stub(name,code){const file=join(dir,name+'.cjs');writeFileSync(file,code);return file;}
const auth=stub('auth',`exports.state={user:{login:'vadim',name:'Вадим',role:'admin'}};exports.getSession=async()=>exports.state.user?{user:exports.state.user}:null;`);
const branch=stub('branch',`exports.state={branchId:'a'};exports.requireBranchContext=async()=>exports.state;`);
const expense=stub('expense',`exports.listCashExpenseOrderOperationsForShift=async()=>[];`);
const db=stub('db',`
exports.state={rows:[],updates:[],fail:false,shift:{id:'shift-a',branchId:'a',status:'open',openingCashCents:10000,openedAt:new Date('2026-10-29T07:00:00Z'),openedBy:'vadim',openedByRole:'admin',serviceDate:'2026-10-29',timezone:'Europe/Kaliningrad'}};
exports.prisma={
 cashShift:{findFirst:async({where})=>where.id===exports.state.shift.id&&where.branchId===exports.state.shift.branchId?exports.state.shift:null,update:async query=>{exports.state.updates.push(query);return {...exports.state.shift,...query.data};}},
 cashWithdrawal:{findMany:async()=>[]},
 crmDeal:{findMany:async({where})=>{if(exports.state.fail)throw Error('CRM unavailable');return exports.state.rows.filter(row=>row.branchId===where.branchId&&row.status==='open'&&!where.caseStatus.notIn.includes(row.caseStatus));}}
};`);
const aliases={'@':resolve('src'),'@/lib/db':db};
for(const [name,file] of Object.entries({auth,'branch-context':branch,'cash-expense-orders':expense,db})){
 aliases[resolve('src/lib/'+name)]=file;
 aliases[resolve('src/lib/'+name+'.ts')]=file;
 aliases['@/lib/'+name]=file;
 aliases['./'+name]=file;
}
try{
 const jiti=createJiti(import.meta.url,{alias:aliases});
 const {state}=await jiti.import(db),a=await jiti.import(auth),b=await jiti.import(branch);
 const {closeShift,CashShiftOverdueCasesError}=await jiti.import('../src/lib/cashbox.ts');
 const {POST}=await jiti.import('../src/app/api/cash/route.ts');
 const params={shiftId:'shift-a',actualCash:100,cashOrdersTotal:0,cardOrdersTotal:0};
 const base={id:'late',branchId:'a',title:'Дело',status:'open',caseStatus:'parts_arrived',stage:null,nextActionAt:new Date('2000-01-01T10:00:00Z'),createdAt:new Date('2000-01-01T09:00:00Z')};
 const blocked=async row=>{state.rows=[row];const writes=state.updates.length;await assert.rejects(closeShift(params),error=>error instanceof CashShiftOverdueCasesError&&error.overdueCount===1);assert.equal(state.updates.length,writes,'A blocked close must never update the cash shift');};
 await blocked(base);
 await blocked({...base,caseStatus:'calculation_needed',nextActionAt:null});
 await blocked({...base,caseStatus:'waiting_parts',suppliesExpectedAt:new Date('2000-01-01T10:00:00Z')});
 await blocked({...base,snoozeUntil:new Date('2100-01-01')});
 a.state.user.role='owner';await blocked(base);a.state.user.role='admin';
 let response=await POST({json:async()=>({action:'closeShift',...params})});
 assert.equal(response.status,409);const body=await response.json();assert.equal(body.code,'OVERDUE_CLIENT_CASES');assert.equal(body.overdueCount,1);assert.match(body.error,/Нельзя закрыть кассу/);
 // The same live case can be resolved or rescheduled; neither old logs nor another branch block closing.
 for(const row of [{...base,status:'won'},{...base,caseStatus:'closed'},{...base,caseStatus:'cancelled'},{...base,stage:{name:'Выполнено'}},{...base,branchId:'b'},{...base,nextActionAt:new Date('2100-01-01')},{...base,caseStatus:'calculation_sent'}]){
  state.rows=[row];const result=await closeShift(params);assert.equal(result.status,'closed');
 }
 state.rows=[];state.fail=true;const writes=state.updates.length;
 await assert.rejects(closeShift(params),/CRM unavailable/);assert.equal(state.updates.length,writes,'CRM lookup failures must leave the shift open');state.fail=false;
 b.state.branchId='b';await assert.rejects(closeShift(params),/Открытая смена не найдена/);assert.equal(state.updates.length,writes);
 b.state.branchId='a';a.state.user=null;await assert.rejects(closeShift(params),/авторизация/);
 console.log('Cash close: real overdue deadlines, snooze, owner, branch isolation, resolution, fail-closed lookup and HTTP 409 passed');
}finally{
 for(const [key,value] of [['CASHBOX_DISABLE_LEGACY_IMPORT',previousImport],['CASHBOX_DB_PATH',previousPath]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}
 rmSync(dir,{recursive:true,force:true});
}
