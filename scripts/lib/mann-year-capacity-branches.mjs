// Offline source evidence only. Inclusive overlapping years remain ambiguous.
export function parseYearCapacityBranches(value){
 const text=String(value??'').trim(),branches=[];
 const pattern=/\s*(\d+(?:[.,]\d+)?\s*л\.)\s*-\s*для\s*(\d{4})\s*-\s*(\d{4})\s*/uy;
 let offset=0;
 while(offset<text.length){
  pattern.lastIndex=offset;const match=pattern.exec(text);
  if(!match)return {status:'review',reason:'UNCONSUMED_SOURCE_TEXT',branches:[]};
  const from=Number(match[2]),to=Number(match[3]);
  if(from<1886||to>2100||from>to)return {status:'review',reason:'INVALID_YEARS',branches:[]};
  branches.push({capacityText:match[1],yearFrom:from,yearTo:to,start:offset,end:pattern.lastIndex,sourceSegment:match[0]});
  offset=pattern.lastIndex;
 }
 return branches.length>=2?{status:'structured',branches}:{status:'review',reason:'NO_ALTERNATIVES',branches:[]};
}
export function selectYearCapacityBranch(branches,year){
 if(!Number.isInteger(year))return null;
 const matching=branches.filter(b=>year>=b.yearFrom&&year<=b.yearTo);
 return matching.length===1?matching[0]:null;
}
