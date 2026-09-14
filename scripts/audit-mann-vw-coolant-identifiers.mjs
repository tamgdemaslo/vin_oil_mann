import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-raw-date-preview-2026-09-14');
const sourceRaw=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),planRaw=await readFile(resolve(dir,'plan.json'),'utf8');
const plan=JSON.parse(planRaw);assert.equal(plan.inputHashes.source,sha(sourceRaw));
const aliases={F:'G12+',G:'G12++',J:'G13',L:'G12EVO'};
const inspect=text=>[...text.matchAll(/TL[\s-]*(?:VW[\s-]*)?774[\s-]*([FGJL])\s*\(\s*(G\s*1[23](?:\s*\+\s*\+?|\s*EVO)?)\s*\)/giu)]
  .map(m=>({literal:m[0],standard:`TL 774-${m[1].toUpperCase()}`,statedAlias:m[2].replace(/\s/g,'').toUpperCase(),expectedAlias:aliases[m[1].toUpperCase()]}));
assert.equal(inspect('VW TL 774-F (G12++)')[0].expectedAlias,'G12+');
assert.equal(inspect('VW TL 774-G (G12++)')[0].statedAlias,'G12++');
assert.equal(inspect('TL-VW 774 L (G12evo)')[0].statedAlias,'G12EVO');
const sources=parseCopy(sourceRaw,'vehicle_fluid_requirements'),findings=[];let explicitPairs=0;
for(const r of sources){
  if(r.systemCode!=='ENGINE_COOLANT')continue;
  const pairs=inspect(r.specificationText??'');explicitPairs+=pairs.length;
  const mismatches=pairs.filter(p=>p.statedAlias!==p.expectedAlias);if(!mismatches.length)continue;
  findings.push({requirementId:r.id,sourceHash:sha(r),sourceUrl:r.sourceUrl,sourceRowId:r.sourceRowId,specificationText:r.specificationText,mismatches,
    affectedRevisionIds:plan.newRevisions.filter(row=>row.sourceRequirementId===r.id).map(row=>row.id),
    status:'SOURCE_STANDARD_ALIAS_CONTRADICTION',automaticCorrectionAllowed:false,
    reason:'Cannot infer whether the standard code or the family name is the source typo.'});
}
const report={kind:'WHOLE_SOURCE_VW_COOLANT_IDENTIFIER_AUDIT',sourceHash:sha(sourceRaw),planHash:sha(planRaw),productionApplyAllowed:false,
  primaryEvidence:{url:'https://www.volkswagen-curacao.com/idhub/content/dam/onehub_pkw/importers/cw/manuals/Manual-Nivus.pdf',pdfPage:237,printedPage:235,
    use:'Identifier equivalence only. Nivus manual is not evidence of coolant applicability to Tiguan or any particular VIN.',aliases},
  summary:{sourceRequirements:sources.length,explicitParentheticalPairs:explicitPairs,contradictoryRequirements:findings.length,affectedRevisions:findings.reduce((n,f)=>n+f.affectedRevisionIds.length,0)},findings,
  limitation:'Exact parenthetical labels only, not all possible wording. No compatibility, mixing or vehicle applicability conclusions. Preserve both source strings pending authoritative correction.'};
await writeFile(resolve(dir,'vw-coolant-identifier-audit-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report.summary,null,2));
