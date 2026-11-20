import { batchHash } from './maintenance-vin-batch.mjs';
export const PILOT_STATUS_FACT='MAINTENANCE_VIN_PILOT_STATUS_V1';
const STATUSES=new Set(['ready','partial','needs_selection','blocked']);
const VIN=/^[A-HJ-NPR-Z0-9]{17}$/;
const scrub=value=>typeof value==='string'?value.replace(/\b[A-HJ-NPR-Z0-9]{17}\b/gi,'[VIN REDACTED]'):Array.isArray(value)?value.map(scrub):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,scrub(v)])):value;
export function planPilotAudit(payload,{organizationId,branchId,sourceHash}){
 if(!/^[a-f0-9]{64}$/.test(sourceHash))throw new Error('Invalid source hash');
 const rows=Array.isArray(payload)?payload:payload.rows??payload.results;
 if(!Array.isArray(rows)||rows.length!==600)throw new Error('Pilot status input must contain exactly600 records');
 const seen=new Set();
 const planned=rows.map((row,index)=>{
  const vin=String(row.vin??'').trim().toUpperCase();
  if(!VIN.test(vin)||seen.has(vin))throw new Error(`Invalid or duplicate VIN at record ${index+1}`);
  seen.add(vin);
  if(!STATUSES.has(row.status)||typeof row.reason!=='string'||!row.reason.trim()||typeof row.physicalVinVerified!=='boolean'||!Array.isArray(row.variantKeys)||!row.variantKeys.every(k=>typeof k==='string'&&k.length>0)||!Array.isArray(row.gaps))throw new Error(`Invalid status fields at record ${index+1}`);
  if(row.candidateVariantKeys!==undefined && (!Array.isArray(row.candidateVariantKeys)||!row.candidateVariantKeys.every(k=>typeof k==='string'&&k.length>0)))throw new Error('Invalid diagnostic candidate keys');
  if(row.status==='ready' && (!row.physicalVinVerified || row.identityResolved===false || !row.variantKeys.length || row.gaps.length))throw new Error('Ready status requires verified VIN, a selected variant and no gaps');
  const vinHash=batchHash(vin),maskedVin=vin.slice(0,3)+'**********'+vin.slice(-4);
  const id='maintenance-vin-audit:'+batchHash(JSON.stringify({organizationId,branchId,vinHash,sourceHash}));
  return {id,organizationId,vehicleKey:'maintenance-vin:'+vinHash,aggregate:sourceHash,factType:PILOT_STATUS_FACT,
   vehicleSnapshot:{vinHash,maskedVin,physicalVinVerified:row.physicalVinVerified,...(typeof row.identityResolved==='boolean'?{identityResolved:row.identityResolved}:{}),...(typeof row.actualReturnedVinVerified==='boolean'?{actualReturnedVinVerified:row.actualReturnedVinVerified}:{})},
   facts:{auditVersion:1,vinHash,maskedVin,status:row.status,reason:scrub(row.reason),...(typeof row.reasonCode==='string'?{reasonCode:scrub(row.reasonCode)}:{}),...(typeof row.identityResolved==='boolean'?{identityResolved:row.identityResolved}:{}),...(typeof row.actualReturnedVinVerified==='boolean'?{actualReturnedVinVerified:row.actualReturnedVinVerified}:{}),physicalVinVerified:row.physicalVinVerified,variantKeys:row.physicalVinVerified?[...new Set(row.variantKeys)].sort():[],unverifiedCandidateVariantKeys:row.physicalVinVerified?[]:[...new Set(row.candidateVariantKeys??row.variantKeys)].sort(),gaps:scrub(row.gaps),sourceHash},
   sourceName:'batchnoAPI',sourceUrl:'urn:sha256:'+sourceHash,confidence:0,status:'audit_only',validUntil:null};
 });
 // Defence-in-depth: selected fields and nested gap text must not leak complete VINs.
 const serialized=JSON.stringify(planned).toUpperCase();
 for(const vin of seen)if(serialized.includes(vin))throw new Error('Complete VIN leaked into audit plan');
 return planned;
}
