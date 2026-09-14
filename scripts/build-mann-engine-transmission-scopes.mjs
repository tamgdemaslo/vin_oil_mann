import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-identity-scoped-2026-09-14');
const raw=await readFile(resolve(dir,'engine-line-scopes-v1.json'),'utf8');
const auditRaw=await readFile(resolve(dir,'engine-line-transmission-audit-v1.json'),'utf8');
const branches=JSON.parse(raw),audit=JSON.parse(auditRaw);assert.equal(audit.branchHash,sha(raw));
const key=r=>[r.requirementId,r.engineCode,r.engineAnchorRowId].join(':');
const byKey=new Map(branches.results.map(r=>[key(r),r]));
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {mannTechnicalScopeMatches:matches}=await jiti.import('../src/lib/mann-technical-applicability.ts');
const results=audit.findings.map(f=>{
  const branch=byKey.get(key(f));assert.ok(branch);
  const lines=branch.literalLineContext.matchingLines.filter(l=>/кпп|вариатор|cvt|dsg|dct|робот/i.test(l.line));
  assert.deepEqual(lines.map(l=>l.line),f.evidence.map(l=>l.line));
  const alternatives=f.evidence.flatMap(e=>e.explicitTransmissions),distinct=new Map(alternatives.map(t=>[sha(t),t]));
  const reasons=[];
  if(!branch.scope)reasons.push('ENGINE_LINE_SCOPE_REQUIRES_REVIEW');
  if(f.evidence.some(e=>e.explicitTransmissions.length!==1)||distinct.size!==1)reasons.push('TRANSMISSION_CONDITION_NOT_UNAMBIGUOUS');
  const requiredTransmission=distinct.size===1?[...distinct.values()][0]:null;
  if(requiredTransmission){
    const applicability={requiredTransmission};
    assert.equal(matches(applicability),false);
    assert.equal(matches(applicability,{confirmedTransmissionType:requiredTransmission.type,transmissionGearCount:requiredTransmission.gearCount}),true);
    assert.equal(matches(applicability,{confirmedTransmissionType:requiredTransmission.type,transmissionGearCount:requiredTransmission.gearCount+1}),false);
    for(const type of ['automatic','manual','cvt','robot'].filter(t=>t!==requiredTransmission.type))assert.equal(matches(applicability,{confirmedTransmissionType:type,transmissionGearCount:requiredTransmission.gearCount}),false);
  }
  return {...f,requiredTransmission,reasons,status:reasons.length?'REVIEW':'CONDITION_SCOPED_NEEDS_MATCH_AND_PROFILE_REPLAY',publicationAllowed:false};
});
const report={kind:'ENGINE_FLUID_TRANSMISSION_SCOPE_SUPPLEMENT',branchHash:sha(raw),auditHash:sha(auditRaw),
  runtimeHash:sha(await readFile(resolve(root,'src/lib/mann-technical-applicability.ts'),'utf8')),productionApplyAllowed:false,
  summary:{branches:results.length,scoped:results.filter(r=>!r.reasons.length).length,review:results.filter(r=>r.reasons.length).length},
  limitation:'Additional condition only; no publication rows. Requires rematch result, choice discovery, complete profile integration and source-condition review.',results};
await writeFile(resolve(dir,'engine-transmission-scopes-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report.summary,null,2));
