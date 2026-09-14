import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha} from './lib/mann-offline-scope.mjs';
const dir=resolve(import.meta.dirname,'../outputs/mann-identity-scoped-2026-09-14');
const raw=await readFile(resolve(dir,'engine-line-scopes-v1.json'),'utf8'),branches=JSON.parse(raw);
const findings=branches.results.flatMap(branch=>{
  const lines=branch.literalLineContext.matchingLines.filter(l=>/кпп|вариатор|cvt|dsg|dct|робот/i.test(l.line));
  if(!lines.length)return [];
  return [{requirementId:branch.requirementId,engineCode:branch.engineCode,engineAnchorRowId:branch.engineAnchorRowId,
    hadEngineScope:Boolean(branch.scope),evidence:lines.map(l=>({line:l.line,
      explicitTransmissions:[...l.line.matchAll(/([мар])кпп\s*[-–—]?\s*(\d+)/gi)].map(m=>({type:({м:'manual',а:'automatic',р:'robot'})[m[1].toLowerCase()],gearCount:Number(m[2])}))})),
    reason:'ENGINE_LINE_TRANSMISSION_CONDITION_NOT_IN_ENGINE_SCOPE',publicationAllowed:false}];
});
const report={kind:'ENGINE_LINE_TRANSMISSION_CONDITION_AUDIT',branchHash:sha(raw),productionApplyAllowed:false,
  summary:{affectedBranches:findings.length,affectedRequirements:new Set(findings.map(r=>r.requirementId)).size,
    branchesWithEngineScope:findings.filter(r=>r.hadEngineScope).length},
  limitation:'Mandatory additional review gate, even if engine-only rematch succeeds. Extracted gearbox conditions are not confirmed VIN equipment.',findings};
await writeFile(resolve(dir,'engine-line-transmission-audit-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report.summary,null,2));
