import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
const dir='outputs/mann-live-audit-1789479529769';
const raw=readFileSync('/tmp/vehicle_fluid_requirements.sql','utf8');
assert.equal(sha(raw),'e802cacc05c23f8c21bc4d84bbf6796b15d9bb5be86e41964a028276fa4f92a0');
const rows=parseCopy(raw,'vehicle_fluid_requirements');
const live=JSON.parse(readFileSync(`${dir}/revisions.json`,'utf8'));
const j=createJiti(import.meta.url,{alias:{'@':resolve('src')}});
const {parseFluidCapacities}=await j.import('../src/lib/fluid-capacity-parser.ts');
const findings=[];
for(const r of rows){
 if(!/полн[а-яё]*\s+(?:аппаратн[а-яё]*\s+)?замен[а-яё]*/iu.test(r.fillVolumeText??''))continue;
 const parsed=parseFluidCapacities(r.fillVolumeText,r.systemCode);
 const linked=live.filter(x=>x.sourceRequirementId===r.id);
 findings.push({sourceId:r.id,make:r.make,model:r.model,engine:r.engineCodeNormalized,system:r.systemCode,raw:r.fillVolumeText,parsed,hasTotal:parsed.capacities.some(c=>c.kind==='TOTAL'),live:linked.map(x=>({id:x.id,state:x.state,applyEligible:x.applyEligible,capacities:x.technicalDataJson?.capacities??null}))});
}
const kodiaq=findings.find(r=>r.sourceId==='254fc62a0ec9412c735eba0e30a8ffe061f65c7792a0a270804fe14d8ef0e05d');
assert.ok(kodiaq);assert.equal(kodiaq.hasTotal,true);assert.equal(kodiaq.parsed.needsReview,false);
const summary={sourceRows:rows.length,explicitFullReplacementRows:findings.length,withTotalKind:findings.filter(r=>r.hasTotal).length,withoutReview:findings.filter(r=>r.hasTotal&&!r.parsed.needsReview).length,linkedRevisions:findings.reduce((n,r)=>n+r.live.length,0)};
const output=`${dir}/full-replacement-context-audit-${Date.now()}.json`;
writeFileSync(output,JSON.stringify({generatedAt:new Date().toISOString(),summary,findings,productionChanged:false,limitation:'A TOTAL elsewhere in a multi-volume row can be legitimate. Each marker-to-volume attribution needs checking; these counts are candidates, not confirmed incorrect links.',kodiaqFinding:'The source says full replacement, while parser emits TOTAL and profile labels TOTAL as full capacity. Do not publish as confirmed total capacity.'},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({output,summary}));
