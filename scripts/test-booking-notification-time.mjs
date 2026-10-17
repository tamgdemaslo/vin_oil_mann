import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function evaluate(source, context={}) {
  const exports={};
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Date,Intl,process:{env:{APP_TIMEZONE:'Europe/Moscow'}},...context});
  return exports;
}
const dates=evaluate(readFileSync('src/lib/date-time.ts','utf8'));
const source=ts.createSourceFile('notifications.ts',readFileSync('src/lib/client-notifications/client-notifications.ts','utf8'),ts.ScriptTarget.Latest,true);
const fn=name=>source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name).getText(source);
const strings=v=>typeof v==='string'?v:'';
const variables=evaluate(fn('buildNotificationVariables'),{
  appointmentDate:input=>new Date(input.appointmentAt),
  stringValue:strings,asRecord:v=>v||{},sanitizeClientNotificationSettings:()=>({}),
  nonNegativeCount:v=>Math.max(0,Number(v)||0),cleanPublicUrl:strings,defaultVariableValue:()=>'',
  diagnosticRecommendationText:()=>'',diagnosticCriticalText:()=>'',
  notificationVariableDefinitions:[],legacyVariableAliases:new Map(),SERVICE_TIME_ZONE:dates.SERVICE_TIME_ZONE,
  ...dates,
});
assert.equal(dates.SERVICE_TIME_ZONE,'Europe/Moscow');
for (const [instant,expectedDate,expectedTime] of [
  ['2026-10-17T08:30:00Z','17.10.2026','10:30'],
  ['2026-10-17T21:30:00Z','17.10.2026','23:30'],
  ['2026-10-17T22:30:00Z','18.10.2026','00:30'],
]) {
  const result=variables.buildNotificationVariables({appointmentAt:instant,timezone:'Europe/Kaliningrad'});
  assert.equal(result.appointmentDate,expectedDate);
  assert.equal(result.appointmentTime,expectedTime);
  assert.ok(result.appointmentDateTime.includes(expectedTime));
}
const defaults=evaluate(readFileSync('src/lib/date-time.ts','utf8'),{process:{env:{}}});
assert.equal(defaults.formatServiceTime('2026-10-17T08:30:00Z'),'10:30');
const bookingNotifications=evaluate(readFileSync('src/lib/booking/notifications.ts','utf8')+'\nexport {contextFor};',{
  require:()=>({}),
});
const context=bookingNotifications.contextFor({id:'booking',startsAt:new Date('2026-10-17T08:30:00Z'),branch:{timezone:'Europe/Kaliningrad',name:'Branch'},serviceItems:[]});
assert.equal(context.timezone,'Europe/Kaliningrad');

const calls=[];
const created=evaluate(fn('handleAppointmentCreated'),{
  enqueueClientNotificationEvent:async event=>{calls.push(event);return [];},
  cancelAppointmentScheduledNotifications:async()=>0,
  nullableString:v=>v||null,
  processDueClientNotificationJobs:async(limit,id)=>{calls.push({limit,id});return [];},
});
await created.handleAppointmentCreated({appointmentId:'new-booking',source:'admin'});
assert.equal(calls.at(-1).id,'new-booking');
const queries=[];
const queue=evaluate(fn('processDueClientNotificationJobs'),{
  ensureClientNotificationsSchema:async()=>{},getMessengerOrganizationId:()=> 'org',activeNotificationBranchId:()=> 'branch',
  prisma:{$queryRaw:async(parts,...values)=>{queries.push({sql:parts.join('?'),values});return [];}},
  processClientNotificationJob:async()=>{throw new Error('No jobs expected');},
});
await queue.processDueClientNotificationJobs(10,'new-booking');
assert.match(queries[0].sql,/AND \(\?::text IS NULL OR appointment_id = \?\)/);
assert.equal(queries[0].values.filter(v=>v==='new-booking').length,2);
await queue.processDueClientNotificationJobs(50);
assert.equal(queries[1].values.filter(v=>v===null).length,2);
console.log('Booking notifications: branch timezone, midnight dates and immediate appointment queue checks passed');
