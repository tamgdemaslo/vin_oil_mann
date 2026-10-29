import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createJiti} from 'jiti';
const dir=mkdtempSync(join(tmpdir(),'case-alert-route-'));
function stub(name,code){const file=join(dir,name+'.cjs');writeFileSync(file,code);return file;}
const auth=stub('auth','exports.state={session:{user:{login:"vadim",role:"master"}}};exports.getSession=async()=>exports.state.session;');
const branch=stub('branch','exports.state={allowed:true};exports.requireBranchApi=async()=>exports.state.allowed?{ok:true,context:{branchId:"a"}}:{ok:false,response:new Response(null,{status:409})};exports.runWithBranchApiContext=(_,fn)=>fn();');
const alerts=stub('alerts','exports.state={calls:[]};exports.getClientCaseAlertSnapshot=async(branch,since)=>{exports.state.calls.push({branch,since});return {serverTime:"2026-10-29T10:00:00Z",clientCaseAttention:{overdue:1,calculationNeeded:2},newCases:[],overdue:[{id:"live:old",caseId:"old",urgency:"overdue"}]}};');
const notify=stub('notify','exports.getCrmNotificationConfig=()=>({enabled:true});exports.listClientCaseNotificationsForUser=async()=>{throw Error("Test missing log")};exports.processClientCaseDeadlineNotifications=async()=>{};');
try {
 const jiti=createJiti(import.meta.url,{alias:{'@/lib/auth':auth,'@/lib/branch-api':branch,'@/lib/client-case-alerts':alerts,'@/lib/crm-deadline-notifications':notify,'@':resolve('src')}});
 const a=await jiti.import(auth),b=await jiti.import(branch),s=await jiti.import(alerts);
 const {GET}=await jiti.import('../src/app/api/crm/deadline-notifications/route.ts');
 const request=query=>({nextUrl:new URL('https://example.test/api/crm/deadline-notifications'+(query||''))});
 let response=await GET(request());assert.equal(response.status,200);let data=await response.json();assert.equal(data.notifications[0].id,'live:old');assert.equal(data.notificationCounts.overdue,1);assert.equal(data.clientCaseAttention.overdue,1);assert.equal(s.state.calls[0].branch,'a');assert.equal(s.state.calls[0].since,null);
 response=await GET(request('?since=2026-10-29T09:59:00Z'));assert.equal(response.status,200);assert.equal(s.state.calls[1].since.toISOString(),'2026-10-29T09:59:00.000Z');
 assert.equal((await GET(request('?since=invalid'))).status,400);
 a.state.session=null;assert.equal((await GET(request())).status,401);a.state.session={user:{login:'unknown',role:'mechanic'}};assert.equal((await GET(request())).status,403);
 a.state.session={user:{login:'vadim',role:'master'}};b.state.allowed=false;assert.equal((await GET(request())).status,409);
 console.log('Alert route: log failure fallback, authenticated branch scope, cursor validation and access checks passed');
}finally{rmSync(dir,{recursive:true,force:true});}
