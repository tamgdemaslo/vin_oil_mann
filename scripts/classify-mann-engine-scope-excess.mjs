import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-bmw-body-restored-preview-2026-09-14');
const [planRaw,auditRaw]=await Promise.all([readFile(resolve(dir,'plan.json'),'utf8'),readFile(resolve(dir,'engine-subset-audit-v1.json'),'utf8')]);
const plan=JSON.parse(planRaw),audit=JSON.parse(auditRaw);assert.equal(audit.planHash,sha(planRaw));
const byId=new Map(plan.newRevisions.map(r=>[r.id,r]));
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {normalizeEngineCode:norm}=await jiti.import('../src/lib/vehicle-normalization.ts');
const {buildMannUnifiedTechnicalProfile:profile}=await jiti.import('../src/lib/mann-unified-technical-profile.ts');
const results=[];
for(const entry of audit.results.filter(r=>r.unsupported.length)){
  const revision=byId.get(entry.revisionId);assert.equal(sha(revision),entry.revisionHash);
  const codes=new Set(entry.mannEngineCodes),exact=entry.matchedEngineScope.filter(e=>codes.has(norm(e)));
  const scope=revision.technicalDataJson.capacityBranches?.[entry.scopeIndex]?.applicabilityJson??revision.applicabilityJson;
  const lexical=entry.unsupported.map(engine=>({engine,category:!/[0-9]/.test(engine)?'ALPHABETIC_FRAGMENT':
    /^\d[.,]\d/.test(engine)?'DISPLACEMENT_STYLE_LABEL':entry.mannEngineCodes.some(c=>c.startsWith(norm(engine))||norm(engine).startsWith(c))?
    'PREFIX_RELATION_UNPROVED':'DISTINCT_CODE_REQUIRES_EVIDENCE'}));
  const p=revision.provenanceJson;
  const runtime={...revision,createdAt:new Date('2026-09-14'),reviewConfirmed:false,run:{status:'COMPLETED',mode:'STAGING',
    independentHumanSignoff:false,productionApplyAuthorized:false,gatesJson:{catalogPreviewPolicy:p.catalogPreviewPolicy,
      conditionalTransmissionPolicy:p.conditionalTransmissionPolicy,conditionalEquipmentPolicy:p.conditionalEquipmentPolicy,automaticProductSelection:false}}};
  const probes=[];
  for(const engineCode of entry.unsupported){
    const ctx={...revision.applicabilityJson.sourceVehicleScope,engineCode,productionMonth:scope.window?.intersection?.from??scope.window?.intersection?.to};
    const shown=profile([runtime],undefined,ctx).items;
    probes.push({engineCode,context:ctx,itemsShown:shown.length});
  }
  results.push({...entry,exactTargetEngineScope:exact,lexical,probes,
    disposition:exact.length?'MIXED_SCOPE_EXACT_INTERSECTION_CANDIDATE':'NO_EXACT_ENGINE_REMAINS',
    capacityBranch:Boolean(revision.technicalDataJson.capacityBranches),publicationAllowed:false});
}
const counts=(xs,key)=>Object.fromEntries([...Map.groupBy(xs,key)].map(([k,v])=>[k,v.length]));
const report={planHash:sha(planRaw),auditHash:sha(auditRaw),summary:{scopeRecords:results.length,distinctRevisions:new Set(results.map(r=>r.revisionId)).size,
  dispositions:counts(results,r=>r.disposition),lexicalCounts:counts(results.flatMap(r=>r.lexical),r=>r.category),
  probedEngines:results.reduce((n,r)=>n+r.probes.length,0),shownNonliteralEngineProbes:results.flatMap(r=>r.probes).filter(r=>r.itemsShown>0).length},
  results,productionApplyAllowed:false,limitation:'Syntactic classification and actual local profile probes, not alias validation or engine applicability proof. Exact-intersection candidates need original-source/fullmake and monthly replay before narrowing; excluded source scopes must remain accounted.'};
await writeFile(resolve(dir,'engine-scope-excess-classification-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report.summary,null,2));
