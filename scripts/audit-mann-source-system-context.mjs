import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-identity-scoped-2026-09-14');
const sourceRaw=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),sources=parseCopy(sourceRaw,'vehicle_fluid_requirements');
const jiti=createJiti(import.meta.url);
const {extractFluidSourceSystemContext:extract}=await jiti.import('../src/lib/fluid-source-system-context.ts');
const findings=sources.map(r=>({requirementId:r.id,sourceRowId:r.sourceRowId,sourceUrl:r.sourceUrl,sourceHash:sha(r),
  before:{systemCode:r.systemCode,transmissionType:r.transmissionType,componentModel:r.componentModel},
  extracted:extract(r.systemNameRaw,r.componentModel)}));
const systemCorrections=findings.filter(f=>f.extracted.destinationSystemCode&&f.extracted.destinationSystemCode!==f.before.systemCode);
const gearConditions=findings.filter(f=>f.extracted.transmissionGearCount!=null);
const old=JSON.parse(await readFile(resolve(dir,'source-system-label-audit.json'),'utf8'));
assert.equal(old.sourceSha256,sha(sourceRaw));
for(const f of old.systemFindings)assert.ok(systemCorrections.some(n=>n.requirementId===f.requirementId&&n.extracted.destinationSystemCode===f.explicitDestination));
for(const f of old.gearCountFindings)assert.ok(gearConditions.some(n=>n.requirementId===f.requirementId&&n.extracted.transmissionGearCount===f.explicitGearCount));
const plan=JSON.parse(await readFile(resolve(dir,'conditional-transmission-plan.json'),'utf8'));
const affectedPlan=plan.revisions.flatMap(r=>{
  const f=findings.find(f=>f.requirementId===r.sourceRequirementId);
  const reasons=[];
  if(f.extracted.destinationSystemCode&&f.extracted.destinationSystemCode!==r.systemCode)reasons.push('SYSTEM_DESTINATION_MISMATCH');
  if(f.extracted.transmissionGearCount!=null)reasons.push('GEAR_COUNT_REQUIRED');
  if(f.extracted.hasAdditionalLabelConditions)reasons.push('ADDITIONAL_SOURCE_LABEL_CONDITION');
  if(f.extracted.issues.length)reasons.push(...f.extracted.issues);
  return reasons.length?[{revisionId:r.id,requirementId:r.sourceRequirementId,reasons,extracted:f.extracted}]:[];
});
const report={kind:'FULL_SOURCE_EXPLICIT_SYSTEM_CONTEXT',requirements:findings.length,sourceHash:sha(sourceRaw),
  extractorHash:sha(await readFile(resolve(root,'src/lib/fluid-source-system-context.ts'),'utf8')),productionApplyAllowed:false,
  summary:{systemCorrections:systemCorrections.length,gearConditions:gearConditions.length,
    extraLabelConditions:findings.filter(f=>f.extracted.hasAdditionalLabelConditions).length,
    extractionIssues:findings.filter(f=>f.extracted.issues.length).length,affectedConditionalDrafts:affectedPlan.length},
  limitation:'Supplemental source metadata only; original records and technical values are unchanged. Must revalidate system-specific applicability before use.',
  systemCorrections,gearConditions,affectedPlan,findings};
await writeFile(resolve(dir,'source-system-context-v3.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report.summary,null,2));
