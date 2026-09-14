import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,parseCopy} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-whole-source-current-recheck-2026-09-14');
const sql=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),sources=parseCopy(sql,'vehicle_fluid_requirements');assert.equal(sources.length,13296);
const planRaw=await readFile(resolve(root,'outputs/mann-gearbox-year-added-preview-2026-09-14/plan.json'),'utf8'),plan=JSON.parse(planRaw);
assert.equal(sha(planRaw),'9d961c0e9c9dbb4cad138d4192605b96350efc97c102aa1291911c87423fd6a7');
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{mannExplicitTransmissionTypeCount:parse}=await j.import('../src/lib/mann-transmission-component.ts'),{extractFluidSourceSystemContext:context}=await j.import('../src/lib/fluid-source-system-context.ts');
const entries=sources.flatMap(s=>{
 const parsed=parse(s.componentModel);if(!parsed)return [];
 const source=context(s.systemNameRaw,s.componentModel),label=s.systemNameRaw.trim().toUpperCase().replace(/\s+/g,' ').replace(/^(?:МАСЛО|ЖИДКОСТЬ) (?:В|ДЛЯ) /,'').match(/^(АКПП|МКПП|РОБОТ|РКПП|DCT|DSG)[ -](\d{1,2})$/);
 const reasons=[];
 if(!label)reasons.push('LABEL_NOT_EXACT_TYPE_COUNT');
 else{if(Number(label[2])!==parsed.gearCount)reasons.push('LABEL_COMPONENT_COUNT_CONFLICT');if((label[1]==='АКПП'?'automatic':label[1]==='МКПП'?'manual':'robot')!==parsed.type)reasons.push('LABEL_COMPONENT_TYPE_CONFLICT');}
 if(source.issues.length||source.hasAdditionalLabelConditions)reasons.push('SOURCE_LABEL_CONDITIONS');
 if(source.destinationSystemCode!==s.systemCode)reasons.push('DESTINATION_MISMATCH');
 if(s.transmissionType&&s.transmissionType!==parsed.type)reasons.push('SOURCE_TYPE_MISMATCH');
 return [{sourceRequirementId:s.id,originalSource:s,sourceHash:sha(s),parsedTypeCount:parsed,sourceContext:source,reasons,existingRevisionIds:plan.newRevisions.filter(r=>r.sourceRequirementId===s.id).map(r=>r.id),publicationAllowed:false}];
});
const report={scannedSources:sources.length,sourceHash:sha(sql),planHash:sha(planRaw),matchedSourceCount:entries.length,consistentLabels:entries.filter(e=>!e.reasons.length).length,needsLabelReview:entries.filter(e=>e.reasons.length).length,byMake:Object.fromEntries([...Map.groupBy(entries,e=>e.originalSource.make)].map(([k,v])=>[k,v.length])),entries,productionApplyAllowed:false,limitation:'Lexical source inventory only. Exact engine/power/year/market, source quality, protected associations and actual vehicle confirmation still require verification.'};
await writeFile(resolve(dir,'source-type-count-audit-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({...report,entries:undefined}));
