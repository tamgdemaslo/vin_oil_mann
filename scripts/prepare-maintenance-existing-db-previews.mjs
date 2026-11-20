/** Offline, no-network proposal builder from read-only Timeweb snapshots. Never applies. */
import {readFile,writeFile} from 'node:fs/promises';import {resolve} from 'node:path';import {createJiti} from 'jiti';
import {sha,applicabilityWindow,originalAssociationFingerprint} from './lib/mann-offline-scope.mjs';
import {existingFluidPreview,EXISTING_FLUID_PREVIEW_POLICY} from './lib/maintenance-existing-fluid-preview.mjs';
const root=resolve(import.meta.dirname,'..'),directory=resolve(process.argv[2]??'/tmp/maintenance-vin-batch');
const load=async p=>JSON.parse(await readFile(p,'utf8'));
const [saved,catalog,input,deny]=await Promise.all([load('/tmp/maintenance-existing-fluids.json'),load(resolve(directory,'mann-current-catalog.json')),load(resolve(directory,'matched-600.json')),load(resolve(root,'data/mann-technical-association-denylist-v1.json'))]);
if(!saved.readOnly||!catalog.readOnly)throw new Error('Read-only snapshots required');
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {matchFluidRequirementToMann:match}=await j.import('../src/lib/mann-fluid-matcher-v2.ts');
const {mannMakeFormsForTest:forms}=await j.import('../src/lib/mann-vehicle-resolver.ts');
const {normalizeMannText:norm}=await j.import('../src/lib/mann-catalog.ts');
const {normalizeEngineCode:engine}=await j.import('../src/lib/vehicle-normalization.ts');
const {splitMannEngineCodeList:split}=await j.import('../src/lib/mann-engine-code-list.ts');
const {parseFluidCapacities:parse}=await j.import('../src/lib/fluid-capacity-parser.ts');
const {buildMannUnifiedTechnicalProfile:profile}=await j.import('../src/lib/mann-unified-technical-profile.ts');
const keys=new Set(input.results.flatMap(r=>r.variantKeys??[])),sources=new Map(saved.requirements.map(r=>[r.id,r])),cache=new Map(),proposals=[],held=[];
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw new Error('Network forbidden in existing DB preview');};
try{for(const link of saved.links.filter(l=>keys.has(l.mannVariantKey)&&!/(?:AI|MANUAL)_SELECTED_MANN_RESEARCH/.test(l.matchMethod))){
 const r=sources.get(link.requirementId);if(!r)throw new Error('Missing source requirement');
 const rows=catalog.rows.filter(x=>x.vehicleVariantKey===link.mannVariantKey),makeForms=new Set(forms(r.make).map(norm));
 if(!cache.has(r.id))cache.set(r.id,match(r,catalog.rows.filter(x=>makeForms.has(norm(x.makeNormalized||x.make)))));
 const decision=cache.get(r.id),capacity=parse(r.fillVolumeText,r.systemCode),windows=rows.map(row=>applicabilityWindow(r,row));
 const window=windows.length&&windows.every(w=>w&&sha(w)===sha(windows[0]))?windows[0]:null;
 const targetEngines=new Set(rows.flatMap(row=>split(row.engineCode).map(engine)));
 const engineScope=[...new Set([r.engineCodeNormalized,...(Array.isArray(r.engineCodesJson)?r.engineCodesJson:[])].filter(Boolean).map(engine).filter(e=>e&&targetEngines.has(e)))];
 const fingerprint=originalAssociationFingerprint(link.mannVariantKey,r,capacity);
 const result=existingFluidPreview({requirement:r,variantKey:link.mannVariantKey,decision,capacity,window,engineScope,sourceFingerprint:fingerprint,denied:deny.rejectedAssociationFingerprints.includes(fingerprint),existing:saved.revisions.some(x=>x.sourceRequirementId===r.id&&x.vehicleVariantKey===link.mannVariantKey)});
 if(result.revision){const runtime={...result.revision,createdAt:new Date(),reviewConfirmed:false,run:{status:'COMPLETED',mode:'STAGING',independentHumanSignoff:false,productionApplyAuthorized:false,gatesJson:{catalogPreviewPolicy:EXISTING_FLUID_PREVIEW_POLICY,automaticProductSelection:false}}};
 const relevant=input.results.filter(x=>x.variantKeys?.includes(link.mannVariantKey)),shown=relevant.filter(x=>profile([runtime],undefined,x.vehicleContext).items.some(i=>i.revisionId===runtime.id));
 proposals.push({...result.revision,validation:{affectedMatchedVins:relevant.length,currentlyApplicableVins:shown.length,automaticSelectionEligible:false}});
 }else held.push({sourceRequirementId:r.id,vehicleVariantKey:link.mannVariantKey,systemCode:r.systemCode,reasons:result.reasons,decisionStatus:decision.status,target:decision.targets.find(t=>t.vehicleVariantKey===link.mannVariantKey)??null,reviewReasons:decision.reviewReasons,topCandidates:decision.topCandidates.slice(0,2)});
}}finally{globalThis.fetch=originalFetch;}
const report={kind:'EXISTING_DB_ONLY_MAINTENANCE_PREVIEW_PROPOSALS',createdAt:new Date().toISOString(),sourceSnapshotHash:sha(saved),catalogSnapshotHash:sha(catalog),inputHash:sha(input),applyAllowed:false,newResearchRequests:0,run:{mode:'STAGING',status:'COMPLETED',independentHumanSignoff:false,productionApplyAuthorized:false,gatesJson:{catalogPreviewPolicy:EXISTING_FLUID_PREVIEW_POLICY,automaticProductSelection:false}},summary:{matchedVins:input.results.filter(x=>x.variantKeys?.length).length,variants:keys.size,pairs:proposals.length+held.length,proposals:proposals.length,held:held.length,currentlyApplicablePairs:proposals.filter(x=>x.validation.currentlyApplicableVins).length},proposals,held};await writeFile(resolve(directory,'existing-db-preview-proposals.json'),JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify(report.summary));
