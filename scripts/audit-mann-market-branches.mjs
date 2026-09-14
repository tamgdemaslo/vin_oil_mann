import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sourceMarketBranches} from './lib/mann-source-market-branches.mjs';
import {sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'), dir=resolve(root,'outputs/mann-solaris-ru-restored-preview-2026-09-14');
assert.equal(sourceMarketBranches('- G4FA / 107 л.с. / Россия','2010 - 2017')[0].market,'RU');
assert.equal(sourceMarketBranches('- 2GD-FTV / 150 л.с. / 2017-н.в. / Япония','2015 - н.в.')[0].window.to,null);
assert.equal(sourceMarketBranches('- G4KD / 156 л.с. / Россия / 2009-2010 г. - G4KD / 150 л.с. / Россия / 2010-2013 г.','2008 - 2013').length,2);
for(const s of ['G4FA / 107 л.с. / Россия','- G4FA / 107 л.с. / Россия примечание','- G4FA / 107 л.с. / Россия / Япония','- G4FA / 107 л.с. / Россия / 2020-2010','- G4FA / 107, 107 л.с. / Россия','- G4FA / 107 л.с. / Россия - неизвестная ветка']) assert.equal(sourceMarketBranches(s,'2010 - 2017'),null);
const input=await readFile(resolve(dir,'source-market-context-audit-v1.json'),'utf8'),audit=JSON.parse(input),planRaw=await readFile(resolve(dir,'plan.json'),'utf8');
assert.equal(audit.planHash,sha(planRaw));
const normalized=code=>code.replaceAll('-','');
const findings=audit.findings.map(f=>{
 const branches=sourceMarketBranches(f.anchor.model,f.anchor.production_years);
 const scopes=f.scopes.map((scope,index)=>{
  const engines=scope.matchedEngineScope??[], selected=branches?.filter(b=>engines.some(e=>normalized(e)===normalized(b.engineCode)))??[];
  const missingEngines=engines.filter(e=>!selected.some(b=>normalized(b.engineCode)===normalized(e)));
  return {index,requiredMarket:scope.requiredMarket??null,engines,missingEngines,selected,markets:[...new Set(selected.map(b=>b.market))],currentWindow:scope.window?.intersection??null};
 });
 return {revisionId:f.revisionId,sourceRequirementId:f.sourceRequirementId,anchorHash:f.anchorHash,make:f.make,model:f.model,rawModel:f.anchor.model,branches,scopes,status:!branches?'UNPARSED_FULL_SOURCE':scopes.some(s=>!s.engines.length||s.missingEngines.length)?'ENGINE_BRANCH_NOT_COVERED':'BRANCHES_PARSED_REQUIRES_TARGET_POWER_AND_DATE_CHECK',publicationAllowed:false};
});
const summary={findings:findings.length,uniqueAnchors:new Set(findings.map(f=>f.anchorHash)).size,statusCounts:Object.fromEntries([...Map.groupBy(findings,f=>f.status)].map(([k,v])=>[k,v.length])),parsedUniqueAnchors:new Set(findings.filter(f=>f.branches).map(f=>f.anchorHash)).size};
await writeFile(resolve(dir,'source-market-branch-triage-v1.json'),JSON.stringify({planHash:sha(planRaw),inputHash:sha(input),helperHash:sha(await readFile(resolve(root,'scripts/lib/mann-source-market-branches.mjs'),'utf8')),summary,findings,productionApplyAllowed:false,limitation:'Source branch extraction only. No scope changes, no target power validation, no OEM verification. Every selected branch must be reconciled with target power and dates before market assignment.'},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(summary));
