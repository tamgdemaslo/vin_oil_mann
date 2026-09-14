import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {parseCopy, sha} from './lib/mann-offline-scope.mjs';

// Evidence inventory only: never infer an engine alias or approve a fluid.
const root=resolve(import.meta.dirname,'..');
const dir=resolve(root,'outputs/mann-exact-capacity-engine-preview-2026-09-14');
const [planRaw,auditRaw,sourceRaw,rawText]=await Promise.all([
  readFile(resolve(dir,'plan.json'),'utf8'),
  readFile(resolve(dir,'engine-subset-audit-v1.json'),'utf8'),
  readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),
  readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8'),
]);
const plan=JSON.parse(planRaw), audit=JSON.parse(auditRaw);
assert.equal(audit.planHash,sha(planRaw));
const sources=new Map(parseCopy(sourceRaw,'vehicle_fluid_requirements').map(s=>[s.id,s]));
const rows=rawText.trim().split('\n').map(JSON.parse);
const byId=new Map(rows.map(r=>[r.row_id,r]));
const byTable=Map.groupBy(rows,r=>JSON.stringify([r.source_url,r.table_index]));
const revisions=new Map(plan.newRevisions.map(r=>[r.id,r]));
const tokenPresent=(text,code)=>text.toUpperCase().split(/[^A-Z0-9.]+/).includes(code.toUpperCase());
const results=audit.results.filter(r=>r.status==='NO_EXPLICIT_ENGINE_SCOPE').map(a=>{
  const revision=revisions.get(a.revisionId),source=sources.get(a.sourceRequirementId);
  assert.equal(sha(revision),a.revisionHash);
  assert.ok(source);assert.equal(source.engineCodesJson.length,0);
  const row=byId.get(source.sourceRowId);assert.ok(row);
  assert.equal(row.source_url,source.sourceUrl);
  const anchors=byTable.get(JSON.stringify([row.source_url,row.table_index]))
    .filter(r=>/МАСЛО\s+в\s+ДВИГАТЕЛЬ/iu.test(r.application)&&r.model?.trim());
  const models=anchors.map(r=>r.model).join('\n');
  const literalTargetCodes=a.mannEngineCodes.filter(c=>tokenPresent(models,c));
  // Decimal suffix agreement is diagnostic, NOT proof that M/OM may be added.
  const sourceDecimalCodes=[...new Set([...models.matchAll(/\b\d{3}\.\d{3}\b/g)].map(m=>m[0]))];
  const targetDecimalCodes=a.mannEngineCodes.map(c=>c.match(/\d{3}\.\d{3}/)?.[0]).filter(Boolean);
  const sharedDecimalCodes=sourceDecimalCodes.filter(c=>targetDecimalCodes.includes(c));
  const hasCompressedTarget=a.mannEngineCodes.some(c=>/^\d{3}$/.test(c));
  const status=literalTargetCodes.length===a.mannEngineCodes.length&&literalTargetCodes.length
    ?'LITERAL_CODE_PRESENT_IN_RAW_IMPORT_LOSS'
    :hasCompressedTarget?'PREFIX_OR_COMPRESSED_FORMAT_REVIEW'
    :sourceDecimalCodes.length&&targetDecimalCodes.length&&!sharedDecimalCodes.length
      ?'DIFFERENT_DECIMAL_CODES_REVIEW'
      :sharedDecimalCodes.length?'PREFIX_OR_COMPRESSED_FORMAT_REVIEW'
        :anchors.length?'FAMILY_OR_NONLITERAL_ENGINE_REVIEW':'NO_ENGINE_ANCHOR';
  return {revisionId:a.revisionId,revisionHash:a.revisionHash,sourceRequirementId:source.id,
    sourceHash:sha(source),vehicleVariantKey:a.vehicleVariantKey,systemCode:a.systemCode,
    sourceUrl:source.sourceUrl,sourceRowId:row.row_id,sourceRowHash:sha(row),tableIndex:row.table_index,
    targetEngineCodes:a.mannEngineCodes,literalTargetCodes,sourceDecimalCodes,targetDecimalCodes,sharedDecimalCodes,status,
    anchors:anchors.map(r=>({rowId:r.row_id,rowHash:sha(r),model:r.model,application:r.application,
      fuelType:r.fuel_type,power:r.power,years:r.production_years})),
    originalRevision:revision,publicationAllowed:false};
});
assert.equal(results.length,26);
const summary=Object.fromEntries([...Map.groupBy(results,r=>r.status)].map(([k,v])=>[k,v.length]));
const report={planHash:sha(planRaw),engineAuditHash:sha(auditRaw),sourceHash:sha(sourceRaw),rawHash:sha(rawText),
  summary,results,productionApplyAllowed:false,
  limitation:'Raw same-table engine evidence only. Decimal agreement is not alias approval. Literal recovery still requires full-make rematch, source-condition preservation and profile tests. Plan unchanged.'};
await writeFile(resolve(dir,'engineless-source-context-v2.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({summary,details:results.map(r=>({system:r.systemCode,status:r.status,target:r.targetEngineCodes,source:r.anchors.map(a=>a.model)}))},null,2));
