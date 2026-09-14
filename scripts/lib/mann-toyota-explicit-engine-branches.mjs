// Parse whole source model text, not disconnected engine/power tokens.
// Unsupported punctuation, mixed powers and unknown markets remain review.
export function toyotaExplicitEngineBranches(value) {
 if(typeof value!=='string')return null;
 const raw=value.trim();if(!raw.startsWith('- '))return null;
 const parts=raw.slice(2).split(/\s+-\s+(?=\d[A-Z])/);
 const branches=[];
 for(const part of parts){
  const m=part.match(/^(\d[A-Z]{1,3}-[A-Z]{2,3})\s*\/\s*(\d{2,3})\s+л\.с\.(?:\s*\/\s*(Россия|Япония)\s*\/\s*(\d{4})\s*-\s*(\d{4}))?$/);
  if(!m)return null;
  const powerHp=Number(m[2]),yearFrom=m[4]?Number(m[4]):null,yearTo=m[5]?Number(m[5]):null;
  if(powerHp<20||powerHp>999||yearFrom!==null&&(yearFrom<1886||yearTo>2100||yearFrom>yearTo))return null;
  branches.push({engineCode:m[1],powerHp,requiredMarket:m[3]==='Россия'?'RU':m[3]==='Япония'?'JP':null,yearFrom,yearTo,sourcePhrase:part});
 }
 if(new Set(branches.map(b=>JSON.stringify(b))).size!==branches.length)return null;
 return branches;
}
