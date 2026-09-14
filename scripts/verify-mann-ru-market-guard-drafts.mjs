import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha} from './lib/mann-offline-scope.mjs';
assert.ok(process.argv.length<=4&&(!process.argv[3]||process.argv[3]==='non-ru'));const nonRu=process.argv[3]==='non-ru';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,process.argv[2]??'outputs/mann-market-power-held-preview-2026-09-14');
const [planRaw,draftRaw,identityRaw,marketRaw]=await Promise.all(['plan.json',nonRu?'non-ru-market-guard-drafts-v1.json':'ru-market-guard-drafts-v1.json',nonRu?'non-ru-market-identity-recheck-v1.json':'ru-market-identity-recheck-v1.json',nonRu?'source-market-target-scope-audit-v2.json':'source-market-target-scope-audit-v1.json'].map(f=>readFile(resolve(dir,f),'utf8')));
const plan=JSON.parse(planRaw),draft=JSON.parse(draftRaw),identity=JSON.parse(identityRaw),market=JSON.parse(marketRaw);
assert.equal(draft.planHash,sha(planRaw));assert.equal(draft.identityAuditHash,sha(identityRaw));assert.equal(draft.marketAuditHash,sha(marketRaw));
for(const[file,hash]of Object.entries(draft.codeHashes))assert.equal(hash,sha(await readFile(resolve(root,file),'utf8')));
const rows=new Map(plan.newRevisions.map(r=>[r.id,r])),findings=[];
for(const d of draft.drafts){
 const old=rows.get(d.originalRevisionId),fresh=d.revision;assert.equal(sha(old),d.originalRevisionHash);assert.equal(fresh.provenanceJson.sourceMarketGuardRepair.originalRevisionId,old.id);
 assert.deepEqual(identity.findings.find(f=>f.revisionId===old.id).reasons,[]);
 const allowed=['id','semanticFingerprint','applicabilityJson','technicalDataJson','provenanceJson'];
 for(const key of Object.keys(old).filter(k=>!allowed.includes(k)))assert.deepEqual(fresh[key],old[key]);
 const {sourceMarketGuardRepair,...provenance}=fresh.provenanceJson;assert.deepEqual(provenance,old.provenanceJson);
 const evidence=market.findings.find(f=>f.revisionId===old.id),markets=[...new Set(evidence.checks.flatMap(c=>c.markets))];assert.equal(markets.length,1);const expectedMarket=markets[0];assert.ok(nonRu?expectedMarket!=='RU':expectedMarket==='RU');
 const {requiredMarket,...scope}=fresh.applicabilityJson;assert.equal(requiredMarket,expectedMarket);assert.deepEqual(scope,old.applicabilityJson);
 const tech=structuredClone(fresh.technicalDataJson);
 for(const b of tech.capacityBranches??[]){assert.equal(b.applicabilityJson.requiredMarket,expectedMarket);delete b.applicabilityJson.requiredMarket;}
 assert.deepEqual(tech,old.technicalDataJson);
 const originalScopes=old.technicalDataJson.capacityBranches?.map(b=>b.applicabilityJson)??[old.applicabilityJson];
 const newScopes=fresh.technicalDataJson.capacityBranches?.map(b=>b.applicabilityJson)??[fresh.applicabilityJson];assert.equal(originalScopes.length,newScopes.length);
 for(let i=0;i<originalScopes.length;i++){const {requiredMarket,...rest}=newScopes[i];assert.equal(requiredMarket,expectedMarket);assert.deepEqual(rest,originalScopes[i]);}
 const review=plan.sourceMarketScopeReview.find(e=>e.revision.id===old.id);assert.ok(review,'Source review must survive merge');
 assert.equal(sha(review.revision),sha(old));
 const sourceBranches=evidence.branches,coveredConditions=evidence.checks.map(c=>({engine:c.engine,powerHp:c.powerHp,window:c.currentWindow,market:expectedMarket}));
 // Do not subtract source branches here: an RU guard does not resolve early/late months,
 // other engine powers, or other markets. Merge must retain this explicit obligation.
 findings.push({originalRevisionId:old.id,replacementRevisionId:fresh.id,sourceRequirementId:old.sourceRequirementId,sourceReviewHash:sha(review),retainedSourceBranches:sourceBranches,restrictedCandidateConditions:coveredConditions,unresolvedSourceReviewMustRemain:true,publicationAllowed:false});
}
assert.equal(findings.length,nonRu?74:245);assert.equal(new Set(findings.map(f=>f.replacementRevisionId)).size,findings.length);
const summary={verifiedDrafts:findings.length,technicalValueChanges:0,sourceReviewObligationsPreserved:findings.length};
await writeFile(resolve(dir,nonRu?'non-ru-market-guard-draft-verification-v1.json':'ru-market-guard-draft-verification-v1.json'),JSON.stringify({planHash:sha(planRaw),draftHash:sha(draftRaw),summary,findings,productionApplyAllowed:false,limitation:'Structural verification that only market restrictions/provenance/semantic IDs change. All original source branch obligations must remain pending during merge; not a claim of complete source coverage.'},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(summary));
