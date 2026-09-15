// Offline literal source parsing only. Engine/power cross-products are NOT inferred.
export function mercedesPowerBranches(power, productionYears) {
 if(typeof power!=='string'||typeof productionYears!=='string')return null;
 const years=productionYears.match(/^\s*(\d{4})\s*[-–]\s*(\d{4})\s*$/);
 if(!years||+years[1]>+years[2])return null;
 const base={from:`${years[1]}-01`,to:`${years[2]}-12`},text=power.trim();
 const plain=text.match(/^(\d{2,3}(?:\s*,\s*\d{2,3})*)\s+л\.с\.$/);
 const slash=/^\d{2,3}\s+л\.с\.(?:\s*\/\s*\d{2,3}\s+л\.с\.)+$/.test(text);
 if(plain||slash){
  const values=plain?plain[1].split(/\s*,\s*/).map(Number):text.split(/\s*\/\s*/).map(s=>Number(s.match(/^\d+/)[0]));
  if(new Set(values).size!==values.length)return null;
  return values.map(powerHp=>({powerHp,model:null,window:base,sourcePhrase:text}));
 }
 if(!text.startsWith('- '))return null;
 const branches=[];
 for(const phrase of text.slice(2).split(/\s+-\s+(?=\d)/)){
  const m=phrase.match(/^(\d{2,3})\s+л\.с\.\s+(?:в|для)\s+(AMG GLC 63(?: S)?|GLC (?:200|300)|GLE 63(?: S)? AMG)(?:\s+\((\d{4})-(\d{4}) г\.в\.\))?$/);
  if(!m)return null;
  const from=m[3]?`${m[3]}-01`:base.from,to=m[4]?`${m[4]}-12`:base.to;
  if(from>to||from<base.from||to>base.to)return null;
  const model=m[2].startsWith('AMG GLC')?m[2].replace('AMG ','')+' AMG':m[2];
  branches.push({powerHp:Number(m[1]),model,window:{from,to},sourcePhrase:phrase});
 }
 return branches.length?branches:null;
}

export function mercedesPowerModelMatches(sourceModel, targetText) {
 if(sourceModel===null)return true;
 const target=String(targetText??'').toUpperCase().replace(/\s+/g,'');
 const models={'GLC 200':/^GLC200(?:EQBOOST)?\([^)]*\)$/,'GLC 300':/^GLC300(?:EQBOOST)?\([^)]*\)$/,'GLC 63 AMG':/^GLC63AMG\([^)]*\)$/,'GLC 63 S AMG':/^GLC63SAMG\([^)]*\)$/,'GLE 63 AMG':/^GLE63AMG\([^)]*\)$/,'GLE 63 S AMG':/^GLE63AMGS\([^)]*\)$/};
 return models[sourceModel]?.test(target)??false;
}
