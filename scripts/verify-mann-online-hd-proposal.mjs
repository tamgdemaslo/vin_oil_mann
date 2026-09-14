import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const raw=await readFile(resolve(dir,'online-hd-additive-proposal-v1.json'),'utf8'),proposal=JSON.parse(raw);
for(const[p,h]of Object.entries(proposal.codeHashes))assert.equal(sha(await readFile(resolve(root,p),'utf8')),h);
const planRaw=await readFile(resolve(dir,'plan.json'),'utf8');assert.equal(sha(planRaw),proposal.planHash);
const sql=await readFile('/tmp/mann_filter_applications.sql','utf8');assert.equal(sha(sql),proposal.mannHash);const rows=parseCopy(sql,'mann_filter_applications');assert.equal(rows.length,37600);
const auditRaw=await readFile(resolve(dir,'online-c2029-gap-evidence-v2.json'),'utf8');assert.equal(sha(auditRaw),proposal.auditHash);const audit=JSON.parse(auditRaw);
const a=audit.findings.find(f=>f.application.manufacturerTypeId==='00000000219218').application,row=proposal.proposal.row;
assert.deepEqual(proposal.proposal.evidence.originalApplication,a);assert.equal(proposal.proposal.evidence.exactDisplacementCcm,'1975');
assert.equal(row.model,a.model);assert.equal(row.vehicleText,a.vehicleText);assert.equal(row.effectiveVehicleText,a.vehicleText);assert.equal(row.vehicleYears,'10/06-05/11');assert.equal(row.sourceHash,audit.sourceHtml.sha256);assert.equal(row.sourceFile,audit.sourceHtml.url);
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{normalizeMannText:t,normalizeMannSearchText:s}=await j.import('../src/lib/mann-catalog.ts');
// Catalogue keys preserve code-list punctuation differently from VIN normalization.
// Independently reproduce the importer's engine component, not the VIN helper.
const e=value=>t(value).replace(/[;,]+/g,' ').replace(/\s*\/\s*/g,'/').replace(/\s+/g,' ').trim()||null;
const independentKey=r=>sha([t(r.make),s(r.model),s(r.effectiveVehicleText||r.vehicleText),e(r.engineCode)??'',t(r.kw),t(r.hp),t(r.vehicleYears),s(r.condition)].join('|'));
for(const r of rows)assert.equal(independentKey(r),r.vehicleVariantKey);
assert.equal(independentKey(row),row.vehicleVariantKey);assert.ok(!rows.some(r=>r.vehicleVariantKey===row.vehicleVariantKey));
const augmented=[...rows,row];assert.deepEqual(augmented.slice(0,-1),rows);assert.equal(augmented.length,37601);
assert.equal(proposal.sourceProbes.length,6);assert.equal(new Set(proposal.sourceProbes.map(p=>p.sourceRequirementId)).size,6);
const {evaluateMannCandidate,rowBodyCodes}=await j.import('../src/lib/mann-vehicle-resolver.ts');
const evaluations=proposal.sourceProbes.map(p=>{assert.equal(sha(p.originalSource),p.sourceHash);const evaluation=evaluateMannCandidate(p.decision.normalizedVehicle,row);return {sourceRequirementId:p.sourceRequirementId,evaluation,publicationAllowed:false};});
assert.ok(evaluations.every(e=>e.evaluation.candidate?.mismatchedFields.includes('код кузова')));
assert.equal(proposal.productionApplyAllowed,false);assert.equal(proposal.proposal.productionApplyAllowed,false);
const report={kind:'INDEPENDENT_ADDITIVE_HD_PROPOSAL_CHECK',proposalHash:sha(raw),planHash:sha(planRaw),mannHash:sha(sql),legacyKeysVerified:rows.length,originalRowsPreserved:rows.length,virtualCombinedRowCount:augmented.length,newVariantKey:row.vehicleVariantKey,proposedRowHash:sha(row),virtualCombinedHash:sha(augmented),currentResolverBodyCodes:rowBodyCodes(row),evaluations,productionApplyAllowed:false,limitation:'Additive proposal/data preservation only. Current resolver still derives XD2 instead of row HD and generation II instead of source IV; displacement is missing in resolver despite retained1975cc evidence. Must resolve structured row identity before publication. No SQL or canonical changes.'};
await writeFile(resolve(dir,'online-hd-additive-verification-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({...report,evaluations:undefined}));
