import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-identity-scoped-2026-09-14');
const raw=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),sources=parseCopy(raw,'vehicle_fluid_requirements');
const systemFindings=[],gearCountFindings=[];
for(const r of sources){
  const name=String(r.systemNameRaw??'').toUpperCase();
  // Audit signals from the explicit destination, not fluid grade or volume.
  let destination=null;
  if(/(?:В|ДЛЯ)\s+РАЗДАТОЧН/.test(name))destination='TRANSFER_CASE';
  else if(/(?:В|ДЛЯ)\s+ЗАДНИ[ЙЕГО]+\s+(?:ДИФФЕРЕНЦИАЛ|РЕДУКТОР)/.test(name))destination='REAR_DIFFERENTIAL';
  else if(/(?:В|ДЛЯ)\s+ПЕРЕДНИ[ЙЕГО]+\s+(?:ДИФФЕРЕНЦИАЛ|РЕДУКТОР)/.test(name))destination='FRONT_DIFFERENTIAL';
  if(destination&&r.systemCode!==destination)systemFindings.push({requirementId:r.id,sourceRowId:r.sourceRowId,sourceUrl:r.sourceUrl,
    sourceName:r.systemNameRaw,storedSystem:r.systemCode,explicitDestination:destination,componentModel:r.componentModel,transmissionType:r.transmissionType});
  const gear=name.match(/\b(АКПП|МКПП|AT|MT)[ -]+([4-9]|10)(?!\d)/u)??name.match(/(АКПП|МКПП)[ -]+([4-9]|10)(?!\d)/u);
  if(gear&&/^(?:[-—]|NONE|N\/A)?$/i.test(String(r.componentModel??'').trim()))gearCountFindings.push({requirementId:r.id,sourceRowId:r.sourceRowId,
    sourceUrl:r.sourceUrl,sourceName:r.systemNameRaw,storedSystem:r.systemCode,componentModel:r.componentModel,explicitGearCount:Number(gear[2]),
    limitation:'Gear count is an additional condition, not an identified gearbox model.'});
}
const report={kind:'FULL_SOURCE_SYSTEM_LABEL_AUDIT',requirements:sources.length,sourceSha256:sha(raw),productionApplyAllowed:false,
  suspectedSystemMisclassifications:systemFindings.length,gearCountMissingFromComponent:gearCountFindings.length,
  limitation:'Explicit name-pattern audit, not an exhaustive source-system parser or permission to auto-correct technical data.',systemFindings,gearCountFindings};
await writeFile(resolve(dir,'source-system-label-audit.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({...report,systemFindings:undefined,gearCountFindings:undefined},null,2));
