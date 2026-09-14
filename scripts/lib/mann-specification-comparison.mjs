export function compareSpecificationSets(left,right){
  const normalize=values=>[...new Set(values.map(v=>String(v).trim().replace(/\s+/g,' ').toUpperCase()).filter(Boolean))].sort();
  const a=normalize(left),b=normalize(right),shared=a.filter(v=>b.includes(v));
  const kind=JSON.stringify(a)===JSON.stringify(b)?'IDENTICAL':!a.length||!b.length?'MISSING_ON_ONE_SIDE':
    !shared.length?'DISJOINT':shared.length===Math.min(a.length,b.length)?'SUBSET':'PARTIAL_OVERLAP';
  return {kind,left:a,right:b,shared,compatibilityVerified:false};
}
