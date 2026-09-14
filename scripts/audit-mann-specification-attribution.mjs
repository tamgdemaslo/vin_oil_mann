import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
import {splitSpecificationSections} from './lib/mann-specification-sections.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-market-month-scoped-preview-2026-09-14');
const planRaw=await readFile(resolve(dir,'plan.json'),'utf8'),sql=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');
assert.equal(sha(planRaw),'df938f77959c226748b08a0d8d6bdae1c4ef978abc6bef065ea7bdce16364cc9');
assert.equal(sha(sql),'e802cacc05c23f8c21bc4d84bbf6796b15d9bb5be86e41964a028276fa4f92a0');
const plan=JSON.parse(planRaw),sources=parseCopy(sql,'vehicle_fluid_requirements');
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {parseSpecifications}=await jiti.import('../src/lib/fluid-catalog.ts');
const grades=text=>[...new Set([...text.matchAll(/\b\d{1,2}W(?:-?\d{2})?\b/gi)].map(m=>m[0].toUpperCase()))];
const key=s=>`${s.type}|${s.value.toUpperCase().replace(/\s+/g,' ').trim()}`;
const findings=[],allStatuses={};
for(const source of sources){
 const sections=splitSpecificationSections(source.specificationText,source.analogText);
 allStatuses[sections.status]=(allStatuses[sections.status]??0)+1;
 if(sections.status==='NO_EXPLICIT_MARKER'&&!source.analogText)continue;
 const base={sourceRequirementId:source.id,sourceHash:sha(source),originalSource:source,sections,
  candidateRevisionIds:plan.newRevisions.filter(r=>r.sourceRequirementId===source.id).map(r=>r.id),publicationAllowed:false};
 if(sections.status!=='EXPLICIT_ANALOG_SEPARATED'){findings.push({...base,requiresManualBoundaryReview:true});continue;}
 assert.equal(sections.main.text+sections.marker.text+sections.analog.text+sections.suffix.text,source.specificationText);
 // Never pass legacy SAE grades: they may originate in the analog section.
 const mainSpecs=parseSpecifications(sections.main.text,grades(sections.main.text));
 const analogSpecs=parseSpecifications(sections.analog.text,grades(sections.analog.text));
 const mainKeys=new Set(mainSpecs.filter(s=>s.type!=='RAW').map(key));
 const analogKeys=new Set(analogSpecs.filter(s=>s.type!=='RAW').map(key));
 const existing=source.specificationsJson.filter(s=>s.type!=='RAW');
 const analogOnly=existing.filter(s=>analogKeys.has(key(s))&&!mainKeys.has(key(s)));
 const both=existing.filter(s=>analogKeys.has(key(s))&&mainKeys.has(key(s)));
 const unexplained=existing.filter(s=>!analogKeys.has(key(s))&&!mainKeys.has(key(s)));
 findings.push({...base,mainSourceSpecifications:mainSpecs,unverifiedAnalogSpecifications:analogSpecs,
  analogOnlyExistingSpecifications:analogOnly,sharedMainAndAnalogSpecifications:both,unexplainedExistingSpecifications:unexplained,
  mainSourceViscosityGrades:grades(sections.main.text),analogViscosityGrades:grades(sections.analog.text),
  mainTextWithoutRecognizedStructuredSpec:!mainKeys.size,requiresManualBoundaryReview:false,
  limitation:'Main-source statement is not OEM approval. RAW main text retained even if current recognizer cannot parse product. Not a publication-ready technical replacement.'});
}
const affected=findings.filter(f=>f.analogOnlyExistingSpecifications?.length);
const summary={examined:sources.length,allStatuses,reviewed:findings.length,analogOnlySources:affected.length,
 affectedPreviewRevisions:affected.reduce((n,f)=>n+f.candidateRevisionIds.length,0),
 sharedSources:findings.filter(f=>f.sharedMainAndAnalogSpecifications?.length).length,
 unrecognizedMainSources:findings.filter(f=>f.mainTextWithoutRecognizedStructuredSpec).length,
 unexplainedSources:findings.filter(f=>f.unexplainedExistingSpecifications?.length).length};
const report={planHash:sha(planRaw),sourceHash:sha(sql),codeHashes:Object.fromEntries(await Promise.all(['src/lib/fluid-catalog.ts','scripts/lib/mann-specification-sections.mjs','scripts/audit-mann-specification-attribution.mjs'].map(async p=>[p,sha(await readFile(resolve(root,p),'utf8'))]))),summary,findings,canonicalPlanChanged:false,productionApplyAllowed:false};
await writeFile(resolve(dir,'specification-attribution-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
assert.equal(sha(await readFile(resolve(dir,'plan.json'),'utf8')),sha(planRaw));
console.log(JSON.stringify(summary));
