import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha,parseCopy} from './lib/mann-offline-scope.mjs';
const v16=process.argv[2]==='v16';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14'),out=resolve(root,'outputs/mann-live-audit-1789415211923');
const load=async p=>{const raw=await readFile(p,'utf8');return {raw,data:JSON.parse(raw)};};
const old=await load(resolve(out,`canonical-parent-drafts-${v16?'v12':'v11'}.json`)),previous=await load(resolve(dir,`current-staging-payload-${v16?'v15':'v14'}.json`)),payload=await load(resolve(dir,`current-staging-payload-${v16?'v16':'v15'}.json`)),plan=await load(resolve(dir,'plan.json'));
assert.equal(sha(old.raw),v16?'10bfbf685e07bb3a7231cef9f2ed7000bda493487f30787c8d8355418e7bed4c':'2e3d014a180f3e6255207310a525597f5ece19339141630310594661cf049ab9');
assert.equal(sha(previous.raw),old.data.payloadHash);assert.equal(sha(plan.raw),payload.data.planHash);assert.equal(payload.data.planHash,v16?'8055983eb6f96501a987a0742f83ac4e50135664398509f15542e07584a1d1eb':'813977a2654f21eac4510323cd8491eb8be59a5bf8b25c38e15aaea9fad4c444');
const priorIds=new Set(previous.data.revisions.map(r=>r.originalRevision.id));
assert.deepEqual(payload.data.revisions.filter(r=>priorIds.has(r.originalRevision.id)).map(r=>r.originalRevision),previous.data.revisions.map(r=>r.originalRevision));
assert.equal(payload.data.revisions.length-priorIds.size,v16?6:9);
const priorKeys=new Map(previous.data.variants.map(v=>[v.vehicleVariantKey,v]));
for(const v of payload.data.variants.filter(v=>priorKeys.has(v.vehicleVariantKey)))assert.deepEqual(v,priorKeys.get(v.vehicleVariantKey));
const additions=payload.data.variants.filter(v=>!priorKeys.has(v.vehicleVariantKey));
assert.deepEqual(additions.map(v=>v.vehicleVariantKey).sort(),(v16?['e9e3954baeb4d3934dbd0d97eb2041467f5928380634d1a8dd6a345b1ec4fbd3','2e168e7490ea1db60138f2d8b031ce57ad4fc7ee4ce9094f0a49a465995c6a23']:['7053df11bba1111be1eaff16e86343c2dc5e2b3568083c3b4eeaffd818e7da8e','4d586f813cb078a207414c8b9e208b6c937627eadcca00e971f24d24ac38f992','0e310fcb5b622d4f8e6b676ae8bb5237b825cf87a2336a5b7d253bdb6b3d3369']).sort());
const live=await load(resolve(out,'canonicalVehicles.json'));assert.equal(sha(live.raw),old.data.liveVehiclesHash);
const mannRaw=await readFile('/tmp/mann_filter_applications.sql','utf8');assert.equal(sha(mannRaw),old.data.mannHash);const mann=parseCopy(mannRaw,'mann_filter_applications');
const newDrafts=[];
const added=additions.map(v=>{
 const before=live.data.find(r=>r.variantKey===v.vehicleVariantKey);assert.equal(v.identities.length,1);
 const rows=mann.filter(r=>r.vehicleVariantKey===v.vehicleVariantKey);assert.equal(rows.length,v.mannRows);
 const identity=v.identities[0],evidence={archivedIdentity:identity,sourceRowHashes:rows.map(r=>r.sourceRowHash),sourceFiles:[...new Set(rows.map(r=>r.sourceFile))],sourceHashes:[...new Set(rows.map(r=>r.sourceHash))]};
 if(!before){
  assert.ok(v16);assert.equal(v.vehicleVariantKey,'2e168e7490ea1db60138f2d8b031ce57ad4fc7ee4ce9094f0a49a465995c6a23');assert.equal(identity.engineCode,'4B11');
  const positiveInteger=s=>typeof s==='string'&&/^\d+$/.test(s)&&Number(s)>0?Number(s):null;
  const data={variantKey:v.vehicleVariantKey,make:identity.make,makeNormalized:identity.make.toLowerCase(),model:identity.model,modelNormalized:identity.model.toLowerCase(),generation:null,bodyCodesJson:[],modelYears:identity.vehicleYears,yearFrom:identity.vehicleYearFrom,yearTo:identity.vehicleYearTo,vehicleText:identity.effectiveVehicleText??identity.vehicleText,engineCode:identity.engineCode,engineCodeNormalized:identity.engineCode,engineCodesJson:['4B11'],engineVolumeCc:null,powerKw:positiveInteger(identity.kw),powerHp:positiveInteger(identity.hp),fuelType:null,driveType:null,transmissionType:null,conditionText:identity.condition,sourceHashesJson:evidence.sourceHashes};
  assert.ok(data.yearFrom===null||data.yearTo===null||data.yearFrom<=data.yearTo);
  newDrafts.push({vehicleVariantKey:v.vehicleVariantKey,data,canonicalPayloadHash:sha({policy:'ARCHIVED_MANN_PARENT_DRAFT_V1',data}),evidence,notDerived:['Generation/body/displacement/fuel/drive/transmission not inferred from text.','No individual productionMonth: original month range retained verbatim in modelYears.','firstSeenAt/lastSeenAt must be supplied by audited insertion; none fabricated.'],publicationAllowed:false});return null;
 }
 const expected={make:identity.make,model:identity.model,vehicleText:identity.effectiveVehicleText??identity.vehicleText,engineCode:identity.engineCode,modelYears:identity.vehicleYears};
 const differences=Object.entries(expected).filter(([field,value])=>before[field]!==value).map(([field,value])=>({field,current:before[field],archived:value}));assert.deepEqual(differences,[]);
 return {vehicleVariantKey:v.vehicleVariantKey,currentHash:sha(before),original:before,evidence,differences,action:'PRESERVE_EXISTING_REQUIRE_RECONCILIATION_IF_DIFFERENT'};
}).filter(Boolean);
const report={...old.data,planHash:sha(plan.raw),payloadHash:sha(payload.raw),summary:{...old.data.summary,required:v16?552:550,newParentDrafts:v16?221:220,existingPreserved:v16?331:330},drafts:[...old.data.drafts,...newDrafts],existing:[...added,...old.data.existing],extensionEvidence:{parentReportHash:sha(old.raw),priorPayloadHash:sha(previous.raw),existingParentsPreserved:added.map(v=>v.vehicleVariantKey),newParentKeys:newDrafts.map(v=>v.vehicleVariantKey)}};
assert.equal(report.drafts.length,v16?221:220);assert.equal(report.existing.length,v16?331:330);assert.equal(new Set([...report.drafts,...report.existing].map(r=>r.vehicleVariantKey)).size,v16?552:550);
await writeFile(resolve(out,`canonical-parent-drafts-${v16?'v13':'v12'}.json`),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({...report.summary,payloadHash:report.payloadHash,newParentCount:newDrafts.length}));
