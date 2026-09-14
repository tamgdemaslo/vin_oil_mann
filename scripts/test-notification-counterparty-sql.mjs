#!/usr/bin/env node
// Runs the actual tagged SQL against disposable, schema-shaped PostgreSQL tables.
// Only local test servers are allowed. All fixture tables are temporary and rolled back.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';
import ts from 'typescript';
const host=process.env.NOTIFICATION_TEST_PGHOST;
assert.ok(host && (host.startsWith('/') || ['localhost','127.0.0.1','::1'].includes(host)), 'Set NOTIFICATION_TEST_PGHOST to a local disposable PostgreSQL server');
const literal=value=>value==null?'NULL':"'"+String(value).replaceAll("'","''")+"'";
function queryFromFunction(path,name,index=0){
 const source=ts.createSourceFile(path,readFileSync(path,'utf8'),ts.ScriptTarget.Latest,true);
 const fn=source.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name);assert.ok(fn,name);
 const queries=[];function visit(node){if(ts.isTaggedTemplateExpression(node)&&node.tag.getText(source)==='prisma.$queryRaw')queries.push(node);ts.forEachChild(node,visit);}visit(fn);
 const query=queries[index];assert.ok(query,`${name} query ${index}`);
 return context=>{
  const exports={};const code=ts.transpileModule('export function run(){return '+query.getText(source)+';}',{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code,{exports,prisma:{$queryRaw:(parts,...values)=>parts.reduce((s,p,i)=>s+p+(i<values.length?literal(values[i]):''),'')},ANONYMOUS_RETAIL_SYSTEM_ROLE:'anonymous_retail',...context,activeNotificationBranchId:()=>context.branchId,getScopedBranchId:()=>context.branchId,getMessengerOrganizationId:()=>context.organizationId});return exports.run().trim();
 };
}
const notifications='src/lib/client-notifications/client-notifications.ts';
const byId=queryFromFunction(notifications,'resolveLocalCounterparty');
const byPhone=queryFromFunction(notifications,'resolveLocalCounterparty',1);
const conversation=queryFromFunction(notifications,'findTelegramConversation');
const peer=queryFromFunction('src/lib/messenger/channels/telegram-user-session.ts','telegramConversationPeer');
let sql=`BEGIN;
CREATE TEMP TABLE local_counterparties(id text PRIMARY KEY,branch_id text,name text,phone text,normalized_phone text,raw jsonb,updated_at timestamptz);
CREATE TEMP TABLE messenger_conversations(id text,organization_id text,branch_id text,channel text,status text,client_id text,supplier_id text,external_conversation_id text,external_user_id text,messenger_account_id text,participant_phone text,last_message_at timestamptz,external_chat_id text,participant_username text,metadata_json jsonb);
CREATE TEMP TABLE communication_identities(organization_id text,branch_id text,channel text,status text,external_conversation_id text,external_user_id text,client_id text,supplier_id text,phone_normalized text);
CREATE TEMP TABLE messenger_accounts(id text,organization_id text,channel text,is_active boolean,status text);
INSERT INTO local_counterparties VALUES ('a','branch-a','A','+79990000001','79990000001','{}',now()),('b','branch-b','B','+79990000001','79990000001','{}',now());
INSERT INTO messenger_conversations(id,organization_id,branch_id,channel,status,client_id,external_conversation_id,external_chat_id,last_message_at) VALUES
 ('conv-a','org','branch-a','telegram','open','a','telegram:1','1',now()),
 ('conv-b','org','branch-b','telegram','open','b','telegram:2','2',now()+interval '1 hour'),
 ('mislinked','org','branch-b','telegram','open','a','telegram:3','3',now()+interval '2 hour');
`;
let checks=0;
function expect(query,field,values,label){checks++;sql+=`DO $check$ BEGIN IF (SELECT COALESCE(jsonb_agg(${field}),'[]'::jsonb) FROM (${query}) actual) <> ${literal(JSON.stringify(values))}::jsonb THEN RAISE EXCEPTION '${label}'; END IF; END $check$;\n`;}
const base={branchId:'branch-a',organizationId:'org',clientId:'a',phone:null,normalizedChat:''};
expect(byId(base),'id',['a'],'exact local id');
expect(byId({...base,branchId:'branch-b'}),'id',[],'foreign branch client excluded');
expect(byId({...base,clientId:'missing'}),'id',[],'unknown id');
expect(byPhone({...base,branchId:'branch-b',phone:'79990000001'}),'id',['b'],'phone fallback branch scope');
expect(conversation(base),'id',['conv-a'],'conversation by client');
expect(conversation({...base,clientId:null,phone:'79990000001'}),'id',['conv-a'],'conversation by phone');
expect(conversation({...base,branchId:'branch-b',clientId:null,phone:'79990000001'}),'id',['conv-b'],'foreign linked client cannot match by phone');
expect(peer({...base,outbox:{conversationId:'conv-a',organizationId:'org'}}),'"clientPhone"',['+79990000001'],'peer client phone');
expect(peer({...base,branchId:'branch-b',outbox:{conversationId:'conv-a',organizationId:'org'}}),'"clientPhone"',[],'foreign conversation excluded');
expect(peer({...base,branchId:'branch-b',outbox:{conversationId:'mislinked',organizationId:'org'}}),'"clientPhone"',[null],'foreign client phone excluded');
sql+='ROLLBACK;';
const env={...process.env,PGHOST:host,PGPORT:process.env.NOTIFICATION_TEST_PGPORT||'5432',PGDATABASE:'postgres',PGUSER:process.env.USER,PGPASSWORD:'',PGSERVICEFILE:'/dev/null',PGPASSFILE:'/dev/null',PGOPTIONS:'-c statement_timeout=10000'};
const r=spawnSync('psql',['-X','-q','-v','ON_ERROR_STOP=1'],{input:sql,env,encoding:'utf8',timeout:30000});
assert.equal(r.status,0,r.stderr);
console.log(`Notification and Telegram SQL: ${checks} PostgreSQL checks passed (current schema, ID/phone lookup and branch isolation)`);
