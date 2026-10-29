import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createJiti} from 'jiti';
const dir=mkdtempSync(join(tmpdir(),'case-alerts-'));
const db=join(dir,'db.cjs');
writeFileSync(db,`exports.rows=[];exports.state={query:null};exports.prisma={crmDeal:{findMany:async query=>{exports.state.query=query;return exports.rows.filter(row=>row.branchId===query.where.branchId&&row.status==='open'&&!query.where.caseStatus.notIn.includes(row.caseStatus))}}};`);
try {
 const jiti=createJiti(import.meta.url,{alias:{'@/lib/db':db,'@':resolve('src')}});
 const state=await jiti.import(db);
 const {getClientCaseAlertSnapshot:snapshot}=await jiti.import('../src/lib/client-case-alerts.ts');
 const now=new Date('2026-10-29T10:00:00Z');
 const base={id:'old',branchId:'a',status:'open',caseStatus:'calculation_needed',title:'Расчёт',customerName:'Клиент',phoneNormalized:null,responsibleLogin:null,nextAction:null,createdAt:new Date('2026-10-28T08:00:00Z'),nextActionAt:null,nextContactAt:null,snoozeUntil:null,stage:{name:'Нужно рассчитать'}};
 state.rows.push(base,{...base,id:'new',createdAt:new Date(+now-1000)},{...base,id:'other',branchId:'b'}, {...base,id:'closed',status:'won'}, {...base,id:'parts',caseStatus:'parts_arrived',nextActionAt:new Date(+now-2000)}, {...base,id:'waiting',caseStatus:'waiting_parts'}, {...base,id:'late-supply',caseStatus:'waiting_parts',suppliesExpectedAt:new Date(+now-1000)}, {...base,id:'future-supply',caseStatus:'waiting_parts',suppliesExpectedAt:new Date(+now+60000)}, {...base,id:'snoozed',snoozeUntil:new Date(+now+60000)}, {...base,id:'legacy-closed',stage:{name:'Выполнено'}});
 let result=await snapshot('a',null,now);
 assert.deepEqual(result.clientCaseAttention,{overdue:4,calculationNeeded:3});
 assert.deepEqual(result.newCases,[],'Initial load must not announce existing work as new');
 assert.deepEqual(result.overdue.map(row=>row.caseId),['old','parts','late-supply'],'Legacy requests without a stored deadline remain overdue; snooze suppresses alerts');
 assert.equal(result.overdue.find(item=>item.caseId==='late-supply').title,'Просрочена поставка запчастей');
 assert.equal(result.overdue.find(item=>item.caseId==='late-supply').deadline,new Date(+now-1000).toISOString());
 assert.equal(result.overdue[0].id,'live:old','No notification log is required');
 result=await snapshot('a',new Date(+now-2000),now);assert.deepEqual(result.newCases.map(row=>row.id),['new']);
 assert.equal(result.serverTime,now.toISOString());assert.equal(state.state.query.where.branchId,'a');
 state.rows[0].caseStatus='calculation_sent';result=await snapshot('a',null,now);assert.ok(!result.overdue.some(row=>row.caseId==='old'));
 assert.equal((await snapshot('b',null,now)).overdue.length,1);
 console.log('Live case alerts: branch isolation, initial baseline, new arrivals, legacy deadlines, snooze and resolved cases passed');
} finally {rmSync(dir,{recursive:true,force:true});}
