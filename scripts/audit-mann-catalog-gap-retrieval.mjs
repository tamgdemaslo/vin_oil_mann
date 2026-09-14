import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,parseCopy} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-whole-source-current-recheck-2026-09-14'),parent=resolve(root,'outputs/mann-type-count-added-preview-2026-09-14');
const planRaw=await readFile(resolve(parent,'plan.json'),'utf8'),coverageRaw=await readFile(resolve(parent,'full-source-coverage.json'),'utf8'),coverage=JSON.parse(coverageRaw);assert.equal(sha(planRaw),coverage.planHash);
assert.equal(sha(planRaw),'5d860f8615a07175105a0b3a8c2a0a30d92abe72523925bb2921efc1754c0221');
const sql=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),mann=await readFile('/tmp/mann_filter_applications.sql','utf8'),summary=JSON.parse(await readFile(resolve(dir,'summary.json'),'utf8'));assert.equal(sha(sql),coverage.sourceHash);assert.equal(sha(mann),summary.mannHash);
for(const [file,hash]of Object.entries(summary.codeHashes))assert.equal(hash,sha(await readFile(resolve(root,file),'utf8')));
const overlay=await loadIdentityOverlay(root,sql,summary.identityOverlay.path,summary.identityOverlay.sha256),sources=new Map(overlay.requirements.map(s=>[s.id,s])),rows=parseCopy(mann,'mann_filter_applications');
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{mannMakeFormsForTest:formsOf,diagnoseMannCandidatesForTest:diagnose}=await j.import('../src/lib/mann-vehicle-resolver.ts'),{normalizeFluidRequirementVehicle:normalize}=await j.import('../src/lib/mann-fluid-matcher-v2.ts'),{normalizeMannText}=await j.import('../src/lib/mann-catalog.ts');
const selected=coverage.rows.filter(r=>r.status==='MANN_CATALOG_GAP');assert.equal(selected.length,1410);
const byMake=new Map(),inventories=[],findings=[];
for(const c of selected){
 const s=sources.get(c.requirementId);assert.ok(s);const vehicle=normalize(s);assert.ok(vehicle);
 if(!byMake.has(vehicle.canonicalMake)){
  const forms=formsOf(vehicle.canonicalMake),makeRows=rows.filter(r=>forms.includes(normalizeMannText(r.makeNormalized||r.make)));byMake.set(vehicle.canonicalMake,makeRows);
  inventories.push({make:vehicle.canonicalMake,forms,rowCount:makeRows.length,variantCount:new Set(makeRows.map(r=>r.vehicleVariantKey)).size,models:[...new Set(makeRows.map(r=>r.model))].sort(),targetRowIds:makeRows.map(r=>r.id)});
 }
 const makeRows=byMake.get(vehicle.canonicalMake),diagnostic=makeRows.length?diagnose(vehicle,makeRows):null;
 const status=!makeRows.length?'NO_BRAND_ROWS_IN_SNAPSHOT':!diagnostic.retrievedCount?'NO_MODEL_RETRIEVAL':!diagnostic.rankedCandidates.length?'RETRIEVED_BUT_ALL_REJECTED':'CURRENT_RETRIEVAL_HAS_CANDIDATES';
 findings.push({sourceRequirementId:s.id,originalSource:overlay.originalById.get(s.id),effectiveVehicle:vehicle,make:vehicle.canonicalMake,status,sourceHash:sha(overlay.originalById.get(s.id)),makeRowCount:makeRows.length,retrievedCount:diagnostic?.retrievedCount??0,rankedCandidates:diagnostic?.rankedCandidates??[],rejected:diagnostic?.rejected??[],publicationAllowed:false});
 if(findings.length%250===0)console.log(JSON.stringify({processed:findings.length,total:selected.length}));
}
assert.equal(new Set(findings.map(f=>f.sourceRequirementId)).size,selected.length);
const report={planHash:sha(planRaw),coverageHash:sha(coverageRaw),sourceHash:sha(sql),mannHash:sha(mann),identityOverlay:overlay.metadata,checked:findings.length,statusCounts:Object.fromEntries([...Map.groupBy(findings,f=>f.status)].map(([k,v])=>[k,v.length])),byMake:Object.fromEntries([...Map.groupBy(findings,f=>f.make)].map(([k,v])=>[k,v.length])),inventories,findings,productionApplyAllowed:false,limitation:'Rechecks every current coverage catalog-gap row against current frozen retrieval. Missing model retrieval does not prove no equivalent vehicle exists; candidates still need full fluid identity/condition/OEM checks. This does not cover the separate unresolved-match queue.'};
await writeFile(resolve(dir,'catalog-gap-retrieval-audit-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({checked:report.checked,statusCounts:report.statusCounts,byMake:report.byMake}));
