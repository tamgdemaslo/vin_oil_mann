// Offline source-literal parser. Do not discard an unparsed equipment clause
// or form a cross product between separate engines, powers and year ranges.
export function volvoEngineYearBranches(value){
 if(typeof value!=='string')return null;
 const text=value.trim(),phrase='- ([BD][0-9]{4}[TS][0-9]*) / ([0-9]{2,3}) л\\.с\\. / ([0-9]{4})-([0-9]{4})';
 if(!new RegExp(`^(?:${phrase})(?: ${phrase})*$`).test(text))return null;
 const branches=[...text.matchAll(new RegExp(phrase,'g'))].map(m=>({engineCode:m[1],powerHp:Number(m[2]),yearFrom:Number(m[3]),yearTo:Number(m[4]),sourcePhrase:m[0]}));
 if(branches.some(b=>b.powerHp<=0||b.yearFrom<1886||b.yearTo>2100||b.yearFrom>b.yearTo))return null;
 if(new Set(branches.map(b=>b.engineCode)).size!==branches.length)return null;
 return branches;
}
