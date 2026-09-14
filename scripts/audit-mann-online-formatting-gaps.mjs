import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const raw=await readFile(resolve(dir,'online-c2029-gap-evidence-v2.json'),'utf8');assert.equal(sha(raw),'d037880f479a5d115cb6b32809b936a12eed20a7722c292f28337b32a590f80f');const audit=JSON.parse(raw);
const sql=await readFile('/tmp/mann_filter_applications.sql','utf8');assert.equal(sha(sql),audit.mannHash);const rows=parseCopy(sql,'mann_filter_applications');assert.equal(rows.length,37600);
assert.equal(sha(await readFile(audit.sourceHtml.path,'utf8')),audit.sourceHtml.sha256);assert.equal(sha(await readFile(resolve(dir,'plan.json'),'utf8')),audit.planHash);
const text=x=>String(x??'').normalize('NFKC').toUpperCase().replace(/\s/g,'');
const label=x=>text(x).replace(/[’'’+\/(),.\-]/g,'');
const dates=x=>text(x).replace(/→|->/g,'-');
// Full literal engine strings; no family aliases or subset-of-engine matching.
const engine=x=>text(x).replace(/[;,]/g,'/');
const signature=r=>JSON.stringify([text(r.make),label(r.model),label(r.vehicleText),engine(r.engineCode),text(r.kw),text(r.hp),dates(r.vehicleYears)]);
const findings=audit.findings.map(f=>{
 const a=f.application,makeRows=rows.filter(r=>text(r.make)===text(a.make)),modelRows=makeRows.filter(r=>label(r.model)===label(a.model));
 const exact=modelRows.filter(r=>signature(r)===signature(a));
 const related=modelRows.filter(r=>engine(r.engineCode)===engine(a.engineCode)&&text(r.kw)===text(a.kw)&&text(r.hp)===text(a.hp));
 const status=f.status==='EXISTING_LITERAL_IDENTITY'?'EXISTING_LITERAL_IDENTITY':exact.length?'FORMATTING_EQUIVALENT_CANDIDATE':!makeRows.length?'LITERAL_MANUFACTURER_HEADING_ABSENT':!modelRows.length?'MODEL_HEADING_NOT_FOUND':related.length?'MODEL_ENGINE_POWER_FOUND_OTHER_ROW_OR_DATES':'NO_SAME_MODEL_ENGINE_POWER';
 return {manufacturerTypeId:a.manufacturerTypeId,originalOnlineApplication:a,previousStatus:f.status,status,
  formattingCandidates:exact.map(r=>({id:r.id,variantKey:r.vehicleVariantKey,originalRow:r})),
  relatedCandidates:exact.length?[]:related.map(r=>({id:r.id,variantKey:r.vehicleVariantKey,originalRow:r})),
  publicationAllowed:false};
});
assert.equal(findings.length,49);assert.equal(new Set(findings.map(f=>f.manufacturerTypeId)).size,49);
const hd=findings.find(f=>f.manufacturerTypeId==='00000000219218');assert.equal(hd.formattingCandidates.length,0);
const a=hd.originalOnlineApplication;for(const field of ['make','model','vehicleText','engineCode','hp','kw','vehicleYears'])assert.notEqual(signature(a),signature({...a,[field]:`${a[field]}X`}),field);
const statusCounts={};for(const f of findings)statusCounts[f.status]=(statusCounts[f.status]??0)+1;
const report={kind:'ONLINE_C2029_FORMATTING_VS_CATALOG_GAPS',auditHash:sha(raw),mannHash:sha(sql),planHash:audit.planHash,checked:findings.length,statusCounts,findings,productionApplyAllowed:false,limitations:['Formatting matches are reconciliation candidates, not permission to merge rows or manufacturer IDs.','Raw names, full engine strings, numeric power and monthly date text are retained for review.','Missing literal manufacturer/model heading may be an alias, not proof of absence.','Single product page only; no fluid applicability inferred from a filter.']};
await writeFile(resolve(dir,'online-formatting-gap-audit-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({...report,findings:undefined}));
