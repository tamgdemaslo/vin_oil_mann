import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-identity-scoped-2026-09-14');
const raw=await readFile(resolve(dir,'destination-correction-triage-v1.json'),'utf8'),triage=JSON.parse(raw);
const sourceRaw=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),mannRaw=await readFile('/tmp/mann_filter_applications.sql','utf8');
assert.equal(sha(sourceRaw),triage.sourceHash);
const overlay=await loadIdentityOverlay(root,sourceRaw,resolve(dir,'source-identity-corrections.json'));
const snapshotRaw=await readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8');
assert.equal(sha(snapshotRaw),overlay.metadata.sourceHashes.snapshot);
const rawRows=new Map(snapshotRaw.trim().split('\n').map(JSON.parse).map(r=>[r.row_id,r]));
const sources=new Map(overlay.requirements.map(r=>[r.id,r])),rows=parseCopy(mannRaw,'mann_filter_applications');
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {prepareFluidCatalog}=await jiti.import('../src/lib/fluid-catalog.ts');
const {matchFluidRequirementToMann:match,normalizeFluidRequirementVehicle:normalize}=await jiti.import('../src/lib/mann-fluid-matcher-v2.ts');
const {mannMakeFormsForTest}=await jiti.import('../src/lib/mann-vehicle-resolver.ts');
const {normalizeMannText}=await jiti.import('../src/lib/mann-catalog.ts');
const parsed=new Map(prepareFluidCatalog({rowsNdjson:snapshotRaw,mannFiltersCsv:''}).requirements.map(r=>[r.id,r]));
const cache=new Map(),results=[];
for(const correction of triage.corrections){
  const original=overlay.originalById.get(correction.requirementId),source=sources.get(correction.requirementId),row=rawRows.get(source.sourceRowId),prepared=parsed.get(source.id);
  assert.equal(sha(original),correction.sourceHash);assert.ok(row&&prepared);
  assert.equal(row.table_kind,'vehicle_fluids');assert.ok(['row_engine','table_engine','page'].includes(prepared.contextConfidence));
  // In this parser path contextFromRows always sets transmissionType:null;
  // buildRequirement derives the old type solely from the misclassified system.
  // Matrix rows must not enter this correction rule.
  const inferred={AUTOMATIC_TRANSMISSION:'automatic',MANUAL_TRANSMISSION:'manual',CVT_TRANSMISSION:'cvt'}[original.systemCode];
  assert.ok(inferred);assert.equal(original.transmissionType,inferred);assert.equal(prepared.transmissionType,inferred);
  const corrected={...source,systemCode:correction.proposedSystemCode,transmissionType:null};
  for(const k of Object.keys(source).filter(k=>!['systemCode','transmissionType'].includes(k)))assert.deepEqual(corrected[k],source[k]);
  const make=normalize(corrected)?.canonicalMake;assert.ok(make);
  if(!cache.has(make)){const forms=new Set(mannMakeFormsForTest(make));cache.set(make,rows.filter(r=>forms.has(normalizeMannText(r.makeNormalized||r.make))));}
  const decision=match(corrected,cache.get(make));
  results.push({requirementId:source.id,sourceHash:sha(original),rawRowHash:sha(row),sourceUrl:source.sourceUrl,
    before:correction.before,proposedFields:{systemCode:corrected.systemCode,transmissionType:null},
    contextEvidence:{tableKind:row.table_kind,contextConfidence:prepared.contextConfidence,typeOrigin:'MISCLASSIFIED_SYSTEM_DEFAULT',
      attachedTransmissionType:correction.sourceMetadata.attachedTransmissionType,sourceLabel:source.systemNameRaw},
    unresolvedConditions:correction.sourceMetadata.issues,matchStatus:decision.status,reviewReasons:decision.reviewReasons,
    topCandidates:decision.topCandidates,publicationAllowed:false});
  if(results.length%10===0)console.log(JSON.stringify({processed:results.length,total:triage.corrections.length}));
}
const report={kind:'CORRECT_DESTINATION_FULL_MAKE_RECHECK',sourceHash:sha(sourceRaw),mannHash:sha(mannRaw),triageHash:sha(raw),snapshotHash:sha(snapshotRaw),
  identityCorrections:overlay.metadata,productionApplyAllowed:false,summary:{requirements:results.length,
    statuses:Object.fromEntries([...Map.groupBy(results,r=>r.matchStatus)].map(([k,v])=>[k,v.length]))},
  limitation:'Virtual source corrections only; attached gearbox/circuit and model/drive conditions retained separately, not satisfied by the matcher. No display revisions or source/DB writes.',results};
await writeFile(resolve(dir,'destination-correction-recheck-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report.summary,null,2));
