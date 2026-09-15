// Complete literal grammar for slash-separated engine tables. Unknown clauses
// reject the whole application; no prefix match may silently lose a condition.
const markets=new Map([['Россия','RU'],['Япония','JP'],['США','US'],['Европа','EU'],['Ю. Корея','KR'],['Ю-В Азия','SOUTHEAST_ASIA'],['ОАЭ','AE']]);
function dateRange(text){
 let m=text.match(/^(\d{4})\s*[-–]\s*(\d{4}|н\.в\.)?\s*(?:г\.)?$/u);
 if(m){const from=Number(m[1]),to=m[2]&&m[2]!=='н.в.'?Number(m[2]):null;if(from<1886||from>2100||(to!=null&&(to<from||to>2100)))return null;return {from:`${from}-01`,to:to==null?null:`${to}-12`,precision:'YEAR',raw:text};}
 m=text.match(/^(0[1-9]|1[0-2])\.(\d{4})\s*[-–]\s*(0[1-9]|1[0-2])\.(\d{4})(?:\s+г\.)?$/u);
 if(m){const from=`${m[2]}-${m[1]}`,to=`${m[4]}-${m[3]}`;if(from>to||Number(m[2])<1886||Number(m[4])>2100)return null;return {from,to,precision:'MONTH',raw:text};}
 return null;
}
export function parseLiteralEngineApplication(application){
 const lines=String(application??'').split(/\r?\n/u).map(l=>l.trim()).filter(Boolean);
 // Inline tables explicitly give one shared power line for an exact code/list.
 // Preserve that provenance; parsing does not prove each catalogue association.
 if(lines.length===6&&lines[0]==='МАСЛО в ДВИГАТЕЛЬ'&&lines[1].startsWith('Модель: ')){
  const list=lines[1].slice('Модель: '.length).split(/\s*[,/]\s*/u);
  const code=/^(?:[A-Z]{2,4}|(?=[A-Z0-9.-]*[A-Z])(?=[A-Z0-9.-]*\d)[A-Z0-9]+(?:[.-][A-Z0-9]+)*)$/u;
  if(!list.length||list.some(c=>!code.test(c))||new Set(list).size!==list.length)return null;
  const power=lines[4].match(/^Мощность: (\d+) л\.с\.(?:\s*\/\s*(\d+) кВт)?$/u);
  if(!power)return null;
  const hp=Number(power[1]),kw=power[2]?Number(power[2]):null;
  if(kw!==null&&(kw<=0||kw>1500||Math.abs(hp-kw*1.35962)>2))return null;
  const expanded=['МАСЛО в ДВИГАТЕЛЬ','Модель:',...list.map(c=>`- ${c} / ${hp} л.с.`),lines[2],lines[3],lines[5]].join('\n');
  const parsed=parseLiteralEngineApplication(expanded);if(!parsed)return null;
  return {...parsed,rawApplication:application,inlineSharedPower:{rawModel:lines[1],rawPower:lines[4],powerHp:hp,powerKw:kw},branches:parsed.branches.map(b=>({...b,raw:`${lines[1]}\n${lines[4]}`,sharedCodeList:list}))};
 }
 if(lines[0]!=='МАСЛО в ДВИГАТЕЛЬ'||lines[1]!=='Модель:')return null;
 const footer=lines.findIndex((l,i)=>i>1&&l.startsWith('Тип топлива:'));
 if(footer<3)return null;
 const tail=lines.slice(footer);
 if(tail.length!==3||!/^Тип топлива: (?:Бензин|Дизель)$/u.test(tail[0])||!/^Объём двигателя: \d+(?:[.,]\d+)? л\.$/u.test(tail[1])||!tail[2].startsWith('Годы выпуска: '))return null;
 const tableDates=dateRange(tail[2].slice('Годы выпуска: '.length));if(!tableDates)return null;
 const branches=[];
 for(const line of lines.slice(2,footer)){
  if(!line.startsWith('- '))return null;
  const parts=line.slice(2).split('/').map(p=>p.trim());
  const engine=parts.shift()?.match(/^([A-Z0-9]+(?:-[A-Z0-9]+)*)(?: (Diesel|Turbo))?$/u);
  if(!engine||!/[A-Z]/u.test(engine[1])||(!/[0-9]/u.test(engine[1])&&!/^[A-Z]{2,4}$/u.test(engine[1]))||['ALL','DOHC','SOHC','FWD','RWD','AWD','2WD','4WD','TDI','TSI','FSI','GDI'].includes(engine[1]))return null;
  const branch={engineCode:engine[1],literalEngineQualifier:engine[2]??null,powerHp:null,requiredMarket:null,driveCondition:null,dates:null,raw:line};
  for(const part of parts){
   const power=part.match(/^(\d+(?:\s*,\s*\d+)*)\s*л\.с\.$/u);
   if(power){if(branch.powerHp)return null;branch.powerHp=power[1].split(',').map(Number);if(branch.powerHp.some(p=>p<=0||p>2000)||new Set(branch.powerHp).size!==branch.powerHp.length)return null;continue;}
   if(markets.has(part)){if(branch.requiredMarket)return null;branch.requiredMarket=markets.get(part);continue;}
   if(/^(?:2WD|4WD|AWD|FWD|RWD)$/u.test(part)){if(branch.driveCondition)return null;branch.driveCondition=part;continue;}
   const dates=dateRange(part);if(dates){if(branch.dates)return null;branch.dates=dates;continue;}
   return null;
  }
  if(!branch.powerHp)return null;
  if(branch.literalEngineQualifier==='Diesel'&&tail[0]!=='Тип топлива: Дизель')return null;
  const dates=branch.dates??tableDates;
  const from=[dates.from,tableDates.from].sort().at(-1),to=[dates.to,tableDates.to].filter(Boolean).sort()[0]??null;
  if(to&&from>to)return null;
  branch.effectiveDates={from,to};branches.push(branch);
 }
 if(!branches.length||new Set(branches.map(b=>b.raw)).size!==branches.length)return null;
 return {branches,tableDates,rawFuel:tail[0],rawDisplacement:tail[1],rawApplication:application,publicationAllowed:false};
}
