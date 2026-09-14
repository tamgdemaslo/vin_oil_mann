import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),evidencePath=resolve(root,'outputs/mann-compound-headings-recheck-2026-09-14/gentra-source-scope-evidence-v1.json');
const evidenceRaw=await readFile(evidencePath,'utf8'),evidence=JSON.parse(evidenceRaw),parentRaw=await readFile(evidence.planPath,'utf8'),parent=JSON.parse(parentRaw);
assert.equal(sha(parentRaw),evidence.planHash);assert.equal(evidence.planHash,'5d860f8615a07175105a0b3a8c2a0a30d92abe72523925bb2921efc1754c0221');
assert.equal(evidence.productionApplyAllowed,false);assert.equal(evidence.checked,8);assert.equal(evidence.monthPartitionChecks,384);
assert.equal(sha(await readFile('/tmp/vehicle_fluid_requirements.sql','utf8')),evidence.sourceHash);
assert.equal(sha(await readFile('/tmp/mann_filter_applications.sql','utf8')),evidence.mannHash);
const liveRaw=await readFile(resolve(root,parent.inputFiles.live),'utf8');assert.equal(sha(liveRaw),parent.inputHashes.live);const live=JSON.parse(liveRaw);
const ids=new Set(evidence.findings.map(f=>f.sourceRequirementId));assert.equal(ids.size,8);
assert.equal(parent.newRevisions.filter(r=>ids.has(r.sourceRequirementId)).length,0);
assert.equal(parent.existingActions.filter(r=>ids.has(r.sourceRequirementId)).length,0);
assert.equal(live.filter(r=>ids.has(r.sourceRequirementId)).length,0,'Existing live Gentra requires separate reconciliation');
assert.equal((parent.sourceEvidenceReview??[]).filter(r=>ids.has(r.sourceRequirementId)).length,0);
const additions=evidence.findings.map(f=>{
 assert.equal(f.publicationAllowed,false);assert.equal(sha(f.originalSource),f.sourceHash);
 assert.ok(f.reasons.includes('MISSING_EXPLICIT_CHASSIS_IDENTITY'));
 return {...f,reason:f.sourceSpecificationConflict?'SOURCE_SPECIFICATION_CONTRADICTION':'SOURCE_IDENTITY_REQUIRES_PRIMARY_EVIDENCE',evidencePath,evidenceHash:sha(evidenceRaw)};
});
const result={...parent,sourceEvidenceReview:[...(parent.sourceEvidenceReview??[]),...additions],
 sourceEvidenceReviewHistory:{previous:parent.sourceEvidenceReviewHistory??null,parentPath:evidence.planPath,parentHash:sha(parentRaw),evidencePath,evidenceHash:sha(evidenceRaw),addedSourceIds:[...ids],liveHash:sha(liveRaw),productionApplyAllowed:false}};
assert.deepEqual(result.newRevisions,parent.newRevisions);assert.deepEqual(result.existingActions,parent.existingActions);
assert.equal(result.productionApplyAllowed,false);
const out=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');await mkdir(out);
await writeFile(resolve(out,'plan.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({addedSourceReviewEntries:additions.length,sourceSpecificationConflicts:additions.filter(f=>f.sourceSpecificationConflict).length,unchangedRevisions:result.newRevisions.length,productionApplyAllowed:false}));
