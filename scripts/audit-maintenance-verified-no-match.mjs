/** Offline diagnosis only: original600, verified identities, no provider/network/DB calls. */
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {createJiti} from 'jiti';
const root=resolve(import.meta.dirname,'..');
const dir=resolve(process.argv[2]??'outputs/maintenance-vin-batch-2026-11-20');
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src'),'@/lib/db':resolve(root,'scripts/fixtures/mann-fluid-research-mocks.mjs')}});
globalThis.fetch=async()=>{throw new Error('Offline audit forbids network');};
const {normalizeDecodedVehicleForTest,diagnoseMannCandidatesForTest,mannMakeFormsForTest,hasExactMannModelIdentity,evaluateMannCandidate}=await j.import('../src/lib/mann-vehicle-resolver.ts');
const [report,input,snapshot]=await Promise.all(['matched-600-final.json','normalized-600-with-confirmed-passports.json','mann-current-catalog.json'].map(async p=>JSON.parse(await readFile(resolve(dir,p),'utf8'))));
const inp=new Map(input.map(x=>[x.vin,x]));const cases=report.results.filter(x=>x.status==='NO_MATCH'&&(inp.get(x.vin).provenance.exactVinVerified||inp.get(x.vin).provenance.physicalVinVerified));
const squash=x=>String(x??'').normalize('NFKC').toUpperCase().replace(/[^\p{L}\p{N}]/gu,'');
const edit=(a,b)=>{const row=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){let prev=row[0];row[0]=i;for(let k=1;k<=b.length;k++){const tmp=row[k];row[k]=Math.min(row[k]+1,row[k-1]+1,prev+(a[i-1]===b[k-1]?0:1));prev=tmp;}}return row[b.length];};
const out=[];
for(const row of cases){const norm=normalizeDecodedVehicleForTest(row.vehicle);const forms=norm?mannMakeFormsForTest(norm.canonicalMake):[];const rows=snapshot.rows.filter(r=>forms.includes(r.makeNormalized));const unique=[...new Map(rows.map(r=>[r.vehicleVariantKey,r])).values()];const diag=norm?diagnoseMannCandidatesForTest(norm,rows):null;const exact=norm?unique.filter(r=>hasExactMannModelIdentity(norm.baseModel,norm.canonicalMake,r)):[];
 const models=[...new Set(unique.map(r=>r.model))];const nearby=models.map(model=>({model,distance:edit(squash(norm?.baseModel),squash(model.replace(/\([^)]*\)/g,'')))})).sort((a,b)=>a.distance-b.distance).slice(0,8);
 const nearbyRows=unique.filter(r=>nearby.slice(0,3).some(n=>n.model===r.model)).map(r=>({variantKey:r.vehicleVariantKey,make:r.make,model:r.model,vehicleText:r.effectiveVehicleText??r.vehicleText,engineCode:r.engineCode,kw:r.kw,hp:r.hp,years:r.vehicleYears,evaluation:norm?evaluateMannCandidate(norm,r):null}));
 out.push({maskedVin:row.vin.slice(0,3)+'•••••••••••'+row.vin.slice(-3),sampleRef:createHash('sha256').update(row.vin).digest('hex').slice(0,16),verificationBasis:inp.get(row.vin).provenance.kind,identity:row.vehicle,normalized:norm,sameMakeRows:rows.length,sameMakeVariants:unique.length,exactModelVariants:exact.length,catalogueModels:models,nearbyModels:nearby,diagnostics:diag&&{sourceRowCount:diag.sourceRowCount,retrievedCount:diag.retrievedCount,accepted:diag.rankedCandidates.map(c=>({model:c.model,vehicleText:c.effectiveVehicleText,score:c.score,matchedFields:c.matchedFields,mismatchedFields:c.mismatchedFields})),rejected:diag.rejected},nearbyRows});
 // Identity object must not leak the VIN in an ostensibly masked report.
 delete out.at(-1).identity.vin;delete out.at(-1).identity.rawResultIds;
}
const result={kind:'OFFLINE_VERIFIED_ORIGINAL600_NO_MATCH_AUDIT',cases:out,summary:{cases:out.length,catalogueRows:snapshot.rows.length,makeMissing:out.filter(x=>!x.sameMakeRows).length,exactModelAbsent:out.filter(x=>!x.exactModelVariants).length},limitations:['No network/API/database calls or writes.','Same exported37602-row filter snapshot, without optional canonical-table enrichment or persisted model aliases.','Nearest models are diagnostic search suggestions, not applicable variants or auto-selection evidence.']};
await writeFile(resolve(dir,'verified-no-match-audit-raw.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});
for(const c of out)console.log(JSON.stringify({maskedVin:c.maskedVin,model:c.identity.modelRaw,norm:c.normalized,makeRows:c.sameMakeRows,exactModel:c.exactModelVariants,retrieved:c.diagnostics?.retrievedCount,nearby:c.nearbyModels.slice(0,3),rejections:[...new Set(c.diagnostics?.rejected.flatMap(x=>x.reasons)??[])],accepted:c.diagnostics?.accepted.slice(0,2)}));
