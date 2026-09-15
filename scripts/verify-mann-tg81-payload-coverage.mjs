import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const read=async p=>JSON.parse(await readFile(p,'utf8'));
const planRaw=await readFile(resolve(dir,'plan.json'),'utf8'),plan=JSON.parse(planRaw),before=await read(resolve(dir,'full-source-coverage-v8.json')),after=await read(resolve(dir,'full-source-coverage-v9.json')),payloadRaw=await readFile(resolve(dir,'current-staging-payload-v6.json'),'utf8'),payload=JSON.parse(payloadRaw),parents=await read(resolve(root,'outputs/mann-live-audit-1789415211923/canonical-parent-drafts-v3.json'));
assert.equal(sha(planRaw),'6b436120dd91f8b1ca909fe1fc51556cdb1906b946c2cccc895e9cc03a18e032');
for(const r of [after,payload,parents])assert.equal(r.planHash,sha(planRaw));assert.equal(parents.payloadHash,sha(payloadRaw));
assert.equal(after.rows.length,13296);assert.deepEqual(new Set(after.rows.map(r=>r.requirementId)),new Set(before.rows.map(r=>r.requirementId)));
const byId=new Map(after.rows.map(r=>[r.requirementId,r]));let preserved=0;
for(const old of before.rows)for(const p of old.pendingReview){assert.ok(byId.get(old.requirementId).pendingReview.some(n=>sha(n)===sha(p)));preserved++;}
assert.equal(preserved,1858);const pending=after.rows.flatMap(r=>r.pendingReview);assert.equal(pending.length,1862);assert.equal(pending.filter(p=>p.reason==='TG81_CONDITIONAL_SOURCE_AND_SERVICE_VOLUME_REVIEW').length,4);
assert.deepEqual(payload.revisions.map(r=>r.originalRevision),plan.newRevisions);assert.equal(payload.revisions.length,1971);
assert.deepEqual(new Set(after.rows.flatMap(r=>r.localRevisionIds)),new Set(plan.newRevisions.map(r=>r.id)));
const parentKeys=[...parents.drafts,...parents.existing].map(r=>r.vehicleVariantKey);assert.equal(parentKeys.length,529);assert.equal(new Set(parentKeys).size,529);assert.deepEqual(new Set(parentKeys),new Set(payload.variants.map(v=>v.vehicleVariantKey)));
assert.ok(payload.runs.every(r=>r.status==='PLANNED'&&!r.productionApplyAuthorized&&!r.independentHumanSignoff));assert.ok(after.rows.every(r=>!r.sourceFullyResolved&&!r.productionAppliedByThisWork));
const summary={sourceRows:13296,revisions:1971,requiredParents:529,existingParentsPreserved:312,parentDrafts:217,priorPendingPreserved:1858,additionalPending:4,totalPending:1862};
await writeFile(resolve(dir,'tg81-payload-coverage-verification-v1.json'),JSON.stringify({kind:'TG81_PAYLOAD_PARENT_AND_COVERAGE_INTEGRITY',planHash:sha(planRaw),payloadHash:sha(payloadRaw),summary,productionApplyAllowed:false,limitations:['Uses authorized archived live snapshot, not a fresh database query or import.','Foreign-key key coverage checked in memory; full current PostgreSQL integration remains required.']},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(summary));
