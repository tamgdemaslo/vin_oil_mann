import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha} from './mann-offline-scope.mjs';

// Only identity fields are replaceable. Original records remain the authority
// for fingerprints, denylist checks and all technical source text.
export function applyIdentityCorrections(originals, report, sourceHash) {
  assert.equal(report.kind,'FULL_SOURCE_REPARSE_IDENTITY_AUDIT');
  assert.equal(report.productionApplyAllowed,false);
  assert.equal(report.hashes.source,sourceHash);
  assert.equal(report.requirements,originals.length);
  assert.deepEqual(report.unrelatedChanges,[]);
  const byId=new Map(originals.map(r=>[r.id,r]));
  assert.equal(byId.size,originals.length);
  const changes=new Map();
  for(const change of report.changes){
    const original=byId.get(change.requirementId);
    assert.ok(original && !changes.has(original.id));
    assert.equal(change.sourceRowId,original.sourceRowId);
    assert.equal(change.sourceUrl,original.sourceUrl);
    assert.equal(change.productionApplyAllowed,false);
    assert.deepEqual(change.before,{generation:original.generation,bodyCodesJson:original.bodyCodesJson});
    assert.deepEqual(Object.keys(change.after).sort(),['bodyCodesJson','generation']);
    assert.ok(change.after.generation===null || typeof change.after.generation==='string');
    assert.ok(Array.isArray(change.after.bodyCodesJson) && change.after.bodyCodesJson.every(c=>typeof c==='string'));
    if(change.sourceIdentity != null){
      assert.equal(change.sourceIdentity.reviewRequired,true);
      assert.equal(change.sourceIdentity.reason,'GENERATION_SLUG_TITLE_CONFLICT');
      assert.equal(change.after.generation,null);
    }
    changes.set(original.id,change);
  }
  assert.equal(changes.size,report.changedRequirements);
  const requirements=originals.map(original=>{
    const change=changes.get(original.id);if(!change)return original;
    return {...original,...change.after,
      rawRequirementJson:{...original.rawRequirementJson,...(change.sourceIdentity ? {sourceIdentity:change.sourceIdentity} : {})}};
  });
  return {requirements,originalById:byId,changes};
}

