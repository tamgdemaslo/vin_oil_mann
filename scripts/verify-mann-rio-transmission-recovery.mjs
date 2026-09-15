import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {parseCopy,sha,applicabilityWindow} from './lib/mann-offline-scope.mjs';
import {conditionalVehicleIdentityReasons} from './lib/mann-conditional-vehicle-identity.mjs';
const dir=resolve('outputs/mann-live-audit-1789469257907');
const raw=await readFile(resolve(dir,'transmission-source-gap-audit-v2.json'),'utf8'),audit=JSON.parse(raw);
const sr=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),mr=await readFile('/tmp/mann_filter_applications.sql','utf8');
assert.equal(sha(sr),audit.sourceHash);assert.equal(sha(mr),audit.mannHash);
const sources=new Map(parseCopy(sr,'vehicle_fluid_requirements').map(r=>[r.id,r])),mann=parseCopy(mr,'mann_filter_applications');
const findings=[];
for(const f of audit.findings.filter(f=>f.model==='rio')){
  const s=sources.get(f.sourceId);assert.equal(sha(s),f.sourceHash);assert.equal(f.links.length,0);
  for(const c of f.decision.topCandidates){
    if(c.hardConflicts.length||c.score<80||c.reviewBlockers.length!==1||c.reviewBlockers[0]!=='MANN variant не подтверждает тип или модель коробки'||conditionalVehicleIdentityReasons(s,c).length)continue;
    for(const key of c.variantIds){
      const rows=mann.filter(r=>r.vehicleVariantKey===key);assert.ok(rows.length);
      const windows=rows.map(r=>applicabilityWindow(s,r));assert.ok(windows.every(Boolean));
      assert.equal(new Set(windows.map(sha)).size,1);
      assert.equal(s.engineCodeNormalized,'G4LC');assert.equal(s.generation,'IV');
      findings.push({sourceId:s.id,sourceHash:sha(s),key,system:s.systemCode,sourceUrl:s.sourceUrl,window:windows[0],sourceComponent:s.componentModel,fillVolumeText:s.fillVolumeText,specificationText:s.specificationText,
        identityEvidence:c,recordedContextMatches:f.contexts.filter(x=>x.variantIds.includes(key)).map(x=>({sampleRef:x.sampleRef,year:x.context.year,engine:x.context.engineCode})),
        requiredUserChoice:s.transmissionType,status:'IDENTITY_PASSES_WITH_EXPLICIT_TRANSMISSION_CHOICE',remainingChecks:['source specification attribution','capacity/service-condition parser','joint persisted profile and negative scope checks','separate bounded import with current-state guards']});
    }
  }
}
assert.ok(findings.length>=2);
const report={kind:'RIO_TRANSMISSION_RECOVERY_PREFLIGHT',auditHash:sha(raw),findings,productionApplyAllowed:false,limitations:['No source facts rewritten, no current plan changes.','Candidate identity evidence does not prove installed gearbox.','Not yet a tested revision or production import.']};
await writeFile(resolve(dir,'rio-transmission-recovery-preflight.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({sourceRows:new Set(findings.map(f=>f.sourceId)).size,associations:findings.length,recordedCandidateAssociations:findings.filter(f=>f.recordedContextMatches.length).length,windows:findings.map(f=>f.window.intersection)}));
