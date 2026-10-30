import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createJiti} from 'jiti';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const dir=mkdtempSync(join(tmpdir(),'cash-close-view-'));
const link=join(dir,'link.cjs');
writeFileSync(link,`const React=require(${JSON.stringify(resolve('node_modules/react'))});module.exports=({prefetch,...props})=>React.createElement('a',props);`);
try{
 const jiti=createJiti(import.meta.url,{jsx:true,alias:{'next/link':link,'@':resolve('src')}});
 const {CashCloseError}=await jiti.import('../src/components/cash/CashCloseError.tsx');
 const cases=[{id:'case/1?x=2',title:'Замена масла <script>',client:'Марина',nextAction:'Записать клиента',deadline:'2026-10-30T10:00:00Z'},{id:'case-2',title:'Расчёт',client:'Иван',nextAction:'Позвонить',deadline:'2026-10-30T12:00:00Z'}];
 const render=message=>renderToStaticMarkup(React.createElement(CashCloseError,{message,cases}));
 assert.equal(render(null),'');const html=render('Нельзя закрыть кассу');
 assert.match(html,/role="alert"/);assert.equal((html.match(/<li>/g)||[]).length,2);
 assert.match(html,/href="\/crm\?dealId=case%2F1%3Fx%3D2"/);assert.match(html,/target="_blank"/);
 for(const value of ['Марина','Записать клиента','Иван','2026-10-30T10:00:00Z','2026-10-30T12:00:00Z'])assert.ok(html.includes(value));
 assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));
 console.log('Cash close UI: per-case links, client/action/deadline, retained cash form via new tab and escaped content passed');
}finally{rmSync(dir,{recursive:true,force:true});}

