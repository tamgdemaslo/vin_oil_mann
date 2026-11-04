import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=fs.readFileSync('src/lib/tbank.ts','utf8').split('/** Read only the explicitly configured branch account;')[1];
assert.ok(source,'Dashboard balance reader must exist');
const number='1'.repeat(20);let calls=0;
const integration={sandbox:true,productionMode:false,directPaymentsEnabled:false,tokenEncrypted:'encrypted',debitAccountNumberEncrypted:'account',accounts:[]};
const original=JSON.stringify(integration);
const context={exports:{},getScopedBranchId:()=> 'branch-a',getMessengerOrganizationId:()=> 'org-a',
 prisma:{tBankIntegration:{findMany:async({where})=>{assert.equal(where.branchId,'branch-a');assert.equal(where.organizationId,'org-a');return [integration];}}},
 decryptText:()=>number,hashSecret:()=> 'hash',maskAccount:()=> '****1111',asRecord:v=>v??{},recordsFromUnknown:v=>v,accountNumberFromBankRecord:r=>r.accountNumber,
 callTBankJson:async(_integration,path)=>{calls++;assert.equal(path,'/api/v4/bank-accounts');return {body:[{accountNumber:number,currency:'643',balance:{balance:123.45,otb:20123.45}}]};},
};
vm.runInNewContext(ts.transpileModule('/** Read only the explicitly configured branch account;'+source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
const read=context.exports.getTBankDashboardBalances;
assert.equal((await read())[0].cents,12345,'sandbox payment flag must not disable authenticated read-only balances');assert.equal(calls,1);
assert.equal(JSON.stringify(integration),original,'reading balances must preserve payment settings');
integration.sandbox=false;assert.equal((await read())[0].cents,12345);assert.equal(calls,2);
integration.tokenEncrypted=null;assert.equal((await read())[0].cents,null);assert.equal(calls,2,'missing credentials must never cause an anonymous bank request');
console.log('T-Bank dashboard balances: read-only sandbox/production parity, configured branch and unchanged payment settings passed');
