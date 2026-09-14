import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
import {splitSpecificationSections,specificationCautionSignals} from './lib/mann-specification-sections-v2.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-market-month-scoped-preview-2026-09-14');
const planRaw=await readFile(resolve(dir,'plan.json'),'utf8'),sql=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');
assert.equal(sha(planRaw),'df938f77959c226748b08a0d8d6bdae1c4ef978abc6bef065ea7bdce16364cc9');
assert.equal(sha(sql),'e802cacc05c23f8c21bc4d84bbf6796b15d9bb5be86e41964a028276fa4f92a0');
const plan=JSON.parse(planRaw),sources=parseCopy(sql,'vehicle_fluid_requirements');
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{parseSpecifications}=await jiti.import('../src/lib/fluid-catalog.ts');
const key=s=>`${s.type}|${s.value.toUpperCase().replace(/\s+/g,' ').trim()}`;
const parse=text=>parseSpecifications(text,[...new Set([...text.matchAll(/\b\d{1,2}W(?:-?\d{2})?\b/gi)].map(m=>m[0].toUpperCase()))]);
const statuses={},findings=[];
for(const source of sources){
 const sections=splitSpecificationSections(source.specificationText,source.analogText),cautions=specificationCautionSignals(source.specificationText);
 statuses[sections.status]=(statuses[sections.status]??0)+1;
 if(sections.status==='NO_EXPLICIT_MARKER'&&!source.analogText&&!cautions.length)continue;
 const f={sourceRequirementId:source.id,sourceHash:sha(source),originalSource:source,sections,cautions,
  candidateRevisionIds:plan.newRevisions.filter(r=>r.sourceRequirementId===source.id).map(r=>r.id),publicationAllowed:false};
 if(sections.status==='EXPLICIT_ANALOG_SEPARATED'){
  assert.equal(sections.main.text+sections.marker.text+sections.analog.text+sections.suffix.text,source.specificationText);
  f.parsedByRole={mainSource:parse(sections.main.text),unverifiedAnalog:parse(sections.analog.text),metadataOrCaution:parse(sections.suffix.text)};
  const sets=Object.fromEntries(Object.entries(f.parsedByRole).map(([role,specs])=>[role,new Set(specs.filter(s=>s.type!=='RAW').map(key))]));
  f.existingSpecificationRoles=source.specificationsJson.filter(s=>s.type!=='RAW').map(spec=>({specification:spec,
   roles:Object.keys(sets).filter(role=>sets[role].has(key(spec)))}));
  f.suffixOnly=f.existingSpecificationRoles.filter(s=>s.roles.includes('metadataOrCaution')&&!s.roles.includes('mainSource')&&!s.roles.includes('unverifiedAnalog'));
  f.analogOnly=f.existingSpecificationRoles.filter(s=>s.roles.includes('unverifiedAnalog')&&!s.roles.includes('mainSource'));
  f.unexplained=f.existingSpecificationRoles.filter(s=>!s.roles.length);
  f.mainCautions=specificationCautionSignals(sections.main.text);
 }
 findings.push(f);
}
const summary={examined:sources.length,statuses,reviewed:findings.length,cautionSources:findings.filter(f=>f.cautions.length).length,
 suffixOnlySources:findings.filter(f=>f.suffixOnly?.length).length,
 suffixOnlyCandidateRevisions:findings.filter(f=>f.suffixOnly?.length).reduce((n,f)=>n+f.candidateRevisionIds.length,0),
 analogOnlySources:findings.filter(f=>f.analogOnly?.length).length,
 analogOnlyCandidateRevisions:findings.filter(f=>f.analogOnly?.length).reduce((n,f)=>n+f.candidateRevisionIds.length,0),
 unexplainedSources:findings.filter(f=>f.unexplained?.length).length};
const codeHashes=Object.fromEntries(await Promise.all(['src/lib/fluid-catalog.ts','scripts/lib/mann-specification-sections.mjs','scripts/lib/mann-specification-sections-v2.mjs','scripts/audit-mann-specification-attribution-v2.mjs'].map(async p=>[p,sha(await readFile(resolve(root,p),'utf8'))])));
await writeFile(resolve(dir,'specification-attribution-v2.json'),JSON.stringify({planHash:sha(planRaw),sourceHash:sha(sql),codeHashes,summary,findings,productionApplyAllowed:false,canonicalPlanChanged:false,limitations:['Role attribution is not OEM verification or semantic prohibition classification.','No runtime integration; no fields removed.','Multiple analog branches preserved for separate scoped parsing.','Caution wording list is not exhaustive.']},null,2)+'\n',{flag:'wx'});
assert.equal(sha(await readFile(resolve(dir,'plan.json'),'utf8')),sha(planRaw));
console.log(JSON.stringify(summary));
