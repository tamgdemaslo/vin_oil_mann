import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
import {conditionalVehicleIdentityReasons} from './lib/mann-conditional-vehicle-identity.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-transmission-chassis-held-preview-2026-09-14');
const [raw,sql,mannRaw,evidenceRaw]=await Promise.all([readFile(resolve(dir,'plan.json'),'utf8'),readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),readFile('/tmp/mann_filter_applications.sql','utf8'),readFile(resolve(dir,'held-chassis-csv-evidence-v1.json'),'utf8')]);
const plan=JSON.parse(raw),evidence=JSON.parse(evidenceRaw);assert.equal(evidence.planHash,sha(raw));assert.equal(evidence.mannHash,sha(mannRaw));
const overlay=await loadIdentityOverlay(root,sql,resolve(root,'outputs/mann-identity-scoped-2026-09-14/source-identity-corrections.json')),sources=new Map(overlay.requirements.map(r=>[r.id,r]));
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{matchFluidRequirementToMann:match}=await jiti.import('../src/lib/mann-fluid-matcher-v2.ts'),{mannMakeFormsForTest}=await jiti.import('../src/lib/mann-vehicle-resolver.ts'),{normalizeMannText}=await jiti.import('../src/lib/mann-catalog.ts');
const forms=new Set(mannMakeFormsForTest('HYUNDAI')),rows=parseCopy(mannRaw,'mann_filter_applications').filter(r=>forms.has(normalizeMannText(r.makeNormalized||r.make))),variants=Map.groupBy(rows,r=>r.vehicleVariantKey),results=[];
for(const finding of evidence.findings.filter(f=>f.bodyCodeHits.length)){
 const held=plan.transmissionIdentityHeld.find(h=>h.revision.id===finding.revisionId);assert.ok(held);const r=held.revision,source=sources.get(r.sourceRequirementId);assert.equal(source.make,'hyundai');assert.equal(source.model,'solaris');
 const scoped={...source,engineCodesJson:r.applicabilityJson.matchedEngineScope,engineCodeNormalized:r.applicabilityJson.matchedEngineScope[0],...r.applicabilityJson.window.narrowedYears};
 const decision=match(scoped,rows),candidate=decision.topCandidates[0],reasons=conditionalVehicleIdentityReasons(scoped,candidate);
 if(!candidate||candidate.variantIds.length!==1||candidate.variantIds[0]!==r.vehicleVariantKey||candidate.score<80)reasons.push('NOT_UNIQUE_STRONG_TARGET');
 if(candidate){reasons.push(...candidate.hardConflicts,...candidate.reviewBlockers.filter(b=>b!=='MANN variant не подтверждает тип или модель коробки'));if(candidate.reviewBlockers.length!==1||candidate.reviewBlockers[0]!=='MANN variant не подтверждает тип или модель коробки')reasons.push('NOT_SOLE_GEARBOX_BLOCKER');if(decision.topCandidates.slice(1).some(c=>!c.hardConflicts.length&&c.matchedFields.includes('точный код двигателя')&&c.score>=candidate.score-10))reasons.push('NEARBY_EXACT_ENGINE_ALTERNATIVE');}
 const target=variants.get(r.vehicleVariantKey);assert.ok(target?.length);if(!Number.isFinite(source.powerHp)||target.some(t=>String(t.hp??'').trim()!==String(source.powerHp)))reasons.push('SOURCE_TARGET_POWER_REVIEW');
 results.push({revisionId:r.id,revisionHash:sha(r),sourceRequirementId:source.id,sourceHash:sha(held.originalSource),sourcePowerHp:source.powerHp,targetPowerHp:[...new Set(target.map(t=>t.hp))],reasons:[...new Set(reasons)],decision,archiveEvidence: finding.bodyCodeHits,publicationAllowed:false});
}
assert.equal(results.length,5);
const report={planHash:sha(raw),sourceHash:sha(sql),mannHash:sha(mannRaw),archiveEvidenceHash:sha(evidenceRaw),codeHashes:Object.fromEntries(await Promise.all(['scripts/recheck-mann-solaris-held-identity.mjs','scripts/lib/mann-conditional-vehicle-identity.mjs','src/lib/mann-vehicle-resolver.ts','src/lib/mann-fluid-matcher-v2.ts'].map(async f=>[f,sha(await readFile(resolve(root,f),'utf8'))]))),summary:{checked:results.length,chassisNowMatched:results.filter(r=>r.decision.topCandidates[0]?.matchedFields.includes('код кузова')).length,withoutRecheckBlockers:results.filter(r=>!r.reasons.length).length},results,productionApplyAllowed:false,limitation:'No restoration yet. Model/engine/power/date ranking recheck only; original technical conditions and safe restore history still need verification.'};
await writeFile(resolve(dir,'solaris-held-identity-recheck-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({summary:report.summary,results:results.map(r=>({id:r.revisionId,sourcePower:r.sourcePowerHp,targetPower:r.targetPowerHp,reasons:r.reasons}))}));