export async function loadIdentityOverlay(root, fluidRaw, path, expectedHash) {
  const originals=parseCopy(fluidRaw,'vehicle_fluid_requirements');
  if(!path)return {requirements:originals,originalById:new Map(originals.map(r=>[r.id,r])),changes:new Map(),metadata:null};
  const raw=await readFile(path,'utf8'),hash=sha(raw),report=JSON.parse(raw);
  if(expectedHash)assert.equal(hash,expectedHash,'Correction artifact changed during run');
  const currentParserHash=sha(await readFile(resolve(root,'src/lib/fluid-catalog.ts'),'utf8'));
  const snapshotRaw=await readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8');
  assert.equal(report.hashes.snapshot,sha(snapshotRaw));
  const sourceRows=new Map(snapshotRaw.trim().split('\n').map(JSON.parse).map(r=>[r.row_id,r]));
  const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
  const {prepareFluidCatalog}=await jiti.import(resolve(root,'src/lib/fluid-catalog.ts'));
  let prepared=prepareFluidCatalog({rowsNdjson:snapshotRaw,mannFiltersCsv:''});
  const freshlyPrepared=prepared;
  let parserCompatibility;
  let compatibilityParserHash=currentParserHash;
  let compatibilityPreparedHash=sha(prepared);
  let fuelCompatibility;
  if(currentParserHash==='7c4545766c940fbe789a68af0c96c61afed45fa28aba29fa45412b0ff30b5a91'){
    const dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
    const baselineRaw=await readFile(resolve(dir,'volvo-fuel-import-baseline-v1.json'),'utf8');
    const transitionRaw=await readFile(resolve(dir,'volvo-fuel-import-transition-v1.json'),'utf8');
    assert.equal(sha(baselineRaw),'4a54dc8dceca53ebec9fd2d5660df6e340572495fffa85ee15d7baa78ebb6b7b');
    assert.equal(sha(transitionRaw),'e08d9e5f718c9cd37fd280b1147971d0b4ece3e8be3870ee60f7925e5958accf');
    const baseline=JSON.parse(baselineRaw),transition=JSON.parse(transitionRaw);
    assert.equal(transition.helperHash,sha(await readFile(resolve(root,'src/lib/fluid-volvo-source-fuel.ts'),'utf8')));
    assert.equal(transition.dataHash,sha(await readFile(resolve(root,'src/lib/fluid-volvo-source-fuel-data.json'),'utf8')));
    assert.equal(baseline.rawHash,sha(snapshotRaw));assert.equal(transition.rawHash,sha(snapshotRaw));
    assert.equal(transition.baselineHash,sha(baselineRaw));assert.equal(transition.beforeParserHash,baseline.parserHash);assert.equal(transition.afterParserHash,currentParserHash);
    assert.equal(prepared.requirements.length,baseline.requirements.length);
    const differences=new Map(transition.differences.map(d=>[d.id,d]));let changed=0;
    for(let i=0;i<prepared.requirements.length;i++){
      const before=baseline.requirements[i],after=prepared.requirements[i],difference=differences.get(after.id);
      if(!difference){assert.deepEqual(after,before);continue;}
      assert.equal(before.id,after.id);assert.equal(before.fuelType,difference.beforeFuel);assert.equal(after.fuelType,difference.afterFuel);
      const {sourceFuelCorrection,...rest}=after.rawRequirementJson;assert.deepEqual(sourceFuelCorrection,difference.provenance);
      assert.deepEqual({...after,fuelType:before.fuelType,rawRequirementJson:rest},before);changed++;
    }
    assert.equal(changed,19);assert.equal(changed,differences.size);assert.equal(changed,transition.summary.changed);
    prepared={...prepared,requirements:baseline.requirements};compatibilityParserHash=baseline.parserHash;
    fuelCompatibility={transitionHash:sha(transitionRaw),scope:'EXACT_FUEL_AND_CORRECTION_PROVENANCE_ONLY'};
  }
  let engineCompatibilityRequirements=prepared.requirements;
  let volvoCompatibility;
  if(compatibilityParserHash==='27204ec4b2b92106085793c38fcf5d2e7c24622289ca924bebbc06a855f72615'){
    const dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
    const baselineRaw=await readFile(resolve(dir,'volvo-import-parser-baseline-v1.json'),'utf8');
    const transitionRaw=await readFile(resolve(dir,'volvo-import-parser-transition-v1.json'),'utf8');
    assert.equal(sha(baselineRaw),'a1b2d2ed70b4c485c58f3d9ea65ad70d0a8a72d2adf21a7d0912471bc3facd65');
    assert.equal(sha(transitionRaw),'508215709dc8bef70b0fa9440efe7de821cb90d8029abb9c4b9e6e872720a28a');
    const baseline=JSON.parse(baselineRaw),transition=JSON.parse(transitionRaw);
    assert.equal(transition.helperHash,sha(await readFile(resolve(root,'src/lib/fluid-volvo-component-engine-list.ts'),'utf8')));
    assert.equal(baseline.rawHash,sha(snapshotRaw));assert.equal(transition.rawHash,sha(snapshotRaw));
    assert.equal(transition.baselineHash,sha(baselineRaw));assert.equal(transition.beforeParserHash,baseline.parserHash);assert.equal(transition.afterParserHash,compatibilityParserHash);
    assert.equal(prepared.requirements.length,baseline.requirements.length);
    const differences=new Map(transition.differences.map(d=>[d.id,d]));let changed=0;
    for(let i=0;i<prepared.requirements.length;i++){
      const before=baseline.requirements[i],after=prepared.requirements[i];
      if(sha(before)===sha(after)){assert.ok(!differences.has(after.id));continue;}
      const difference=differences.get(after.id);assert.ok(difference);assert.equal(before.id,after.id);
      assert.deepEqual(before.engineCodesJson,difference.before);assert.deepEqual(after.engineCodesJson,difference.after);
      assert.deepEqual({...after,engineCodesJson:before.engineCodesJson,engineCodeNormalized:before.engineCodeNormalized},before);
      changed++;
    }
    assert.equal(changed,transition.summary.changed);assert.equal(changed,differences.size);
    engineCompatibilityRequirements=baseline.requirements;compatibilityParserHash=baseline.parserHash;
    volvoCompatibility={transitionHash:sha(transitionRaw),baselineHash:sha(baselineRaw),scope:'EXACT_VOLVO_ENGINE_FIELDS_ONLY'};
  }
  if(compatibilityParserHash==='ffab595af8525552090c85c1df7af762fa3f5ce48466905827373dd7a1f1b7f1'){
    // New engine extraction does not change generation/body identity. Verify
    // every rebuilt requirement against the immutable pre-change baseline;
    // the all-source identity replay below is still mandatory.
    const dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
    const baselineRaw=await readFile(resolve(dir,'mercedes-import-parser-baseline-v1.json'),'utf8');
    assert.equal(sha(baselineRaw),'fea8c313b6c95327f982a4c5b9bc09a8613cf13b2cfcee13a4debe65cd14c31d');
    const transitionRaw=await readFile(resolve(dir,'mercedes-import-parser-transition-v1.json'),'utf8');
    assert.equal(sha(transitionRaw),'84090fd6c9072abced2f53664a7b26f61bb15614d30152cf6be48366b4a47e07');
    const baseline=JSON.parse(baselineRaw),transition=JSON.parse(transitionRaw);
    assert.equal(baseline.rawHash,sha(snapshotRaw));assert.equal(transition.rawHash,sha(snapshotRaw));
    assert.equal(transition.baselineHash,sha(baselineRaw));assert.equal(transition.beforeParserHash,baseline.parserHash);assert.equal(transition.afterParserHash,compatibilityParserHash);
    assert.equal(engineCompatibilityRequirements.length,baseline.requirements.length);
    const differences=new Map(transition.differences.map(d=>[d.id,d]));let changed=0;
    for(let i=0;i<engineCompatibilityRequirements.length;i++){
      const before=baseline.requirements[i],after=engineCompatibilityRequirements[i];
      if(sha(before)===sha(after)){assert.ok(!differences.has(after.id));continue;}
      const difference=differences.get(after.id);assert.ok(difference);assert.equal(before.id,after.id);
      assert.deepEqual(before.engineCodesJson,difference.before);assert.deepEqual(after.engineCodesJson,difference.after);
      assert.deepEqual({...after,engineCodesJson:before.engineCodesJson,engineCodeNormalized:before.engineCodeNormalized},before);
      changed++;
    }
    assert.equal(changed,transition.summary.changed);assert.equal(changed,differences.size);
    parserCompatibility={currentParserHash,transitionHash:sha(transitionRaw),baselineHash:sha(baselineRaw),volvoCompatibility,fuelCompatibility,scope:'AUDITED_ENGINE_AND_FUEL_FIELDS_PLUS_FULL_IDENTITY_REPLAY'};
  }
  if(currentParserHash==='46e51357b407df2bb3d17af2d93742140cb365cce036154d9bacfb12f0eb5a40'){
    const dotRaw=await readFile(resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14/dot-token-transition-v4.json'),'utf8');
    assert.equal(sha(dotRaw),'0a41c9207446bb0f4a9ac43ad6e80ceeea964b0ea17cca0539ca1521492dedb9');
    const dot=JSON.parse(dotRaw);assert.equal(dot.snapshotHash,sha(snapshotRaw));
    assert.equal(dot.afterParserHash,currentParserHash);assert.equal(dot.afterPreparedHash,compatibilityPreparedHash);
    assert.equal(compatibilityPreparedHash,'c42b224f6101a4298cd7ef5a6a4a02aa1036efcffc2734b6ebfc0aca86acf8bf');
    compatibilityParserHash=dot.beforeParserHash;compatibilityPreparedHash=dot.beforePreparedHash;
  }
  if(compatibilityParserHash==='366d7c8e06859de7bcbf3a1ae6a692474df96c87f47f8f2a8f5101ca8ded637a'){
    // Audited all-row transition: only ambiguous shared-table power becomes null.
    const transitionRaw=await readFile(resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14/table-power-reparse-transition-v1.json'),'utf8');
    assert.equal(sha(transitionRaw),'7957aec888217d8601633967e037a102ac14b9bd8e3207724ac8cdc9d462e2df');
    const transition=JSON.parse(transitionRaw);assert.equal(transition.snapshotHash,sha(snapshotRaw));
    assert.equal(transition.afterParserHash,compatibilityParserHash);assert.equal(transition.afterPreparedHash,compatibilityPreparedHash);
    assert.equal(compatibilityPreparedHash,'d26001fe5b85e2b23092b682734df5950c4afa3aa7ab2c727333b586104ce926');
    compatibilityParserHash='4f9abf60a140b3ed5cb5b1b034190d86a2f39c3de3cb80e3f517adb881cdb233';
    compatibilityPreparedHash='61daaaa182cf15d0de21343c3738c79d89d8109ac31cc5f11b0a96363fc64751';
  }
  if(report.hashes.parser!==currentParserHash&&!parserCompatibility){
    // One fully audited transition: capacity scalar semantics only. No arbitrary
    // parser hash is accepted, and the entire fresh parse must equal its proof.
    assert.equal(report.hashes.parser,'6885c95dbe512c6d85f72a8f7bb93ab3dba4c8d0aa0c590eabb82e1bc9cbe397');
    assert.equal(compatibilityParserHash,'4f9abf60a140b3ed5cb5b1b034190d86a2f39c3de3cb80e3f517adb881cdb233');
    const dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
    const proofRaw=await readFile(resolve(dir,'capacity-summary-identity-compatibility-v1.json'),'utf8');
    assert.equal(sha(proofRaw),'411fe844e2d5d0c38d34de497d3df284477c48a188028a26d1ac62907b10a1ea');
    const proof=JSON.parse(proofRaw);
    assert.equal(proof.snapshotHash,sha(snapshotRaw));
    assert.equal(proof.beforeParserHash,report.hashes.parser);assert.equal(proof.afterParserHash,compatibilityParserHash);
    assert.equal(compatibilityPreparedHash,proof.preparedHash);
    parserCompatibility={proofHash:proof.proofHash,compatibilityHash:sha(proofRaw),currentParserHash,scope:currentParserHash===compatibilityParserHash?'CAPACITY_SCALARS_ONLY_IDENTITY_UNCHANGED':'CAPACITY_AND_TABLE_POWER_SCALARS_ONLY_IDENTITY_UNCHANGED'};
  }
  const reparsed=new Map(freshlyPrepared.requirements.map(r=>[r.id,r]));
  assert.equal(reparsed.size,originals.length);
  const result=applyIdentityCorrections(originals,report,sha(fluidRaw));
  // Full replay of identity extraction also detects omitted corrections.
  for(const requirement of result.requirements){
    const rebuilt=reparsed.get(requirement.id);assert.ok(rebuilt);
    assert.equal(requirement.generation,rebuilt.generation);
    assert.deepEqual(requirement.bodyCodesJson,rebuilt.bodyCodesJson);
    assert.deepEqual(requirement.rawRequirementJson?.sourceIdentity,rebuilt.rawRequirementJson?.sourceIdentity);
    const change=result.changes.get(requirement.id);
    if(change){const row=sourceRows.get(change.sourceRowId);assert.ok(row);
      assert.equal(change.evidence.sourceRowHash,sha(row));assert.equal(change.evidence.pageHash,row.page_sha256);
      assert.equal(change.evidence.generationSlug,row.generation_slug);assert.equal(change.evidence.pageTitle,row.page_title);
    }
  }
  return {...result,metadata:{path:resolve(path),sha256:hash,changedRequirements:result.changes.size,sourceHashes:report.hashes,...(parserCompatibility?{parserCompatibility}:{})}};
}
