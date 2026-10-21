// Isolated visual fixture: serves the actual UI; never imports auth, DB or Telegram.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),root=process.cwd(),out=fs.mkdtempSync(path.join(os.tmpdir(),'return-workflow-preview-'));
const ts=require('typescript'),w=require('next/dist/compiled/webpack/webpack');
const sources={CustomerReturnQueue:'src/app/cabinet/customer-analytics/CustomerReturnQueue.tsx',useCustomerReturnSharedState:'src/app/cabinet/customer-analytics/useCustomerReturnSharedState.ts',...Object.fromEntries(['customer-return-candidates','customer-return-shared-types','customer-return-workflow','customer-return-offer','customer-return-oil','customer-vehicle-identity','date-time'].map(n=>[n,'src/lib/'+n+'.ts']))};
for(const [name,file] of Object.entries(sources))fs.writeFileSync(out+'/'+name+'.js',ts.transpileModule(fs.readFileSync(root+'/'+file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText);
fs.writeFileSync(out+'/link.js',`import React from 'react';export default function Link({children,...props}){return React.createElement('a',props,children)}`);
const today='2026-10-21',branchId='preview-only';
const names=['Александр','Марина','Игорь','Андрей','Елена','Олег','Сергей'];
const candidates=names.map((displayName,i)=>{
 const offer={status:i===5?'review':'ready',vehicle:['Toyota Camry · А001АА39','Kia Rio · А002АА39','Skoda Octavia · А003АА39'][i%3],sourceDate:'2025-12-10',documentIds:['preview-1'],lines:[{productId:'oil',name:'Моторное масло 5W-30, 4 л',quantity:1,unit:'шт',priceCents:620000,sumCents:620000,available:4},{productId:'filter',name:'Масляный фильтр MANN W 712/95',quantity:1,unit:'шт',priceCents:130000,sumCents:130000,available:2}],laborCents:0,laborBasis:'Замена с маслом сервиса.',totalCents:i===5?null:750000,issues:i===5?['Нет подтверждённого масляного фильтра в наличии.']:[]};
 const reason={scenario:'oil_soon',vehicle:offer.vehicle,lastVisit:'2025-12-10',documentIds:['preview-1'],confidence:'history',needsReview:false,explanation:'С последней замены прошло 315 дней. Приближается привычный срок обслуживания.'};
 const draft=`${displayName}, здравствуйте! Приближается срок замены масла на вашем автомобиле. Это Вадим, мастер-приёмщик «Там, где масло» на Дачной.\n\nПредлагаем замену:\n• Моторное масло 5W-30, 4 л — 6 200 ₽\n• Масляный фильтр MANN W 712/95 — 1 300 ₽\nРабота включена.\n\nИтого с работой — 7 500 ₽.\n\nЗаписаться: https://example.invalid/booking`;
 return {id:'preview-'+i,clientKey:'preview-'+i,displayName,phone:'+7 900 000-00-0'+i,counterpartyId:'preview-person-'+i,reasons:[reason],draft,offers:[offer],offerReady:i!==5,bookingUrl:'https://example.invalid/booking',needsReview:i===5};
});
const jiti=require('jiti').createJiti(import.meta.url,{alias:{'@':root+'/src'}});
const {returnCandidateFingerprint:fp}=await jiti.import(root+'/src/lib/customer-return-shared-types.ts');
const states={};
function stateFor(i,status){const c=candidates[i];return {clientKey:c.id,draftText:c.draft,draftFingerprint:fp(c),skipped:status==='skipped',deliveryStatus:status==='skipped'?'none':status,version:1,updatedByLogin:'vadim',updatedByName:'Вадим',updatedAt:new Date().toISOString(),deliveryAt:status==='sent'?new Date().toISOString():null,deliveryMessageId:status==='sent'?'mock-message':null,deliveryError:status==='failed'?'Telegram недоступен. Сообщение не отправлено.':null};}
states['preview-2']=stateFor(2,'sending');states['preview-3']=stateFor(3,'sent');states['preview-4']=stateFor(4,'failed');states['preview-6']=stateFor(6,'skipped');
fs.writeFileSync(out+'/entry.js',`import React from 'react';import{createRoot}from'react-dom/client';import Queue from './CustomerReturnQueue';createRoot(document.getElementById('root')).render(React.createElement('main',{style:{maxWidth:1400,margin:'0 auto',padding:'24px 16px'}},React.createElement('p',{style:{fontSize:13,marginBottom:16,color:'#6b6259'}},'ДЕМОНСТРАЦИЯ · Дачная 6В · Тестовые данные. Отправка имитируется, Telegram не подключён.'),React.createElement(Queue,{candidates:${JSON.stringify(candidates)},today:'${today}',scope:'preview-only',branchId:'${branchId}',onRefresh:()=>location.reload()})));`);
fs.copyFileSync(root+'/src/app/globals.css',out+'/style.css');
fs.writeFileSync(out+'/index.html','<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Подборка — демонстрация очереди</title><link rel="stylesheet" href="/style.css"><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
await new Promise((resolve,reject)=>w.webpack({mode:'development',devtool:false,entry:out+'/entry.js',output:{path:out,filename:'bundle.js'},resolve:{extensions:['.js'],modules:[root+'/node_modules'],alias:{...Object.fromEntries(Object.keys(sources).filter(n=>n.startsWith('customer-')||n==='date-time').map(n=>['@/lib/'+n,out+'/'+n+'.js'])),'next/link':out+'/link.js'}},plugins:[new w.webpack.DefinePlugin({'process.env.NEXT_PUBLIC_APP_TIMEZONE':JSON.stringify('Europe/Kaliningrad'),'process.env.APP_TIMEZONE':JSON.stringify('Europe/Kaliningrad')})]},(err,stats)=>err||stats.hasErrors()?reject(err||Error(stats.toString({all:false,errors:true}))):resolve()));
function update(key,data){states[key]={...states[key],...data,version:states[key].version+1,updatedAt:new Date().toISOString()};}
http.createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://127.0.0.1:18776');
 if(url.pathname.startsWith('/api/analytics/customer-return')){
  res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
  if(req.method==='GET'){res.end(JSON.stringify({branchId,today,states:Object.values(states)}));return;}
  const body=[];for await(const chunk of req)body.push(chunk);const input=JSON.parse(Buffer.concat(body));const candidate=candidates.find(c=>c.id===input.clientKey);
  if(!candidate){res.writeHead(400);res.end(JSON.stringify({error:'Только тестовые клиенты'}));return;}
  if(url.pathname.endsWith('/send')){
   if(!states[input.clientKey]||states[input.clientKey].deliveryStatus==='none'){
    const index=candidates.indexOf(candidate);states[input.clientKey]={...stateFor(index,'queued'),draftText:input.draftText,version:input.expectedVersion+1};
    setTimeout(()=>update(input.clientKey,{deliveryStatus:'sending'}),2500);
    setTimeout(()=>update(input.clientKey,{deliveryStatus:index===1?'failed':'sent',deliveryAt:index===1?null:new Date().toISOString(),deliveryError:index===1?'Тестовая ошибка: Telegram недоступен. Сообщение не отправлено.':null}),18000);
   }
   res.writeHead(202);res.end(JSON.stringify({state:states[input.clientKey]}));return;
  }
  states[input.clientKey]={...(states[input.clientKey]??stateFor(candidates.indexOf(candidate),'none')),...(input.draftText!==undefined?{draftText:input.draftText,draftFingerprint:input.fingerprint}:{}),...(input.skipped!==undefined?{skipped:input.skipped}:{}),version:input.expectedVersion+1};res.end(JSON.stringify({state:states[input.clientKey]}));return;
 }
 const files={'/':'index.html','/bundle.js':'bundle.js','/style.css':'style.css'};const file=files[url.pathname];if(!file){res.writeHead(404);res.end('Only local demo assets');return;}
 res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(out+'/'+file));
}catch{res.writeHead(500);res.end('Fixture error');}}).listen(18776,'127.0.0.1',()=>console.log('Preview: http://127.0.0.1:18776 · synthetic data; no database or Telegram calls'));
