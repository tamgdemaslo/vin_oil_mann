import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createJiti} from 'jiti';
const recordingConfig=JSON.parse(readFileSync(resolve('public/audio/client-case-signals.json'),'utf8'));
assert.equal(recordingConfig.new,'/audio/client-case-replica-2.mp3','User recording 2 announces a new case');
assert.equal(recordingConfig.overdue,'/audio/client-case-replica-1.mp3','User recording 1 announces an overdue case');
for(const path of Object.values(recordingConfig)) assert.ok(readFileSync(resolve('public'+path)).length>1000,'Configured recordings must be included in the release');
const folder=mkdtempSync(join(tmpdir(),'case-signals-'));
const react=join(folder,'react.cjs');writeFileSync(react,'exports.useCallback=fn=>fn;exports.useRef=value=>({current:value});exports.useState=value=>[value,()=>{}];exports.useEffect=fn=>fn();');
const saved=new Map(),listeners=new Map();let notes=[],pushes=[],voices=[],now=1000000,allowAudio=true,recordings=false;
const originalNow=Date.now,originalFetch=globalThis.fetch;Date.now=()=>now;
globalThis.localStorage={getItem:key=>saved.get(key)??null,setItem:(key,value)=>saved.set(key,value)};
globalThis.fetch=async url=>String(url).endsWith('.json')?Response.json(recordings?{new:'/audio/new-case.mp3',overdue:'/audio/overdue.mp3'}:{new:null,overdue:null}):new Response(new Uint8Array([1]));
globalThis.window={addEventListener(name,fn){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);},removeEventListener(){},focus(){},location:{assign(){}}};
class NotificationStub {static permission='granted';static async requestPermission(){return 'granted';}constructor(title,options){pushes.push({title,options});}}
globalThis.Notification=window.Notification=NotificationStub;
class AudioStub {state='suspended';currentTime=0;destination={};async resume(){if(allowAudio)this.state='running';}async decodeAudioData(){return {duration:1.2};}createBufferSource(){return {connect(){},disconnect(){},start(at){voices.push(at);}};}createOscillator(){return {frequency:{value:0},connect(){},disconnect(){},start(at){notes.push(at);},stop(){}};}createGain(){return {gain:{setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}};}}
globalThis.AudioContext=AudioStub;
const nav=Object.getOwnPropertyDescriptor(globalThis,'navigator');
Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request:async(_,work)=>work()}}});
const flush=async()=>{await new Promise(setImmediate);await new Promise(setImmediate);};
const gesture=async()=>{for(const callback of listeners.get('pointerdown')??[])callback();await flush();};
try {
 const jiti=createJiti(import.meta.url,{alias:{react,'@':resolve('src')}});
 const {useClientCaseSignals}=await jiti.import('../src/components/platform/useClientCaseSignals.ts');
 saved.set('eco-crm-signals:vadim:a','off');
 const first=useClientCaseSignals('vadim:a');await flush();
 assert.equal(first.toggle,undefined,'No application-level mute is exposed');
 await first.process({newCases:[],notifications:[]});assert.equal(notes.length,0);
 const fresh={id:'new-1',title:'Расчёт',href:'/crm?dealId=new-1'};
 await first.process({newCases:[fresh]});assert.equal(notes.length,2,'Sound starts by default, ignoring the old off preference');assert.equal(pushes.length,1);
 await first.process({newCases:[fresh]});assert.equal(notes.length,2);assert.equal(pushes.length,1);
 const second=useClientCaseSignals('vadim:a');await flush();notes=[];pushes=[];
 await second.process({newCases:[fresh]});assert.equal(notes.length,0,'Other tabs on the same device must not repeat the signal');
 const overdue={id:'live:old',caseId:'old',title:'Просрочено',body:'Клиент',href:'/crm?dealId=old',urgency:'overdue'};
 await first.process({notifications:[overdue]});assert.equal(notes.length,6);assert.equal(pushes.length,1);
 now+=299999;await second.process({notifications:[overdue]});assert.equal(notes.length,6);
 now+=1;await second.process({notifications:[overdue]});assert.equal(notes.length,12);assert.equal(pushes.length,2);
 now+=300000;await first.process({notifications:[]});assert.equal(notes.length,12,'No reminders after resolution');
 NotificationStub.permission='denied';saved.set('eco-crm-signals:vadim:a','off');await first.process({notifications:[overdue]});assert.equal(notes.length,18,'Permission denial and old mute cannot disable sound');assert.equal(pushes.length,2);
 // A new case arriving before browser activation must survive the next empty poll.
 allowAudio=false;const blocked=useClientCaseSignals('blocked:a');await flush();notes=[];
 await blocked.process({newCases:[fresh],notifications:[overdue]});assert.equal(notes.length,0);
 await blocked.process({newCases:[],notifications:[]});allowAudio=true;await gesture();
 assert.equal(notes.length,2,'Any ordinary click unlocks the pending new-case sound; resolved overdue alerts stay silent');
 await gesture();assert.equal(notes.length,2,'Further clicks do not replay alerts or test tones');
 // Recordings use the same unlocked AudioContext and are queued instead of overlapping.
 recordings=true;NotificationStub.permission='granted';const voice=useClientCaseSignals('voice:a');await flush();notes=[];voices=[];
 await voice.process({newCases:[fresh],notifications:[overdue]});assert.equal(voices.length,2);assert.equal(notes.length,0);assert.ok(voices[1]>=voices[0]+1.2);
 NotificationStub.permission='granted';const reminder={...overdue,id:'log:soon',urgency:'next_hour',sentAt:'2026-10-29T10:00:00Z'};
 const pushBefore=pushes.length;await voice.process({notifications:[reminder]});assert.equal(pushes.length,pushBefore+1);assert.equal(voices.length,2);
 now+=300000;await voice.process({notifications:[reminder],newCases:[fresh]});assert.equal(pushes.length,pushBefore+1);assert.equal(voices.length,2);
 const shell=readFileSync(resolve('src/components/platform/PlatformShell.tsx'),'utf8');assert.doesNotMatch(shell,/Выключить сигналы|toggleSignals|aria-pressed=\{signalsEnabled\}/);
 console.log('Case signals: mandatory defaults, old mute ignored, normal-click activation, pending events, 5-minute repeat, duplicate tabs, recordings, non-overlap and resolution passed');
}finally{Date.now=originalNow;globalThis.fetch=originalFetch;if(nav)Object.defineProperty(globalThis,'navigator',nav);rmSync(folder,{recursive:true,force:true});}
