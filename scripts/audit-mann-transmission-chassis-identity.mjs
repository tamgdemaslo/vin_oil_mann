import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-nissan-xtrail-cvt-list-preview-2026-09-14');
const [sql,mannRaw,planRaw]=await Promise.all([readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),readFile('/tmp/mann_filter_applications.sql','utf8'),readFile(resolve(dir,'plan.json'),'utf8')]);
const plan=JSON.parse(planRaw),overlay=await loadIdentityOverlay(root,sql,resolve(root,'outputs/mann-identity-scoped-2026-09-14/source-identity-corrections.json')),sources=new Map(overlay.requirements.map(r=>[r.id,r])),variants=Map.groupBy(parseCopy(mannRaw,'mann_filter_applications'),r=>r.vehicleVariantKey);
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{matchFluidRequirementToMann:match}=await jiti.import('../src/lib/mann-fluid-matcher-v2.ts');
const results=[];
for(const revision of plan.newRevisions.filter(r=>r.provenanceJson.conditionalTransmissionPolicy)){
 const source=sources.get(revision.sourceRequirementId),target=variants.get(revision.vehicleVariantKey),scope=revision.applicabilityJson;assert.ok(source&&target?.length);
 const scoped={...source,engineCodesJson:scope.matchedEngineScope??source.engineCodesJson,engineCodeNormalized:scope.matchedEngineScope?.[0]??source.engineCodeNormalized,...scope.window?.narrowedYears};
 // Destination-only rerun isolates chassis evidence. This is NOT a full-make rematch.
 const decision=match(scoped,target),candidate=decision.topCandidates.find(c=>c.variantIds.includes(revision.vehicleVariantKey)),explicit=Boolean(source.generation||source.bodyCodesJson?.length);
 const hasIdentity=candidate?.matchedFields.some(f=>f==='поколение'||f==='код кузова')??false;
 const stored=revision.provenanceJson.independentValidation?.matchedFields??[];
 results.push({revisionId:revision.id,revisionHash:sha(revision),sourceRequirementId:source.id,sourceHash:sha(overlay.originalById.get(source.id)),vehicleVariantKey:revision.vehicleVariantKey,sourceIdentity:{make:source.make,model:source.model,generation:source.generation,bodyCodes:source.bodyCodesJson},storedChassisEvidence:stored.filter(f=>f==='поколение'||f==='код кузова'),currentMatchedFields:candidate?.matchedFields??[],currentCandidate:candidate??null,explicitChassisRequired:explicit,status:!candidate?'DESTINATION_NOT_RETRIEVED':explicit&&!hasIdentity?'MISSING_EXPLICIT_CHASSIS_IDENTITY':'CHASSIS_IDENTITY_GATE_PASSED',publicationAllowed:false});
}
const report={planHash:sha(planRaw),sourceHash:sha(sql),mannHash:sha(mannRaw),codeHashes:Object.fromEntries(await Promise.all(['src/lib/mann-fluid-matcher-v2.ts','src/lib/mann-vehicle-resolver.ts','src/lib/mann-engine-code-list.ts','scripts/audit-mann-transmission-chassis-identity.mjs'].map(async f=>[f,sha(await readFile(resolve(root,f),'utf8'))]))),summary:{reviewed:results.length,byStatus:Object.fromEntries([...Map.groupBy(results,r=>r.status)].map(([k,v])=>[k,v.length]))},results,productionApplyAllowed:false,limitation:'Independent destination-only chassis gate audit, no full-make ranking or full technical validity claim. Missing chassis evidence requires holding/rechecking the record, not inferring generation from dates.'};
await writeFile(resolve(dir,'transmission-chassis-identity-audit-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report.summary));
