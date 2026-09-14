import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,parseCopy} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
import {conditionalVehicleIdentityReasons} from './lib/mann-conditional-vehicle-identity.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const inventoryRaw=await readFile(resolve(dir,'archived-vehicle-configurations-v1.json'),'utf8'),inventory=JSON.parse(inventoryRaw),planRaw=await readFile(resolve(dir,'plan.json'),'utf8');assert.equal(sha(planRaw),inventory.planHash);
const sourceRaw=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');assert.equal(sha(sourceRaw),inventory.sourceHash);
const summary=JSON.parse(await readFile(resolve(root,'outputs/mann-compound-headings-recheck-2026-09-14/summary.json'),'utf8'));
for(const[file,hash]of Object.entries(summary.codeHashes))assert.equal(hash,sha(await readFile(resolve(root,file),'utf8')));
const overlay=await loadIdentityOverlay(root,sourceRaw,summary.identityOverlay.path,summary.identityOverlay.sha256),sources=new Map(overlay.requirements.map(s=>[s.id,s]));
const mannRaw=await readFile('/tmp/mann_filter_applications.sql','utf8');assert.equal(sha(mannRaw),summary.mannHash);const rows=parseCopy(mannRaw,'mann_filter_applications');
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{matchFluidRequirementToMann:match}=await j.import('../src/lib/mann-fluid-matcher-v2.ts');
const {mannMakeFormsForTest:forms}=await j.import('../src/lib/mann-vehicle-resolver.ts'),{normalizeMannText}=await j.import('../src/lib/mann-catalog.ts');
const configurations=new Map(inventory.configurationEvidence.map(c=>[c.id,c])),selected=inventory.findings.filter(f=>f.missingImportedBodyWithExplicitConfiguration);assert.equal(selected.length,28);
const byMake=new Map(),findings=[];
for(const f of selected){
 const original=overlay.originalById.get(f.sourceRequirementId),before=sources.get(f.sourceRequirementId);assert.equal(sha(original),f.sourceHash);
 const config=configurations.get(f.uniqueConfigurationId);assert.ok(config);
 const parsed=/^([A-Z][A-Z0-9]{1,9})(?: \((2WD|4WD)\))?$/.exec(config.bodyLiteral);assert.ok(parsed);
 const body=parsed[1],drive=parsed[2]??config.identity.vehicleConfiguration?.driveType??null;
 const after={...before,bodyCodesJson:[...new Set([...(before.bodyCodesJson??[]),body])]};
 if(!byMake.has(before.make)){const makeForms=forms(before.make);byMake.set(before.make,rows.filter(r=>makeForms.includes(normalizeMannText(r.makeNormalized||r.make))));}
 const oldDecision=match(before,byMake.get(before.make)),decision=match(after,byMake.get(before.make)),top=decision.topCandidates[0],reasons=conditionalVehicleIdentityReasons(after,top);
 if(!top||top.variantIds.length!==1||top.score<80)reasons.push('NOT_UNIQUE_STRONG_TOP_TARGET');
 if(top){reasons.push(...top.hardConflicts);if(decision.topCandidates.slice(1).some(c=>!c.hardConflicts.length&&c.matchedFields.includes('точный код двигателя')&&c.score>=top.score-10))reasons.push('NEARBY_EXACT_ENGINE_ALTERNATIVE');}
 findings.push({sourceRequirementId:f.sourceRequirementId,originalSource:original,sourceHash:f.sourceHash,effectiveBefore:before,effectiveAfter:after,configurationId:config.id,configurationEvidence:config,proposedBody:body,additionalSourceDrive:drive,oldDecision,decision,identityReasons:[...new Set(reasons)],additionalConditionsStillRequireReview:['JSONLD_TABLE_DATE_MARKET_DRIVE_RECONCILIATION','ALL_TARGET_ENGINE_POWER_MONTH_CHECK','TECHNICAL_SOURCE_QUALITY_REVIEW'],publicationAllowed:false});
}
const report={kind:'ARCHIVED_LITERAL_BODY_OFFLINE_PROBE',planHash:sha(planRaw),inventoryHash:sha(inventoryRaw),sourceHash:sha(sourceRaw),mannHash:sha(mannRaw),codeHashes:summary.codeHashes,identityOverlay:overlay.metadata,checked:findings.length,bodyMatchedSources:findings.filter(f=>f.decision.topCandidates[0]?.matchedFields.includes('код кузова')).length,strongIdentitySources:findings.filter(f=>!f.identityReasons.length).length,byModel:Object.fromEntries([...Map.groupBy(findings,f=>f.originalSource.make+' / '+f.originalSource.model)].map(([k,v])=>[k,{sources:v.length,bodyMatched:v.filter(f=>f.decision.topCandidates[0]?.matchedFields.includes('код кузова')).length,strongIdentity:v.filter(f=>!f.identityReasons.length).length}])),findings,productionApplyAllowed:false,limitation:'Virtual addition of exact archived body token only; not a source correction or draft. Explicit drive and other JSON-LD conditions retained for follow-up, not discarded or implicitly satisfied.'};
await writeFile(resolve(dir,'archived-body-evidence-probe-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({...report,findings:undefined,codeHashes:undefined,identityOverlay:undefined}));
