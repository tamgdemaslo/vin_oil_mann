import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14'),pdfDir=resolve(root,'tmp/pdfs/volvo-fuel-evidence-2026-09-14');
const auditRaw=await readFile(resolve(dir,'volvo-source-fuel-audit-v1.json'),'utf8');assert.equal(sha(auditRaw),'a38bd76bd6f6e2997a449f2aa266bf63fee8221116e91c386cf7a143bf358897');const audit=JSON.parse(auditRaw);
const oldManifest=JSON.parse(await readFile(resolve(pdfDir,'manifest.json'),'utf8'));
// The original fetch manifest used JSON-serialized Buffer hashing. Recompute
// actual PDF byte hashes here; old metadata is retained, never trusted as bytes.
const documents=[];
for(const old of oldManifest){const bytes=await readFile(old.path);documents.push({id:old.id,url:old.url,path:old.path,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length});}
const facts=[
 ...['s40','v50'].flatMap(model=>[
  {model,engineCode:'D4162T',label:'D2 / DRIVe'},
  {model,engineCode:'D5204T5',label:'D3'},
  {model,engineCode:'D5204T',label:'D4'}
 ].map(f=>({...f,fuel:'diesel',documentId:model+'-my12',modelYear:2012,printedEnginePage:model==='s40'?285:291,printedFuelPage:model==='s40'?290:296,marketNote:'Not all engines available in all markets',visuallyReviewed:true}))),
 ...[['D4164T','1.6D'],['D4204T','2.0D'],['D5244T8','D5'],['D5244T9','D5']].map(([engineCode,label])=>({model:'v50',engineCode,label,fuel:'diesel',documentId:'v50-my10',modelYear:2010,printedEnginePage:266,printedFuelPage:273,marketNote:engineCode==='D5244T9'?'Belgium only':'No per-engine market footnote in inspected table',visuallyReviewed:true}))
];
const anchorAssessments=audit.anchors.map(a=>{
 const model=a.sourceUrl.includes('/s40/')?'s40':'v50';
 const codes=[...new Set([...a.application.matchAll(/\((D\d{3,4}[TS]\d*)\)/gu)].map(m=>m[1]))];assert.ok(codes.length);
 const evidence=codes.map(code=>({code,fact:facts.find(f=>f.model===model&&f.engineCode===code)??null}));
 return {...a,exactSourceCodes:codes,evidence,allCodesHaveFuelEvidence:evidence.every(e=>e.fact),marketReviewRequired:evidence.some(e=>e.fact?.marketNote==='Belgium only'),correctedFuel:evidence.every(e=>e.fact)?'diesel':null};
});
const byAnchor=new Map(anchorAssessments.map(a=>[a.sourceRowId,a]));
const proposals=audit.affected.map(s=>{
 const anchors=s.anchorIds.map(id=>{const a=byAnchor.get(id);assert.ok(a);return a;});
 const supported=anchors.every(a=>a.allCodesHaveFuelEvidence);
 return {...s,status:supported?'FUEL_CORRECTION_CANDIDATE':'MISSING_EXACT_CODE_EVIDENCE',before:{fuelType:s.parsedFuel},after:supported?{fuelType:'diesel'}:null,evidenceAnchorIds:anchors.map(a=>a.sourceRowId),marketReviewRequired:anchors.some(a=>a.marketReviewRequired),apply:false};
});
const summary={manuals:documents.length,exactModelEngineFuelFacts:facts.length,anchorsFullySupported:anchorAssessments.filter(a=>a.allCodesHaveFuelEvidence).length,correctionCandidates:proposals.filter(p=>p.after).length,remainingEvidenceGaps:proposals.filter(p=>!p.after).length,marketReviewCandidates:proposals.filter(p=>p.after&&p.marketReviewRequired).length};
await writeFile(resolve(dir,'volvo-fuel-exact-evidence-v1.json'),JSON.stringify({kind:'VOLVO_EXACT_MODEL_ENGINE_FUEL_EVIDENCE',auditHash:sha(auditRaw),planHash:audit.planHash,documents,facts,anchorAssessments,proposals,summary,productionApplyAllowed:false,limitations:['Fuel facts only. Manual model years are evidence dates, not a grant of applicability across all source production years.','Only full source-anchor code coverage qualifies a correction candidate; unproven codes prevent table-wide propagation.','Fuel correction candidates are not yet wired into importer or canonical revisions. Market/year/component/technical fluid checks remain separate.']},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(summary));
