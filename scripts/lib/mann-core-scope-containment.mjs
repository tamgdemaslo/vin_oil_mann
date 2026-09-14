import {isDeepStrictEqual as same} from 'node:util';
// Restricted proof for core-fluid scopes. Unknown conditions always reject.
export function coreScopeContains(outer,inner){
  const allowed=new Set(['sourceVehicleScope','matchedEngineScope','window','yearFrom','yearTo','engineCodes','transmissionType','driveType','componentModel']);
  if(!outer||!inner||Object.keys(outer).some(k=>!allowed.has(k))||Object.keys(inner).some(k=>!allowed.has(k)))return false;
  for(const scope of [outer,inner]){
    if(['transmissionType','driveType','componentModel'].some(k=>scope[k]!=null))return false;
    if(!scope.sourceVehicleScope||!Array.isArray(scope.matchedEngineScope)||!scope.matchedEngineScope.length)return false;
    if(scope.matchedEngineScope.some(code=>typeof code!=='string'||!code.trim()))return false;
  }
  if(!same(outer.sourceVehicleScope,inner.sourceVehicleScope))return false;
  if(!inner.matchedEngineScope.every(code=>outer.matchedEngineScope.includes(code)))return false;
  const a=outer.window?.intersection,b=inner.window?.intersection;
  const valid=w=>w&&['from','to'].every(k=>w[k]===null||(typeof w[k]==='string'&&/^(?:19|20)\d{2}-(?:0[1-9]|1[0-2])$/.test(w[k])))&&(!w.from||!w.to||w.from<=w.to);
  if(!valid(a)||!valid(b))return false;
  return (a.from??'0000-00')<=(b.from??'0000-00')&&(a.to??'9999-99')>=(b.to??'9999-99');
}
