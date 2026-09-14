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
  const prepared=prepareFluidCatalog({rowsNdjson:snapshotRaw,mannFiltersCsv:''});
  let parserCompatibility;
  if(report.hashes.parser!==currentParserHash){
    // One fully audited transition: capacity scalar semantics only. No arbitrary
    // parser hash is accepted, and the entire fresh parse must equal its proof.
    assert.equal(report.hashes.parser,'6885c95dbe512c6d85f72a8f7bb93ab3dba4c8d0aa0c590eabb82e1bc9cbe397');
    assert.equal(currentParserHash,'4f9abf60a140b3ed5cb5b1b034190d86a2f39c3de3cb80e3f517adb881cdb233');
    const dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
    const proofRaw=await readFile(resolve(dir,'capacity-summary-identity-compatibility-v1.json'),'utf8');
    assert.equal(sha(proofRaw),'411fe844e2d5d0c38d34de497d3df284477c48a188028a26d1ac62907b10a1ea');
    const proof=JSON.parse(proofRaw);
    assert.equal(proof.snapshotHash,sha(snapshotRaw));
    assert.equal(proof.beforeParserHash,report.hashes.parser);assert.equal(proof.afterParserHash,currentParserHash);
    assert.equal(sha(prepared),proof.preparedHash);
    parserCompatibility={proofHash:proof.proofHash,compatibilityHash:sha(proofRaw),currentParserHash,scope:'CAPACITY_SCALARS_ONLY_IDENTITY_UNCHANGED'};
  }
  const reparsed=new Map(prepared.requirements.map(r=>[r.id,r]));
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
