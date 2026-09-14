#!/usr/bin/env node
// Recompute target eligibility from original SQL, not stored validation flags.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createJiti } from 'jiti';
import { parseCopy, sha, applicabilityWindow, originalAssociationFingerprint } from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
const root=resolve(import.meta.dirname,'..');
const args=process.argv.slice(2);
assert.ok(args.length===1 || (args.length===2 && args[1]==='--partial'), 'Usage: replay-mann-scoped-proposals.mjs output-directory [--partial]');
const directory=resolve(root,args[0]),partial=args[1]==='--partial';
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {matchFluidRequirementToMann}=await jiti.import('../src/lib/mann-fluid-matcher-v2.ts');
const {parseFluidCapacities}=await jiti.import('../src/lib/fluid-capacity-parser.ts');
const {normalizeEngineCode}=await jiti.import('../src/lib/vehicle-normalization.ts');
const [mannRaw,fluidRaw]=await Promise.all([readFile('/tmp/mann_filter_applications.sql','utf8'),readFile('/tmp/vehicle_fluid_requirements.sql','utf8')]);
const variants=Map.groupBy(parseCopy(mannRaw,'mann_filter_applications'),r=>r.vehicleVariantKey);
const summary=partial ? null : JSON.parse(await readFile(resolve(directory,'summary.json'),'utf8'));
if(partial){
  // A corrected run must finish before replay: its final manifest is required.
  const {access}=await import('node:fs/promises');
  let corrected=false;try{await access(resolve(directory,'source-identity-corrections.json'));corrected=true;}catch{}
  assert.equal(corrected,false,'Corrected run requires completed summary and full replay');
}
const overlay=await loadIdentityOverlay(root,fluidRaw,summary?.identityCorrections?.path,summary?.identityCorrections?.sha256);
const requirements=new Map(overlay.requirements.map(r=>[r.id,r]));
const denied=new Set(JSON.parse(await readFile(resolve(root,'data/mann-technical-association-denylist-v1.json'),'utf8')).rejectedAssociationFingerprints);
const inputFiles=partial?['part-0.ndjson','part-1.ndjson','part-2.ndjson']:['decisions.ndjson'];
const inputHashes={},seen=new Set(),issues=[];let proposals=0;
for(const file of inputFiles){
  const raw=await readFile(resolve(directory,file),'utf8');
  // A live writer may have emitted part of its last line. Never parse that tail.
  const complete=raw.slice(0,raw.lastIndexOf('\n')+1);inputHashes[file]=sha(complete);
  for(const line of complete.trim().split('\n').filter(Boolean)){
    const decision=JSON.parse(line),r=requirements.get(decision.requirementId);
    assert.ok(r && !seen.has(r.id));seen.add(r.id);
    for(const p of decision.proposals){
      proposals++;
      try{
        const rows=variants.get(p.vehicleVariantKey);assert.ok(rows?.length);
        assert.equal(p.publicationAllowed,false);
        assert.equal(p.requiresSourceTechnicalReview,true);
        const capacity=parseFluidCapacities(r.fillVolumeText,r.systemCode);
        assert.equal(capacity.needsReview,false);assert.deepEqual(capacity,decision.capacity);
        assert.ok(r.specificationText?.trim() || r.specificationsJson?.length);
        const fingerprint=originalAssociationFingerprint(p.vehicleVariantKey,overlay.originalById.get(r.id),capacity);
        assert.equal(fingerprint,p.originalAssociationFingerprint);assert.ok(!denied.has(fingerprint));
        const engines=[...new Set([r.engineCodeNormalized,...(r.engineCodesJson??[])].filter(Boolean))];
        assert.deepEqual(p.originalApplicability.engineCodes,engines);
        for(const row of rows)assert.deepEqual(applicabilityWindow(r,row),p.window);
        let scopedRequirement={...r,...p.window.narrowedYears};
        if(p.matchedEngineScope!=null){
          assert.equal(p.matchedEngineScope.length,1);
          const code=p.matchedEngineScope[0];
          assert.ok(engines.map(normalizeEngineCode).includes(code));
          assert.ok(!/^(?:2WD|4WD|AWD|FWD|RWD|4X4|4X2)$/.test(code));
          for(const row of rows)assert.ok(String(row.engineCode??'').split(/[;,/|]+/).map(normalizeEngineCode).includes(code));
          scopedRequirement={...scopedRequirement,engineCodeNormalized:code,engineCodesJson:[code]};
        }
        const replay=matchFluidRequirementToMann(scopedRequirement,rows);
        assert.ok(['CONFIRMED_SINGLE','CONFIRMED_MULTI_APPLICABILITY'].includes(replay.status),`replay status ${replay.status}`);
        const target=replay.targets.find(t=>t.vehicleVariantKey===p.vehicleVariantKey);
        assert.ok(target?.independentlyValidated);assert.deepEqual(target.hardConflicts,[]);assert.deepEqual(target.reviewBlockers,[]);
        if(engines.length)assert.ok(target.matchedFields.includes('точный код двигателя'));
      }catch(error){issues.push({requirementId:r.id,vehicleVariantKey:p.vehicleVariantKey,error:error.message});}
    }
  }
}
if(!partial)assert.equal(seen.size,requirements.size);
const report={kind:'INDEPENDENT_SOURCE_TARGET_REPLAY',partial,publicationAllowed:false,
  limitation:'Target-only replay does not independently repeat global candidate ranking or confirm OEM technical data.',
  sourceHashes:{mann:sha(mannRaw),fluids:sha(fluidRaw)},inputHashes,
  requirements:seen.size,proposals,issues,issueCount:issues.length,generatedAt:new Date().toISOString()};
const name=partial?`target-replay-partial-${Date.now()}.json`:'target-replay.json';
await writeFile(resolve(directory,name),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report,null,2));if(issues.length)process.exitCode=1;
