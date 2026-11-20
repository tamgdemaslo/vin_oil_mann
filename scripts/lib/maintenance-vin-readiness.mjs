import {createHash} from 'node:crypto';
export const vinHash=vin=>createHash('sha256').update(vin).digest('hex');
export function validateIdentityAudit(audit, originals) {
  if(audit.databaseReadOnly!==true||audit.scope?.originalVinCount!==600||audit.scope?.branch!=='branch-main'||(audit.scope.organization!==undefined&&audit.scope.organization!=='cmpmo4c1r00088z0h38fn6k98')||audit.providerCalls!==0||audit.writes!==0||!Array.isArray(audit.rows))throw Error('Expected original600 main-branch read-only identity audit with zero provider calls/writes');
  const hashes=new Set(originals.map(row=>vinHash(row.vin))), seen=new Set();
  if(originals.length!==600||hashes.size!==600)throw Error('Identity audit requires exact unique original600');
  const result=new Map();
  for(const row of audit.rows){
    if(typeof row.vinHash!=='string'||!hashes.has(row.vinHash)||seen.has(row.vinHash))throw Error('Identity audit VIN hash is outside original600 or duplicated');
    if(row.exactVinVerified!==true||row.rawDecryptSucceeded!==true||row.returnedVinCount!==1||!Number.isInteger(row.distinctTechnicalCandidates)||row.distinctTechnicalCandidates<1||row.needsIdentitySelection!==(row.distinctTechnicalCandidates>1))throw Error('Invalid provider identity ambiguity evidence');
    seen.add(row.vinHash);result.set(row.vinHash,row);
  }
  return result;
}
export function identityState(source, audit=new Map()) {
  const p=source.provenance??{},observed=audit.get(vinHash(source.vin));
  const ambiguous=observed?.needsIdentitySelection===true;
  const actualReturnedVinVerified=Boolean(p.exactVinVerified||observed?.exactVinVerified);
  const originalVerified=Boolean(p.exactVinVerified||p.physicalVinVerified);
  return {physicalVinVerified:originalVerified&&!ambiguous,actualReturnedVinVerified,identityResolved:originalVerified&&!ambiguous,identityAmbiguous:ambiguous};
}
export function readinessRow(x, source, audit=new Map(), mismatches=new Set()) {
  const p=source.provenance??{},state=identityState(source,audit);let status='blocked',reason;
  if(state.identityAmbiguous){status='needs_selection';reason='Ответ сервиса относится к этому VIN, но содержит несколько различных технических идентичностей автомобиля. Сначала уточните автомобиль по исходной расшифровке; сопоставление MANN пока предварительное.';}
  else if(!state.physicalVinVerified){reason=mismatches.has(x.vin)?'В сохранённом полном ответе PartsAPI указан другой VIN; карточку нельзя применять к этому автомобилю.':'Принадлежность сохранённой расшифровки этому VIN не подтверждена: исходная карточка не содержит returned VIN.';if(x.status==='INVALID_NORMALIZED_VEHICLE')reason+=' Нет пригодных марки и модели.';}
  else if(x.status==='MATCHED'){status='partial';reason='Модификация MANN сопоставлена, но часть допусков/объёмов отсутствует либо требует проверки источников и условий применяемости.';}
  else if(x.status==='NEEDS_SELECTION'){status='needs_selection';const c=x.candidates?.[0];reason='Не определена единственная применимая модификация MANN.';if(c?.mismatchedFields?.length)reason+=' Противоречия: '+c.mismatchedFields.join(', ')+'.';if(c?.missingFields?.length)reason+=' Недостающие поля каталога: '+c.missingFields.join(', ')+'.';}
  else reason=x.status==='NO_MATCH'?'Для подтверждённой VIN-расшифровки не найдена применимая модификация MANN.':'Подтверждённая расшифровка не содержит пригодных марки и модели.';
  return {vin:x.vin,status,reason,...state,...(state.identityAmbiguous?{reasonCode:'ambiguous_provider_identity',candidateVariantKeys:[...new Set([...(x.variantKeys??[]),...(x.candidates??[]).flatMap(c=>c.variantIds??[])])]}:{}),verificationBasis:p.verificationBasis??(p.exactVinVerified?'explicit_provider_returned_vin':'unverified_recorded_identity'),variantKeys:state.identityAmbiguous?[]:x.variantKeys??[],gaps:state.identityAmbiguous?[]:x.gapsAfter??x.gapsBefore??[],catalogStatus:x.status,gapsDiscoveryStatus:state.identityAmbiguous?'not_evaluated_ambiguous_provider_identity':x.variantKeys?.length?'evaluated':'not_evaluated_without_selected_variant',sourceKind:p.kind,requiresReview:x.profile?.items?.some(i=>i.requiresReview)??false,apiCalls:0};
}
