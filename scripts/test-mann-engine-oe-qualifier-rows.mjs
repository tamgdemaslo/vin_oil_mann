import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,parseCopy} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),out=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
assert.ok(process.argv.length===2||(process.argv.length===3&&process.argv[2]==='--check-only'));
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {isMannNonVehicleVariantText:excluded,filterMannVehicleVariants:filter,normalizeMannSearchText:normalize}=await j.import('../src/lib/mann-catalog.ts');
const {normalizeDecodedVehicleForTest:vehicle,evaluateMannCandidate:evaluate}=await j.import('../src/lib/mann-vehicle-resolver.ts');
for(const label of ['2.0Xdi','1.616V','2.0 Country of vehicle manufacture Hungary','2.0 Syncro/4motion','1.6 ab Motor-Nr. 19MA9235','3.0 use for OE no. 4G0127400C'])assert.equal(excluded(label),false,label);
const sql=await readFile('/tmp/mann_filter_applications.sql','utf8'),rows=parseCopy(sql,'mann_filter_applications');assert.equal(rows.length,37600);
const affected=rows.filter(r=>/^(?:FU?ROENUMMER|USEFOROENO|ABMOTORNR|FROMENGINENO|BISMOTORNR|UPTOENGINENO)/.test(normalize(r.effectiveVehicleText??r.vehicleText).replace(/\s+/g,'')));
for(const r of affected){
 assert.equal(excluded(r.effectiveVehicleText??r.vehicleText),true);assert.deepEqual(filter([r]),[]);
 const v=vehicle({makeRaw:r.make,modelRaw:r.model,sourceMethods:['manual']});assert.ok(v);
 assert.ok(evaluate(v,r).rejected?.reasons.some(reason=>reason.includes('служебное условие PDF')));
}
const keys=new Set(affected.map(r=>r.vehicleVariantKey)),planRaw=await readFile(resolve(out,'plan.json'),'utf8'),plan=JSON.parse(planRaw);
const referencedDrafts=plan.newRevisions.filter(r=>keys.has(r.vehicleVariantKey));assert.equal(affected.length,328);assert.equal(keys.size,174);assert.equal(referencedDrafts.length,0,'Current drafts must be reviewed before changing their retrieval path');
const preRaw=await readFile(resolve(out,'vin-priority-fluid-preflight-v3.json'),'utf8'),pre=JSON.parse(preRaw);
const summary={catalogRows:rows.length,qualifierRows:affected.length,qualifierVariants:keys.size,currentDraftReferences:referencedDrafts.length,priorityLinksToQualifiers:pre.findings.filter(f=>keys.has(f.vehicleVariantKey)).length};
if(process.argv[2]!=='--check-only') await writeFile(resolve(out,'mann-engine-oe-qualifier-audit-v1.json'),JSON.stringify({kind:'PDF_QUALIFIER_NOT_VEHICLE_AUDIT',inputHashes:{mann:sha(sql),plan:sha(planRaw),preflight:sha(preRaw),catalogCode:sha(await readFile(resolve(root,'src/lib/mann-catalog.ts'),'utf8'))},summary,
 findings:affected.map(r=>({sourceRowHash:r.sourceRowHash,vehicleVariantKey:r.vehicleVariantKey,make:r.make,model:r.model,vehicleText:r.vehicleText,pdfPage:r.pdfPage,engineCode:r.engineCode})),productionApplyAllowed:false,limitations:['Records and filter applications preserved; only standalone vehicle candidate eligibility changed.','No engine inheritance or correction from neighbouring PDF rows.','Actual in-memory resolver/list guard tested for all affected rows; SQL predicate present but not executed against production.']},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(summary));
