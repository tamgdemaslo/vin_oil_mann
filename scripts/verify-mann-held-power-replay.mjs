import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {sha,parseCopy} from './lib/mann-offline-scope.mjs';
import {applyIdentityCorrections} from './lib/mann-source-identity-overlay.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-held-power-current-recheck-2026-09-14');
// A completed summary is mandatory; never bless a partial streaming run.
const summaryRaw=await readFile(resolve(dir,'summary.json'),'utf8'),summary=JSON.parse(summaryRaw);
assert.equal(summary.processed,13296);assert.equal(summary.productionApplyAllowed,false);
assert.equal(summary.planHash,sha(await readFile(summary.planPath,'utf8')));
for(const [path,hash] of Object.entries(summary.codeHashes))assert.equal(sha(await readFile(resolve(root,path),'utf8')),hash);
const sql=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');assert.equal(sha(sql),summary.sourceHash);
assert.equal(sha(await readFile('/tmp/mann_filter_applications.sql','utf8')),summary.mannHash);
const originals=parseCopy(sql,'vehicle_fluid_requirements'),byId=new Map(originals.map(s=>[s.id,s]));
const identityRaw=await readFile(resolve(root,'outputs/mann-identity-scoped-2026-09-14/source-identity-corrections.json'),'utf8');
assert.equal(sha(identityRaw),'fbbe7b991ba80e19d62b42aaece22cb739860443256a8d935160f69ab9f90d34');
const effective=applyIdentityCorrections(originals,JSON.parse(identityRaw),sha(sql)).requirements.map(s=>structuredClone(s));
const expected=new Map(effective.map(s=>[s.id,s]));
const powerRaw=await readFile(resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14/partial-table-power-audit-v1.json'),'utf8');
assert.equal(sha(powerRaw),summary.powerCorrection.auditHash);
const changed=new Set();for(const f of JSON.parse(powerRaw).findings){assert.equal(sha(byId.get(f.sourceRequirementId)),f.sourceHash);for(const field of f.affectedFields){assert.ok(['powerHp','powerKw'].includes(field));expected.get(f.sourceRequirementId)[field]=null;}changed.add(f.sourceRequirementId);}
assert.equal(changed.size,274);
const counts={},seen=new Set(),hash=createHash('sha256');
for await(const chunk of createReadStream(resolve(dir,'decisions.ndjson')))hash.update(chunk);
assert.equal(hash.digest('hex'),summary.decisionsHash);
for await(const line of createInterface({input:createReadStream(resolve(dir,'decisions.ndjson')),crlfDelay:Infinity})){
 const r=JSON.parse(line);assert.ok(!seen.has(r.requirementId));seen.add(r.requirementId);
 assert.equal(r.originalSourceHash,sha(byId.get(r.requirementId)));
 assert.equal(r.effectiveSourceHash,sha(expected.get(r.requirementId)));
 assert.equal(r.decision.requirementId,r.requirementId);assert.equal(r.publicationAllowed,false);
 counts[r.decision.status]=(counts[r.decision.status]??0)+1;
}
assert.equal(seen.size,13296);assert.deepEqual(counts,summary.statusCounts);
const report={kind:'HELD_POWER_FULL_REPLAY_INPUT_INTEGRITY',summaryHash:sha(summaryRaw),decisionsHash:summary.decisionsHash,planHash:summary.planHash,checked:seen.size,powerCorrectedSources:changed.size,originalFingerprintsPreserved:true,onlyIdentityAndAuditedPowerFieldsChanged:true,productionApplyAllowed:false,limitations:['Independent input/hash/record-count verification, not a second execution of the matcher.','Effective sources retain historical technical payloads; this run is identity triage, not fresh full technical reimport or OEM approval.']};
await writeFile(resolve(dir,'input-integrity-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
