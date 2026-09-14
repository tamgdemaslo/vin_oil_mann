import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14'),base=resolve(root,'outputs/mann-compound-headings-recheck-2026-09-14');
const summaryRaw=await readFile(resolve(base,'summary.json'),'utf8'),summary=JSON.parse(summaryRaw);
assert.equal(sha(summaryRaw),'5770b5d7f8690cd2b42e2ea245573ad5323693ffb37b72d442ae2b9db2c967d5');
const sourceRaw=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),mannRaw=await readFile('/tmp/mann_filter_applications.sql','utf8');
assert.equal(sha(sourceRaw),summary.sourceHash);assert.equal(sha(mannRaw),summary.mannHash);
const planRaw=await readFile(resolve(dir,'plan.json'),'utf8');assert.equal(sha(planRaw),'31f8407dde303ca792f858299a5c40282a4079d65b9e8a9a8e020941e8411c5c');
const overlay=await loadIdentityOverlay(root,sourceRaw,resolve(root,'outputs/mann-identity-scoped-2026-09-14/source-identity-corrections.json'));
const sources=new Map(overlay.requirements.map(s=>[s.id,s]));assert.equal(sources.size,13296);
const paths=[...Object.keys(summary.codeHashes),'src/lib/mann-row-identity-evidence.ts','src/lib/mann-catalog.ts','scripts/recheck-mann-row-identity-evidence.mjs'];
const hashes=Object.fromEntries(await Promise.all(paths.map(async p=>[p,sha(await readFile(resolve(root,p),'utf8'))])));
for(const [p,h]of Object.entries(summary.codeHashes))if(p!=='src/lib/mann-vehicle-resolver.ts')assert.equal(hashes[p],h);
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{matchFluidRequirementToMann:match}=await j.import('../src/lib/mann-fluid-matcher-v2.ts');
const {mannMakeFormsForTest,rowBodyCodes,evaluateMannCandidate}=await j.import('../src/lib/mann-vehicle-resolver.ts'),{normalizeMannText}=await j.import('../src/lib/mann-catalog.ts');
const rows=parseCopy(mannRaw,'mann_filter_applications'),byMake=new Map(),seen=new Set(),counts={};let checked=0;
const file=resolve(base,'decisions.ndjson'),hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);assert.equal(hash.digest('hex'),summary.decisionsHash);
for await(const line of createInterface({input:createReadStream(file),crlfDelay:Infinity})){
 const prior=JSON.parse(line),source=sources.get(prior.requirementId);assert.ok(source);assert.ok(!seen.has(source.id));seen.add(source.id);
 assert.equal(sha(source),prior.effectiveSourceHash);assert.equal(sha(overlay.originalById.get(source.id)),prior.originalSourceHash);
 if(!byMake.has(source.make)){const forms=new Set(mannMakeFormsForTest(source.make));byMake.set(source.make,rows.filter(r=>forms.has(normalizeMannText(r.makeNormalized||r.make))));}
 const decision=match(source,byMake.get(source.make));assert.deepEqual(JSON.parse(JSON.stringify(decision)),prior.decision,`Legacy decision changed: ${source.id}`);
 counts[decision.status]=(counts[decision.status]??0)+1;checked++;if(checked%1000===0)console.log(JSON.stringify({checked,total:13296}));
}
assert.equal(checked,13296);assert.deepEqual(counts,summary.statusCounts);
const proposalRaw=await readFile(resolve(dir,'online-hd-additive-proposal-v1.json'),'utf8'),proposal=JSON.parse(proposalRaw),row=proposal.proposal.row;
const probes=proposal.sourceProbes.map(p=>{
 assert.equal(sha(p.originalSource),p.sourceHash);
 const evaluation=evaluateMannCandidate(p.decision.normalizedVehicle,row);assert.ok(evaluation.candidate.matchedFields.includes('код кузова'));assert.ok(evaluation.candidate.matchedFields.includes('объём двигателя'));assert.ok(evaluation.candidate.mismatchedFields.includes('поколение'));
 return {sourceRequirementId:p.sourceRequirementId,evaluation,decision:match(p.effectiveSource,[...rows,row]),publicationAllowed:false};
});
for(const [p,h]of Object.entries(hashes))assert.equal(sha(await readFile(resolve(root,p),'utf8')),h);
assert.equal(sha(await readFile(resolve(dir,'plan.json'),'utf8')),sha(planRaw));
const report={kind:'FULL_SOURCE_ROW_EVIDENCE_REGRESSION',baselineSummaryHash:sha(summaryRaw),baselineDecisionsHash:summary.decisionsHash,codeHashes:hashes,planHash:sha(planRaw),sourceHash:sha(sourceRaw),mannHash:sha(mannRaw),checked,unchanged:checked,statusCounts:counts,proposalHash:sha(proposalRaw),newRowBodyCodes:rowBodyCodes(row),probes,productionApplyAllowed:false,limitations:['Original heading generation disagreement remains.','Catalogue row remains a proposal, not a database insertion.','Fluid technical quality and full market/drive/month conditions still require review.']};
await writeFile(resolve(dir,'row-identity-evidence-full-recheck-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({...report,probes:probes.map(p=>({id:p.sourceRequirementId,status:p.decision.status})),codeHashes:undefined}));
