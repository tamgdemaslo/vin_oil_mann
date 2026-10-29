import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import ts from 'typescript';
import { createJiti } from 'jiti';
import { sessionAuthorizationUser } from '../src/lib/administrator-equivalence.mjs';
import { resolveNavigationForUser } from '../src/lib/navigation-policy.mjs';

function load(file, dependencies, globals={}) {
  const source=ts.transpileModule(fs.readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  const exports={};
  vm.runInNewContext(source,{exports,require:id=>{assert.ok(id in dependencies,`Unexpected dependency ${id}`);return dependencies[id];},Buffer,Date,Map,Set,console,process:{env:{AUTH_USERS:'tester:fake-test-only:Tester:master',SESSION_SECRET:'isolated-test-secret'}},...globals});
  return exports;
}
// Verify the production tenant resolver returns membership roles, not a legacy account label.
let branchCookie;
const branchRows=['master','mechanic','accountant','viewer'].map((roleId,index)=>({branchId:`branch-${index}`,roleId,isDefaultBranch:index===0,branch:{id:`branch-${index}`,status:'active',businessGroupId:'g',legacyOrganizationId:null}}));
const tenantResolver=load('../src/lib/request-tenant.ts',{
 'node:crypto':crypto,
 'next/headers':{cookies:async()=>({get:()=>branchCookie?{value:branchCookie}:undefined})},
 '@/lib/db':{prisma:{user:{findUnique:async()=>({id:'tester',lastActiveBranchId:null})},businessGroupMembership:{findMany:async()=>[]},branchMembership:{findMany:async()=>branchRows},branch:{findFirst:async()=>null}}},
 '@/lib/request-tenant-store':{bindRequestTenantStore:()=>{}},
});
for (let index=0;index<branchRows.length;index++) {
 const payload=Buffer.from(JSON.stringify({branchId:`branch-${index}`,login:'tester',exp:Math.floor(Date.now()/1000)+60})).toString('base64url');
 branchCookie=`${payload}.${crypto.createHmac('sha256','isolated-test-secret').update(payload).digest('base64url')}`;
 const verified=await tenantResolver.bindRequestTenant({login:'tester',role:'master'});
 assert.equal(verified.branchId,`branch-${index}`);
 assert.equal(sessionAuthorizationUser({role:'master'},verified).role,index===0?'admin':'master');
}

let token;
let tenant={mode:'branch',branchId:'a',allowedBranchIds:['a'],permissions:['master']};
let boundRole;
const auth=load('../src/lib/auth.ts',{
 'next/headers':{cookies:async()=>({get:key=>key==='eco_session'?{value:token}:undefined})},
 crypto,
 '@/lib/db':{prisma:{authPassword:{findMany:async()=>[]},user:{findMany:async()=>[]}}},
 '@/lib/administrator-equivalence.mjs':{sessionAuthorizationUser},
 '@/lib/request-tenant':{bindRequestTenant:async user=>{boundRole=user.role;return tenant;},getRequestTenant:()=>tenant},
});
token=await auth.createSession({login:'tester',name:'Tester',role:'master'});
let session=await auth.getSession();assert.equal(boundRole,'master');assert.equal(session.user.role,'admin');assert.equal(session.user.authRole,'master');
assert.equal((await auth.getPublicUsers())[0].role,'master','Payroll role sources remain unchanged');
const renewed=await auth.createSession(session.user);
assert.equal(JSON.parse(Buffer.from(renewed.split('.')[0],'base64url')).role,'master','Credentials must never retain a branch-local elevation');
class NextResponse extends Response {static json(body,init){return new NextResponse(JSON.stringify(body),init);}}
const exportRoute=load('../src/app/api/products/export-template/route.ts',{
 'next/server':{NextResponse},'@/lib/auth':auth,'@/lib/product-import-export':{buildProductTemplateWorkbook:async()=>Buffer.from('isolated test workbook')},
},{Response,Uint8Array});
assert.equal((await exportRoute.GET()).status,200,'A real admin-only API accepts the verified receptionist');
const jiti=createJiti(import.meta.url);
const booking=await jiti.import('../src/lib/booking/access.ts');
const avito=await jiti.import('../src/lib/avito-autoload/access.ts');
for(const role of ['master','administrator']) {
 const context={branchRole:role,groupRole:null,permissions:[]};
 assert.equal(booking.canManageBookingSettings(context),true);assert.equal(booking.canOverrideBookingConflict(context),true);assert.equal(avito.canEditAvito(context),true);
}
for(const role of ['mechanic','accountant','viewer']) {
 tenant={mode:'branch',branchId:'b',allowedBranchIds:['b'],permissions:[role]};
 session=await auth.getSession();assert.equal(session.user.role,'master');assert.equal((await exportRoute.GET()).status,403,`${role} must not receive administrator access`);
 const context={branchRole:role,groupRole:null,permissions:[]};assert.equal(booking.canManageBookingSettings(context),false);assert.equal(avito.canEditAvito(context),false);
 const nav=resolveNavigationForUser({user:{role:'master'},branchMemberships:[{branchId:'b',roleId:role}],activeBranchId:'b'});assert.equal(nav.canManageBranches,false);
}
for(const invalid of [{mode:'all',branchId:null,allowedBranchIds:['a'],permissions:['master']},{mode:'denied',branchId:'a',allowedBranchIds:[],permissions:['master']},{mode:'branch',branchId:'a',allowedBranchIds:['b'],permissions:['master']},null]) {
 tenant=invalid;assert.equal((await auth.getSession()).user.role,'master');assert.equal((await exportRoute.GET()).status,403);
}
tenant={mode:'branch',branchId:'a',allowedBranchIds:['a'],permissions:['master']};assert.equal((await exportRoute.GET()).status,200,'Returning to the receptionist branch restores access without changing payroll');
const owner=sessionAuthorizationUser({role:'owner'},tenant);assert.equal(owner.role,'owner');assert.notEqual(sessionAuthorizationUser({role:'master'},tenant).role,'owner','Owner-only controls stay owner-only');
assert.equal(resolveNavigationForUser({user:{role:'master'}}).canManageBranches,false,'An unverified legacy master cannot acquire branch management');
const ownerOnly=load('../src/app/api/payroll/motivation/overview/route.ts',{
 'next/server':{NextResponse},'@/lib/auth':auth,'@/lib/payroll-motivation':{listAllPayrollGoals:()=>{throw Error('Owner data must not be read')},listAllRecognition:()=>{throw Error('Owner data must not be read')}},
},{Response});
assert.equal((await ownerOnly.GET()).status,403,'Receptionists remain blocked by a real owner-only API');
console.log('Receptionist/admin parity: real signed session and admin API, unchanged payroll/credentials, booking, navigation, other roles and branch switching passed');
