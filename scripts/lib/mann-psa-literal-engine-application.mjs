import {parseLiteralEngineApplication} from './mann-literal-engine-application.mjs';

// Only an explicitly printed PSA secondary identifier is an alternative.
// Never manufacture aliases from family names, horsepower or neighbouring rows.
export function parsePsaLiteralEngineApplication(application,make){
 if(!['PEUGEOT','CITROEN'].includes(make)||typeof application!=='string')return null;
 const lines=application.split(/\r?\n/u).map(s=>s.trim()).filter(Boolean);
 const headings=new Map([
  ['МАСЛО в ДВИГАТЕЛЬ',{}],
  ['МАСЛО в ДВИГАТЕЛЬ 1.6 MT',{displacement:'1.6',requiredTransmission:{type:'manual'}}],
  ['МАСЛО в ДВИГАТЕЛЬ 1.6 HDi',{displacement:'1.6',fuel:'Дизель'}],
  ['МАСЛО в ДВИГАТЕЛЬ 1.6 HDi / 1.6 e-HDi',{displacement:'1.6',fuel:'Дизель'}],
  ['МАСЛО в ДВИГАТЕЛЬ 1.6 VTi',{displacement:'1.6',fuel:'Бензин'}],
 ]);
 const heading=headings.get(lines[0]);if(!heading||lines[1]!=='Модель:')return null;
 const end=lines.findIndex(l=>l.startsWith('Тип топлива:'));if(end<3)return null;
 if(heading.fuel&&lines[end]!==`Тип топлива: ${heading.fuel}`)return null;
 if(heading.displacement&&lines[end+1]!==`Объём двигателя: ${heading.displacement} л.`)return null;
 const expanded=[],provenance=[];
 for(const raw of lines.slice(2,end)){
  const match=raw.match(/^- ([A-Z0-9]+) \(([A-Z0-9]{3})\) \/ (.+)$/u);
  if(!match||!/[A-Z]/u.test(match[1])||!/[0-9]/u.test(match[1])||!/[A-Z]/u.test(match[2])||['ALL','FWD','RWD','AWD','2WD','4WD','TDI','GDI','FSI','TSI','DPF','GPF','EGR','SCR','HDi','MPI'].includes(match[2])||match[1]===match[2])return null;
  for(const code of [match[1],match[2]]){
   expanded.push(`- ${code} / ${match[3]}`);
   provenance.push({raw,primaryEngineCode:match[1],literalSecondaryEngineCode:match[2]});
  }
 }
 const parsed=parseLiteralEngineApplication(['МАСЛО в ДВИГАТЕЛЬ','Модель:',...expanded,...lines.slice(end)].join('\n'));if(!parsed)return null;
 return {...parsed,rawApplication:application,rawHeading:lines[0],adapterPolicy:'PSA_EXPLICIT_SECONDARY_IDENTIFIER_V1',branches:parsed.branches.map((b,i)=>({...b,...provenance[i],...(heading.requiredTransmission?{requiredTransmission:heading.requiredTransmission}:{})}))};
}
