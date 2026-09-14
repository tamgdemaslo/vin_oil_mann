import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createJiti} from 'jiti';
import {resolve} from 'node:path';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {mannRowIdentityEvidence:lookup}=await j.import('../src/lib/mann-row-identity-evidence.ts');
const {rowBodyCodes,evaluateMannCandidate}=await j.import('../src/lib/mann-vehicle-resolver.ts');
const proposal=JSON.parse(await readFile(resolve(dir,'online-hd-additive-proposal-v1.json'),'utf8'));
const row=proposal.proposal.row,before=sha(row),e=lookup(row);assert.ok(e);
const auditRaw=await readFile(resolve(dir,'online-c2029-gap-evidence-v2.json'),'utf8');assert.equal(sha(auditRaw),e.evidence.auditSha256);
const audit=JSON.parse(auditRaw);assert.equal(audit.sourceHtml.sha256,e.evidence.htmlSha256);assert.equal(audit.sourceHtml.url,e.evidence.url);
assert.equal(sha(await readFile(audit.sourceHtml.path,'utf8')),e.evidence.htmlSha256);
const a=audit.findings.find(f=>f.application.manufacturerTypeId===e.evidence.manufacturerTypeId).application;
assert.equal(a.vehicleText,'2.0 16V DOHC (HD)');assert.equal(Number(a.ccm),e.engineVolumeCc);
assert.equal(row.model,a.model);assert.equal(row.engineCode,a.engineCode);assert.equal(row.hp,a.hp);assert.equal(row.kw,a.kw);
assert.deepEqual(rowBodyCodes(row),['HD']);
for(const p of proposal.sourceProbes){
 const c=evaluateMannCandidate(p.decision.normalizedVehicle,row).candidate;assert.ok(c);
 assert.ok(c.matchedFields.includes('код кузова'));assert.ok(c.matchedFields.includes('объём двигателя'));
 assert.ok(c.mismatchedFields.includes('поколение'),'Generation disagreement must not be silently erased');
 const wrong=evaluateMannCandidate({...p.decision.normalizedVehicle,bodyCodes:['XD2'],engineVolumeCc:1600},row).candidate;
 assert.ok(wrong.mismatchedFields.includes('код кузова'));assert.ok(wrong.mismatchedFields.includes('объём двигателя'));
}
for(const [key,value]of Object.entries(e.row)){
 const changed={...row,[key]:typeof value==='number'?value+1:value===null?'restriction':`${value} changed`};
 assert.equal(lookup(changed),undefined,`Changed ${key} must not inherit evidence`);
}
const sql=await readFile('/tmp/mann_filter_applications.sql','utf8');assert.equal(sha(sql),proposal.mannHash);
const rows=parseCopy(sql,'mann_filter_applications');assert.equal(rows.length,37600);
for(const old of rows)assert.equal(lookup(old),undefined);
assert.equal(sha(row),before);
console.log(JSON.stringify({passed:true,legacyRowsUnaffected:rows.length,negativeFieldMutations:Object.keys(e.row).length,sourceEvaluations:proposal.sourceProbes.length,generationConflictPreserved:true}));
