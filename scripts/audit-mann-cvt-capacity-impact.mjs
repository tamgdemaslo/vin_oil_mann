import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-alphard-ru-preview-2026-09-14');
const [sourceRaw,planRaw]=await Promise.all([readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),readFile(resolve(dir,'plan.json'),'utf8')]);
const plan=JSON.parse(planRaw);assert.equal(plan.inputHashes.source,sha(sourceRaw));
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {parseConditionalFluidCapacities:parse}=await jiti.import('../src/lib/fluid-capacity-conditions.ts');
const sources=parseCopy(sourceRaw,'vehicle_fluid_requirements'),changes=[];
for(const source of sources){const parsed=parse(source.fillVolumeText,source.systemCode,source.engineCodesJson??[]);if(parsed.status==='structured'&&parsed.branches.some(b=>b.condition.kind==='transmission'&&b.condition.value==='cvt'))changes.push({sourceRequirementId:source.id,sourceHash:sha(source),make:source.make,model:source.model,systemCode:source.systemCode,originalText:source.fillVolumeText,branches:parsed.branches,publicationAllowed:false});}
const affected=plan.newRevisions.filter(r=>{const parsed=parse(r.technicalDataJson.fillVolumeText,r.systemCode,r.applicabilityJson.engineCodes??[]);return parsed.status==='structured'&&parsed.branches.some(b=>b.condition.kind==='transmission'&&b.condition.value==='cvt');}).map(r=>({id:r.id,sourceRequirementId:r.sourceRequirementId,hasStoredBranches:Boolean(r.technicalDataJson.capacityBranches?.length)}));
const report={sourceHash:sha(sourceRaw),planHash:sha(planRaw),parserHash:sha(await readFile(resolve(root,'src/lib/fluid-capacity-conditions.ts'),'utf8')),summary:{sourceRows:sources.length,newStructuredCvtSources:changes.length,affectedCurrentRevisions:affected.length},changes,affected,productionApplyAllowed:false,limitation:'CVT suffix was previously unsupported by conditional parser. This inventory is not source association or OEM approval; stored scopes and validation are still required.'};
await writeFile(resolve(dir,'cvt-capacity-parser-impact-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report.summary));
