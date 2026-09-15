import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,parseCopy,applicabilityWindow} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const auditRaw=await readFile(resolve(dir,'replacement-scope-transition-v1.json'),'utf8'),audit=JSON.parse(auditRaw);
const planRaw=await readFile(resolve(dir,'plan.json'),'utf8');assert.equal(sha(planRaw),audit.planHash);
const mannRaw=await readFile('/tmp/mann_filter_applications.sql','utf8');assert.equal(sha(mannRaw),'5e34efadc60014077b55655e0c62cdcbb8b1f44d3a8aace2399e941b45003fda');
const mann=parseCopy(mannRaw,'mann_filter_applications');
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{splitMannEngineCodeList:split}=await j.import('../src/lib/mann-engine-code-list.ts');
const index=s=>Number(s.slice(0,4))*12+Number(s.slice(5))-1;
const stamp=m=>`${Math.floor(m/12)}-${String(m%12+1).padStart(2,'0')}`;
const norm=s=>s.trim().toUpperCase();
const findings=audit.findings.map(f=>{
 const rows=mann.filter(r=>r.vehicleVariantKey===f.vehicleVariantKey);assert.ok(rows.length);
 const windows=rows.map(r=>applicabilityWindow({yearFrom:1886,yearTo:2100},r)?.mann);assert.ok(windows.every(Boolean));
 const engines=[...new Set(rows.flatMap(r=>split(r.engineCode)).map(norm).filter(Boolean))];
 const excludedMonths=f.uncoveredDateEnvelopes.flatMap(w=>Array.from({length:index(w.to)-index(w.from)+1},(_,i)=>index(w.from)+i));
 const dateReasons={outsideMann:[],insideMannRequiresSourceEvidence:[]};
 for(const m of excludedMonths){const inside=windows.some(w=>(!w.from||m>=index(w.from))&&(!w.to||m<=index(w.to)));dateReasons[inside?'insideMannRequiresSourceEvidence':'outsideMann'].push(stamp(m));}
 const engineReasons=f.oldEngineTokensNotInNew.map(token=>{
  const parts=[...new Set(split(token).map(norm).filter(Boolean))],newSet=new Set(f.newEngineTokens.map(norm));
  const notInNew=parts.filter(p=>!newSet.has(p)),inMann=notInNew.filter(p=>engines.includes(p));
  return {token,expandedParts:parts,partsNotInNew:notInNew,partsStillInMann:inMann,status:!notInNew.length?'LIST_REPRESENTATION_ONLY':!inMann.length?'EXCLUDED_PARTS_NOT_LISTED_FOR_THIS_MANN_VARIANT':'SOURCE_BRANCH_EVIDENCE_REQUIRED'};
 });
 return {revisionId:f.revisionId,sourceRequirementId:f.sourceRequirementId,vehicleVariantKey:f.vehicleVariantKey,mannRowHashes:rows.map(r=>r.sourceRowHash),mannWindows:windows,mannEngineTokens:engines,dateReasons,engineReasons};
});
const summary={checked:findings.length,dateNarrowed:findings.filter(f=>f.dateReasons.outsideMann.length||f.dateReasons.insideMannRequiresSourceEvidence.length).length,dateEntirelyOutsideMann:findings.filter(f=>f.dateReasons.outsideMann.length&&!f.dateReasons.insideMannRequiresSourceEvidence.length).length,dateNeedsSourceEvidence:findings.filter(f=>f.dateReasons.insideMannRequiresSourceEvidence.length).length,engineExcludedRows:findings.filter(f=>f.engineReasons.length).length,engineOnlyRepresentationRows:findings.filter(f=>f.engineReasons.length&&f.engineReasons.every(e=>e.status==='LIST_REPRESENTATION_ONLY')).length,engineNeedsSourceEvidenceRows:findings.filter(f=>f.engineReasons.some(e=>e.status==='SOURCE_BRANCH_EVIDENCE_REQUIRED')).length};
const report={kind:'REPLACEMENT_SCOPE_EXCLUSION_MANN_EVIDENCE',auditHash:sha(auditRaw),planHash:sha(planRaw),mannHash:sha(mannRaw),engineParserHash:sha(await readFile(resolve(root,'src/lib/mann-engine-code-list.ts'),'utf8')),summary,findings,productionApplyAllowed:false,limitations:['Catalog exclusion explains this variant only; it does not prove a fluid unsuitable for other variants.','MANN is vehicle identity evidence, not independent approval of fluid specifications.','Inside-MANN exclusions need source-branch/date evidence before replacement readiness.','No automatic re-expansion, alias invention or production writes.']};
await writeFile(resolve(dir,'replacement-scope-exclusion-evidence-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(summary));
