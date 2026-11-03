import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
class FrozenDate extends Date { constructor(...args) { super(...(args.length ? args : ["2026-11-03T09:00:00Z"])); } }
function load(path, dependencies) {
  const source=ts.transpileModule(fs.readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports={};vm.runInNewContext(source,{exports,require:id=>{assert.ok(id in dependencies,`Unexpected import ${id}`);return dependencies[id]},Date:FrozenDate,Number,Math,Promise,URL});return exports;
}
const branch='branch-sergei';let scope=null;let role='owner';let allowed=true;let audits=0;let nextId=0;
const rows=[{id:'wrong-original',branchId:'branch-main',userLogin:'sergei',amountCents:100000,effectiveFrom:'2026-11-01'}];
function scoped(where){assert.equal(scope,branch,'all I/O runs inside verified branch context');assert.equal(where.branchId,branch,'queries explicitly select the active branch');return rows.filter(r=>r.branchId===where.branchId&&(!where.id||typeof where.id==='string'?(!where.id||r.id===where.id):where.id.in.includes(r.id))&&(!where.userLogin||where.userLogin.in.includes(r.userLogin))&&(!where.effectiveFrom||(typeof where.effectiveFrom==='string'?r.effectiveFrom===where.effectiveFrom:(!where.effectiveFrom.gte||r.effectiveFrom>=where.effectiveFrom.gte)&&(!where.effectiveFrom.lte||r.effectiveFrom<=where.effectiveFrom.lte))));}
const prisma={shiftRate:{
 findMany:async({where})=>scoped(where),
 findFirst:async({where})=>scoped(where).sort((a,b)=>b.effectiveFrom.localeCompare(a.effectiveFrom))[0]??null,
 create:async({data})=>{assert.equal(scope,branch);assert.equal(data.branchId,branch);const r={id:'new-'+nextId++,...data};rows.push(r);return r;},
 update:async({where,data})=>{const r=scoped(where)[0];assert.ok(r);Object.assign(r,data);return r;},
 deleteMany:async({where})=>{const removed=scoped(where);for(const r of removed)rows.splice(rows.indexOf(r),1);return{count:removed.length}},
},branchMembership:{findFirst:async({where})=>{assert.equal(scope,branch);assert.equal(where.branchId,branch);return where.user.login.in.includes('sergei')?{id:'membership'}:null;}},$transaction:async action=>action(prisma)};
const auth={canonicalizeLogin:x=>x.toLowerCase(),getLoginVariants:x=>[x.toLowerCase()],getSession:async()=>({user:{login:'ilya',role}})};
const helpers=load('../src/lib/shift-rates.ts',{'@/lib/auth':auth,'@/lib/db':{prisma},'@/lib/branch-context':{requireBranchContext:async()=>({branchId:branch})}});
const routes=load('../src/app/api/shift-rates/route.ts',{
 'next/server':{NextResponse:{json:(data,options)=>({status:options?.status??200,data})}},'@/lib/auth':auth,'@/lib/db':{prisma},
 '@/lib/branch-api':{requireBranchApi:async()=>allowed?{ok:true,context:{branchId:branch}}:{ok:false,response:{status:403}},runWithBranchApiContext:async(_ctx,action)=>{scope=branch;try{return await action()}finally{scope=null}}},
 '@/lib/payroll-employees':{listPayrollEmployees:async()=>[{login:'sergei',name:'Коньков Сергей'}]},'@/lib/shift-rates':helpers,
 '@/lib/change-log':{logChange:async()=>{assert.equal(scope,branch);audits++}},'@/lib/payroll':{invalidatePayrollCache(){}},
 '@/lib/time':{toLocalDateString:date=>date.getFullYear()===2026&&date.getMonth()===10?'2026-11-'+String(date.getDate()).padStart(2,'0'):'2026-11-03'},
});
const post=body=>routes.POST({json:async()=>body});
assert.equal((await post({userLogin:'sergei',amountCents:100000,effectiveFrom:'2026-11-01',applyToMonth:true})).status,200);
assert.equal(rows.find(r=>r.id==='wrong-original').branchId,'branch-main','saving cannot modify another branch rate');
const read=await routes.GET({url:'https://example.test/api/shift-rates'});
assert.equal(read.data.rates[0].amountCents,100000);
assert.equal(read.data.rates[0].effectiveFrom,'2026-11-01','UI receives actual effective date rather than selected period start');
assert.equal((await post({userLogin:'sergei',amountCents:150000,effectiveFrom:'2026-11-03'})).status,200);
assert.equal((await routes.GET({url:'https://example.test/api/shift-rates'})).data.rates[0].amountCents,150000);
assert.equal((await post({userLogin:'sergei',amountCents:100000,effectiveFrom:'2026-11-01',applyToMonth:true})).status,200);
assert.equal(rows.filter(r=>r.branchId===branch).length,1,'month replacement removes only this branch overrides');
for(const body of [{userLogin:'sergei',amountCents:NaN},{userLogin:'sergei',amountCents:-1},{userLogin:'sergei',amountCents:100000,effectiveFrom:'2026-02-30'}])assert.equal((await post(body)).status,400);
assert.equal((await post({userLogin:'foreign',amountCents:100000})).status,404);
role='master';assert.equal((await post({userLogin:'sergei',amountCents:100000})).status,403);
role='owner';allowed=false;assert.equal((await post({userLogin:'sergei',amountCents:100000})).status,403);
assert.equal(audits,3);
console.log('Shift-rate save: selected branch, create/update/month replacement, unchanged foreign rates, read-after-write, effective date, validation and permissions passed.');

const {employeeRoleLabel}=load('../src/lib/employee-role-label.ts',{});
assert.equal(employeeRoleLabel('master','admin'),'Мастер-приёмщик','branch job title must not be replaced by administrator access');
assert.equal(employeeRoleLabel('mechanic','admin'),'Механик');
assert.equal(employeeRoleLabel('accountant','master'),'Бухгалтер');
assert.equal(employeeRoleLabel('administrator','master'),'Администратор');
console.log('Payroll job labels follow branch roles independently of account permissions.');
