import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha,applicabilityWindow} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
import {nissanXtrailEngineBranches} from './lib/mann-nissan-xtrail-engine-branches.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-nissan-xtrail-cvt-preview-2026-09-14');
const [sql,mannRaw,planRaw,rawText]=await Promise.all([readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),readFile('/tmp/mann_filter_applications.sql','utf8'),readFile(resolve(dir,'plan.json'),'utf8'),readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8')]);
const plan=JSON.parse(planRaw),overlay=await loadIdentityOverlay(root,sql,resolve(root,'outputs/mann-identity-scoped-2026-09-14/source-identity-corrections.json'));
const rawRows=rawText.trim().split('\n').map(JSON.parse),anchor=rawRows.find(r=>r.row_id==='89f4fc7432510374f9582e24cbdf65ae68284a669402cc8b917692d163ba8bde');assert.ok(anchor);
const engines=nissanXtrailEngineBranches(anchor.model);assert.equal(engines.length,2);const engine=engines.find(e=>!e.hybrid);
const seed=overlay.originalById.get('1d19bedfa9fd5c3f43b4148dee739f08ed54a7ec4e9cd24d327f0f6b10cfa8fa');
const sources=overlay.requirements.filter(r=>r.sourceTableKey===seed.sourceTableKey);assert.equal(sources.length,8);
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{matchFluidRequirementToMann:match}=await jiti.import('../src/lib/mann-fluid-matcher-v2.ts'),{mannMakeFormsForTest}=await jiti.import('../src/lib/mann-vehicle-resolver.ts'),{normalizeMannText}=await jiti.import('../src/lib/mann-catalog.ts'),{extractFluidSourceSystemContext:label}=await jiti.import('../src/lib/fluid-source-system-context.ts'),{mannTransmissionComponent:component}=await jiti.import('../src/lib/mann-transmission-component.ts');
const forms=new Set(mannMakeFormsForTest('NISSAN')),rows=parseCopy(mannRaw,'mann_filter_applications').filter(r=>forms.has(normalizeMannText(r.makeNormalized||r.make)));
const key='0a23878499f782bce253f7c3ed6a14618c0e32a8e0b5d104aba16498b0ad27e2',target=rows.filter(r=>r.vehicleVariantKey===key);assert.ok(target.length);assert.ok(target.every(r=>Number(r.hp)===engine.powerHp));
const findings=[];
for(const source of sources){
 const original=overlay.originalById.get(source.id),raw=rawRows.find(r=>r.row_id===original.sourceRowId);assert.equal(raw.source_url,anchor.source_url);assert.equal(raw.table_index,anchor.table_index);
 const narrowed={...source,engineCodeNormalized:engine.engineCode,engineCodesJson:[engine.engineCode],powerHp:engine.powerHp,yearFrom:engine.yearFrom,yearTo:engine.yearTo};
 const windows=target.map(r=>applicabilityWindow(narrowed,r));assert.ok(windows.every(Boolean));assert.equal(new Set(windows.map(sha)).size,1);const window=windows[0];
 const decision=match({...narrowed,...window.narrowedYears},rows),existing=plan.newRevisions.filter(r=>r.sourceRequirementId===source.id).map(r=>r.id);
 findings.push({sourceRequirementId:source.id,originalSource:original,sourceHash:sha(original),systemCode:source.systemCode,existingRevisionIds:existing,sourceLabelContext:label(source.systemNameRaw,source.componentModel),component:component(source.componentModel),engine,window,decision});
}
const codeFiles=['scripts/recheck-mann-xtrail-table.mjs','scripts/lib/mann-nissan-xtrail-engine-branches.mjs','src/lib/mann-fluid-matcher-v2.ts','src/lib/mann-vehicle-resolver.ts','src/lib/mann-engine-code-list.ts','src/lib/fluid-source-system-context.ts','src/lib/mann-transmission-component.ts'];
const report={planHash:sha(planRaw),sourceHash:sha(sql),mannHash:sha(mannRaw),rawHash:sha(rawText),anchor,sourceEngineBranches:engines,codeHashes:Object.fromEntries(await Promise.all(codeFiles.map(async f=>[f,sha(await readFile(resolve(root,f),'utf8'))]))),findings,productionApplyAllowed:false,limitation:'Diagnostic exact-engine full-make recheck only; all hybrid branches held, no component aliases or gearbox model facts inferred.'};
await writeFile(resolve(dir,'xtrail-table-recheck-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(findings.map(f=>({id:f.sourceRequirementId,system:f.systemCode,existing:f.existingRevisionIds.length,status:f.decision.status,component:f.component,label:f.sourceLabelContext,targets:f.decision.targets})),null,2));
