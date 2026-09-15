import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,parseCopy} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),out=resolve(root,'outputs/mann-live-audit-1789415211923');
const drive=process.argv[2]==='v7';
const rearAir=process.argv[2]==='v6';
const version=process.argv[2]??'v1';assert.ok(['v1','v2','v3','v4','v5','v6','v7'].includes(version));const current=version!=='v1',latest=['v3','v4','v5'].includes(version),expanded=['v4','v5'].includes(version),complete=version==='v5';
const planRaw=await readFile(resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14/plan.json'),'utf8');assert.equal(sha(planRaw),drive?'8429d8f48e0c59d049ca04f69b2ee8156ceee4aff03b7b21ef94b6395af9e778':rearAir?'37ffc2703cec30045bf8d524a584ff9b2dbd842e34e6ffed9d81e44da51e1221':complete?'48c9b898379db5afb9f2368b2929d8722bc46c3c4c66ca81fdb21ebe4d7aeaf1':expanded?'2c95b0adc2f9584c4bfedc18d1d6ad59661afc3f9d39b4801e3b3da1a590c0f1':latest?'6b436120dd91f8b1ca909fe1fc51556cdb1906b946c2cccc895e9cc03a18e032':current?'f0ea2b6ece3d08ce654b5d3e3b8d536ca0b419e7f996ee82f2997421f7ac4339':'df04fc11f498bb6e4c48d0b2976e2f01ecc9442ae6fcbc7c3973c7329224c3e5');
const payloadRaw=await readFile(resolve(root,`outputs/mann-gentra-evidence-review-2026-09-14/current-staging-payload-${drive?'v10':rearAir?'v9':complete?'v8':expanded?'v7':latest?'v6':current?'v4':'v2'}.json`),'utf8');assert.equal(sha(payloadRaw),drive?'4358ce77050af9b2644b7ad12fb6905ac3c6f50a0cd909c095ec0a2de9aa15fd':rearAir?'632591070521adeaa0c3a93818fe787bda52a551ca96042c27326f25ee5d6452':complete?'8b718f46a200c20e38c2196ca07d3423a549c4a5601a39ab399640b78a70e710':expanded?'fdc807b615f6992ed77c0975f129f7f33c716b5848d5b55acb19c867bc74514e':latest?'5e03354b16c41c324bb636b26a5ec7663be1bfa5ca64a5f8454592b481a64c77':current?'59f5f376fd44d91ddb8eb6553cff8b6a767423dac4af2188cad3d47edd1a5d7f':'3de76f492d6354cb243b45748270faa4bfa0e8640e25c517983c4cc104b91cf6');
const p=JSON.parse(payloadRaw),liveRaw=await readFile(resolve(out,'canonicalVehicles.json'),'utf8'),live=new Map(JSON.parse(liveRaw).map(v=>[v.variantKey,v]));
const mannRaw=await readFile('/tmp/mann_filter_applications.sql','utf8');assert.equal(sha(mannRaw),p.mannHash);const rows=parseCopy(mannRaw,'mann_filter_applications');
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{splitMannEngineCodeList:split}=await j.import('../src/lib/mann-engine-code-list.ts');
const drafts=[],existing=[];
const positiveInteger=s=>typeof s==='string'&&/^\d+$/.test(s)&&Number(s)>0?Number(s):null;
for(const v of p.variants){
 assert.equal(v.identities.length,1);const identity=v.identities[0],sourceRows=rows.filter(r=>r.vehicleVariantKey===v.vehicleVariantKey);assert.equal(sourceRows.length,v.mannRows);
 const evidence={archivedIdentity:identity,sourceRowHashes:sourceRows.map(r=>r.sourceRowHash),sourceFiles:[...new Set(sourceRows.map(r=>r.sourceFile))],sourceHashes:[...new Set(sourceRows.map(r=>r.sourceHash))]};
 const before=live.get(v.vehicleVariantKey);
 if(before){
  const expected={make:identity.make,model:identity.model,vehicleText:identity.effectiveVehicleText??identity.vehicleText,engineCode:identity.engineCode,modelYears:identity.vehicleYears};
  const differences=Object.entries(expected).filter(([field,value])=>before[field]!==value).map(([field,value])=>({field,current:before[field],archived:value}));
  existing.push({vehicleVariantKey:v.vehicleVariantKey,currentHash:sha(before),original:before,evidence,differences,action:'PRESERVE_EXISTING_REQUIRE_RECONCILIATION_IF_DIFFERENT'});continue;
 }
 const data={variantKey:v.vehicleVariantKey,make:identity.make,makeNormalized:identity.make.toLowerCase(),model:identity.model,modelNormalized:identity.model.toLowerCase(),generation:null,bodyCodesJson:[],modelYears:identity.vehicleYears,yearFrom:identity.vehicleYearFrom,yearTo:identity.vehicleYearTo,vehicleText:identity.effectiveVehicleText??identity.vehicleText,engineCode:identity.engineCode,engineCodeNormalized:identity.engineCode?.toUpperCase()??null,engineCodesJson:split(identity.engineCode??''),engineVolumeCc:null,powerKw:positiveInteger(identity.kw),powerHp:positiveInteger(identity.hp),fuelType:null,driveType:null,transmissionType:null,conditionText:identity.condition,sourceHashesJson:evidence.sourceHashes};
 assert.ok(data.yearFrom===null||data.yearTo===null||data.yearFrom<=data.yearTo);
 drafts.push({vehicleVariantKey:v.vehicleVariantKey,data,canonicalPayloadHash:sha({policy:'ARCHIVED_MANN_PARENT_DRAFT_V1',data}),evidence,notDerived:['Generation/body/displacement/fuel/drive/transmission not inferred from text.','No individual productionMonth: original month range retained verbatim in modelYears.','firstSeenAt/lastSeenAt must be supplied by audited insertion; none fabricated.'],publicationAllowed:false});
}
assert.equal(drafts.length,drive?218:rearAir?217:latest?217:current?213:203);assert.equal(existing.length,drive?325:rearAir?325:expanded?324:312);
const summary={required:drive?543:rearAir?542:expanded?541:latest?529:current?525:515,newParentDrafts:drafts.length,existingPreserved:existing.length,existingLiteralDifferences:existing.filter(r=>r.differences.length).length,differenceFields:Object.fromEntries([...Map.groupBy(existing.flatMap(r=>r.differences),d=>d.field)].map(([k,v])=>[k,v.length]))};
const report={kind:'CANONICAL_PARENT_DRAFTS_AND_EXISTING_RECONCILIATION',planHash:sha(planRaw),payloadHash:sha(payloadRaw),liveVehiclesHash:sha(liveRaw),mannHash:sha(mannRaw),engineParserHash:sha(await readFile(resolve(root,'src/lib/mann-engine-code-list.ts'),'utf8')),summary,drafts,existing,productionApplyAllowed:false,limitations:['New drafts use original MANN text, not guessed generations or aliases.','Existing literal differences require interpretation; they are not proof current rows are wrong.','Vehicle parent metadata does not broaden or replace per-fluid applicability scopes.','No SQL/import, timestamp fabrication or existing-row updates.']};
await writeFile(resolve(out,`canonical-parent-drafts-${version}.json`),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(summary));
