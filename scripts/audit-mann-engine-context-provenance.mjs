import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-identity-scoped-2026-09-14');
const snapshotRaw=await readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8');
const sourceRaw=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),coverageRaw=await readFile(resolve(root,'outputs/mann-equipment-inclusive-preview-2026-09-14/full-source-coverage.json'),'utf8');
const coverage=JSON.parse(coverageRaw);assert.equal(sha(sourceRaw),coverage.sourceHash);
const original=parseCopy(sourceRaw,'vehicle_fluid_requirements'),rawRows=snapshotRaw.trim().split('\n').map(JSON.parse),byRow=new Map(rawRows.map(r=>[r.row_id,r]));
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {prepareFluidCatalog}=await jiti.import('../src/lib/fluid-catalog.ts');
const {normalizeFluidRequirementVehicle:normalize}=await jiti.import('../src/lib/mann-fluid-matcher-v2.ts');
const {normalizeEngineCode}=await jiti.import('../src/lib/vehicle-normalization.ts');
const prepared=prepareFluidCatalog({rowsNdjson:snapshotRaw,mannFiltersCsv:''});
assert.equal(prepared.requirements.length,original.length);
const engineRows=prepared.requirements.filter(r=>r.systemCode==='ENGINE_OIL');
const tableKey=r=>`${r.source_url}|${r.table_index}`;
const byTable=Map.groupBy(engineRows,r=>tableKey(byRow.get(r.sourceRowId)));
const unresolved=new Set(coverage.rows.filter(r=>r.status!=='IN_LOCAL_PREVIEW_PLAN').map(r=>r.requirementId));
const selected=original.filter(r=>unresolved.has(r.id)&&['ENGINE_OIL','ENGINE_COOLANT','BRAKE_FLUID'].includes(r.systemCode)&&(normalize(r)?.sourceExactEngineCodes.length??0)>=5);
const findings=[];
for(const source of selected){
  const raw=byRow.get(source.sourceRowId);assert.ok(raw);
  const anchors=source.systemCode==='ENGINE_OIL'?engineRows.filter(r=>r.sourceRowId===source.sourceRowId):byTable.get(tableKey(raw))??[];
  const codes=normalize(source).sourceExactEngineCodes;
  const branches=codes.map(engineCode=>{
    const matching=anchors.filter(r=>(r.engineCodesJson??[]).map(normalizeEngineCode).includes(engineCode));
    const evidence=matching.map(r=>{
      const anchor=byRow.get(r.sourceRowId);assert.equal(tableKey(anchor),tableKey(raw));
      return {engineRequirementId:r.id,sourceRowId:anchor.row_id,rawRowHash:sha(anchor),rowIndex:anchor.row_index,model:anchor.model,
        rawApplication:anchor.application,rawProductionYears:anchor.production_years,
        context:{yearFrom:r.yearFrom,yearTo:r.yearTo,engineVolumeCc:r.engineVolumeCc,powerHp:r.powerHp,powerKw:r.powerKw,fuelType:r.fuelType},
        contextConfidence:r.contextConfidence};
    });
    return {engineCode,status:evidence.length?'ENGINE_ROW_EVIDENCE_FOUND':'UNTRACEABLE_ENGINE_CODE',evidence,
      differsFromCombinedYears:evidence.some(r=>r.context.yearFrom!==source.yearFrom||r.context.yearTo!==source.yearTo)};
  });
  findings.push({requirementId:source.id,sourceRowId:source.sourceRowId,sourceUrl:source.sourceUrl,sourceHash:sha(source),rawRowHash:sha(raw),
    tableIndex:raw.table_index,originalYears:{from:source.yearFrom,to:source.yearTo},
    contextOrigin:source.systemCode==='ENGINE_OIL'?'OWN_ENGINE_ROW':'SAME_TABLE_ENGINE_ROWS',
    status:branches.every(r=>r.evidence.length)?'ENGINE_LIST_PROVENANCE_TRACED':'REVIEW',branches,publicationAllowed:false});
}
const branches=findings.flatMap(r=>r.branches);
const report={kind:'LARGE_ENGINE_LIST_RAW_CONTEXT_PROVENANCE',sourceHash:sha(sourceRaw),snapshotHash:sha(snapshotRaw),coverageHash:sha(coverageRaw),
  parserHash:sha(await readFile(resolve(root,'src/lib/fluid-catalog.ts'),'utf8')),productionApplyAllowed:false,
  summary:{requirements:findings.length,tracedRequirements:findings.filter(r=>r.status==='ENGINE_LIST_PROVENANCE_TRACED').length,
    engineBranches:branches.length,untraceableCodes:branches.filter(r=>!r.evidence.length).length,
    branchesWithDifferentEngineYears:branches.filter(r=>r.differsFromCombinedYears).length,
    requirementsWithDifferentEngineYears:findings.filter(r=>r.branches.some(b=>b.differsFromCombinedYears)).length},
  limitation:'Raw same-table engine lineage only, not OEM fact validation. Per-engine years/power/fuel alternatives must be retained and reranked; do not publish prior broad-year diagnostic matches.',findings};
await writeFile(resolve(dir,'large-engine-context-provenance-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report.summary,null,2));
