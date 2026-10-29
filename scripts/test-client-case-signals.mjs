import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createJiti} from 'jiti';
const folder=mkdtempSync(join(tmpdir(),'case-signals-'));
const react=join(folder,'react.cjs');writeFileSync(react,'exports.useCallback=fn=>fn;exports.useRef=value=>({current:value});exports.useState=value=>[value,()=>{}];exports.useEffect=fn=>fn();');
const saved=new Map();let notes=[],pushes=[],now=1000000;
const originalNow=Date.now;Date.now=()=>now;
globalThis.localStorage={getItem:key=>saved.get(key)??null,setItem:(key,value)=>saved.set(key,value)};
globalThis.window={addEventListener(){},removeEventListener(){},focus(){},location:{assign(){}}};
class NotificationStub {static permission='granted';static async requestPermission(){return 'granted';} constructor(title,options){pushes.push({title,options});} }
globalThis.Notification=window.Notification=NotificationStub;
class AudioStub {state='suspended';currentTime=0;destination={};async resume(){this.state='running';}createOscillator(){return {frequency:{value:0},connect(){},disconnect(){},start(){notes.push('note')},stop(){}};}createGain(){return {gain:{setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}};} }
globalThis.AudioContext=AudioStub;
const nav=Object.getOwnPropertyDescriptor(globalThis,'navigator');
Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request:async(_,work)=>work()}}});
try {
 const jiti=createJiti(import.meta.url,{alias:{react,'@':resolve('src')}});
 const {useClientCaseSignals}=await jiti.import('../src/components/platform/useClientCaseSignals.ts');
 const first=useClientCaseSignals('vadim:a');await first.toggle();notes=[];pushes=[];
 await first.process({newCases:[],notifications:[]});assert.equal(notes.length,0);
 const fresh={id:'new-1',title:'Расчёт',href:'/crm?dealId=new-1'};
 await first.process({newCases:[fresh]});assert.equal(notes.length,2);assert.equal(pushes.length,1);
 await first.process({newCases:[fresh]});assert.equal(notes.length,2);assert.equal(pushes.length,1);
 const second=useClientCaseSignals('vadim:a');await second.toggle();notes=[];pushes=[];
 await second.process({newCases:[fresh]});assert.equal(notes.length,0,'Other tab on the same device must not repeat the signal');
 const overdue={id:'live:old',caseId:'old',title:'Просрочено',body:'Клиент',href:'/crm?dealId=old',urgency:'overdue'};
 await first.process({notifications:[overdue]});assert.equal(notes.length,6);assert.equal(pushes.length,1);
 now+=299999;await second.process({notifications:[overdue]});assert.equal(notes.length,6);
 now+=1;await second.process({notifications:[overdue]});assert.equal(notes.length,12);assert.equal(pushes.length,2);
 now+=300000;await first.process({notifications:[]});assert.equal(notes.length,12,'No reminders once the case is resolved');
 saved.set('eco-crm-signals:vadim:a','off');await first.process({notifications:[overdue]});assert.equal(notes.length,12);assert.equal(pushes.length,2);
 saved.set('eco-crm-signals:vadim:a','on');NotificationStub.permission='denied';await first.process({notifications:[overdue]});assert.equal(notes.length,18,'Denied push permission must not disable sound');assert.equal(pushes.length,2);
 const otherBranch=useClientCaseSignals('vadim:b');await otherBranch.toggle();notes=[];NotificationStub.permission='granted';await otherBranch.process({newCases:[fresh]});assert.equal(notes.length,2,'Delivery scope must be independent across branches');
 const countBefore=notes.length;now+=300000;await otherBranch.process({newCases:[fresh]});assert.equal(notes.length,countBefore,'The same new case must never be re-announced');
 const reminder={...overdue,id:'log:soon',urgency:'next_hour',sentAt:'2026-10-29T10:00:00Z'};
 const pushBefore=pushes.length;await otherBranch.process({notifications:[reminder]});assert.equal(pushes.length,pushBefore+1);assert.equal(notes.length,countBefore,'Upcoming notifications retain browser delivery without an overdue sound');
 now+=300000;await otherBranch.process({notifications:[reminder]});assert.equal(pushes.length,pushBefore+1,'An unchanged upcoming notification must not repeat');
 console.log('Case signals: distinct sounds, 5-minute boundary, duplicate tabs, resolution, mute, permission denial and branch scope passed');
} finally { Date.now=originalNow;if(nav)Object.defineProperty(globalThis,'navigator',nav);rmSync(folder,{recursive:true,force:true}); }
