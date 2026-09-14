import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-identity-scoped-2026-09-14');
const raw=await readFile(resolve(dir,'aggregate-source-context-v1.json'),'utf8'),audit=JSON.parse(raw);
const sourceRaw=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');assert.equal(sha(sourceRaw),audit.sourceHash);
const sources=new Map(parseCopy(sourceRaw,'vehicle_fluid_requirements').map(r=>[r.id,r]));
const corrections=[],deferred=[];
for(const finding of audit.findings.filter(f=>f.rematchRequired)){
  const source=sources.get(finding.requirementId);assert.ok(source);assert.equal(sha(source),finding.sourceHash);
  const name=source.systemNameRaw.normalize('NFKC').toUpperCase().replace(/\s+/g,' ').trim();
  // Positive destination prefix only. A generic fallback is not authority to
  // erase an existing front/rear distinction or combine several circuits.
  let destination=null;
  if(/^МАСЛО В ГУР(?=$|\s)/.test(name))destination='POWER_STEERING';
  else if(/^МАСЛО В РАЗДАТОЧНУЮ КОРОБКУ(?=$|\s)/.test(name))destination='TRANSFER_CASE';
  else if(/^МАСЛО В ЗАДНИЙ ДИФФЕРЕНЦИАЛ(?=$|\s)/.test(name))destination='REAR_DIFFERENTIAL';
  else if(/^МАСЛО В ДИФФЕРЕНЦИАЛ (?:(?:ОТ )?АКПП|ВАРИАТОРА|В БЛОКЕ С МКПП)(?=$|\s)/.test(name))destination='DIFFERENTIAL_GENERIC';
  if(!destination){
    deferred.push({requirementId:source.id,sourceHash:sha(source),sourceUrl:source.sourceUrl,systemNameRaw:source.systemNameRaw,
      originalSystem:source.systemCode,suggestedSystem:finding.metadata.systemCode,
      disposition:'NO_POSITIVE_DESTINATION_CORRECTION',reason:'Fallback generic label is insufficient; original specialized/compound circuits require separate review'});
    continue;
  }
  assert.equal(destination,finding.metadata.systemCode);assert.notEqual(destination,source.systemCode);
  const reasons=[...finding.metadata.issues];
  // Never move a gearbox-derived type into steering applicability. Keep it as
  // original evidence and require independent same-table context reconstruction.
  if(source.transmissionType)reasons.push('INHERITED_TRANSMISSION_TYPE_REQUIRES_CONTEXT_REBUILD');
  corrections.push({requirementId:source.id,sourceRowId:source.sourceRowId,sourceHash:sha(source),sourceUrl:source.sourceUrl,
    before:{systemCode:source.systemCode,transmissionType:source.transmissionType},proposedSystemCode:destination,
    evidenceLabel:source.systemNameRaw,sourceMetadata:finding.metadata,
    technicalHash:sha({fillVolumeText:source.fillVolumeText,specifications:source.specificationsJson,viscosityGrades:source.viscosityGradesJson}),
    requiredReviews:[...new Set(reasons)],publicationAllowed:false});
}
assert.equal(corrections.length+deferred.length,audit.summary.destinationCorrections);
const report={kind:'POSITIVE_DESTINATION_CORRECTION_TRIAGE',auditHash:sha(raw),sourceHash:sha(sourceRaw),productionApplyAllowed:false,
  summary:{checked:corrections.length+deferred.length,positiveDestinationCorrections:corrections.length,genericFallbackNotAccepted:deferred.length,
    byDestination:Object.fromEntries([...Map.groupBy(corrections,r=>r.proposedSystemCode)].map(([k,v])=>[k,v.length]))},
  limitation:'Proposed system field only, not applied. Inherited transmission context and residual circuit/model conditions must be rebuilt before rematching or publishing.',corrections,deferred};
await writeFile(resolve(dir,'destination-correction-triage-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report.summary,null,2));
