import {parseLiteralEngineApplication} from './mann-literal-engine-application.mjs';

// Offline adapter for complete Volvo engine tables, not a fuzzy engine alias.
// Labels are retained; transmission/hybrid/unknown qualifiers are not discarded.
export function parseVolvoLiteralEngineApplication(application,make){
 if(String(make).toUpperCase()!=='VOLVO'||typeof application!=='string')return null;
 const lines=application.split(/\r?\n/u).map(l=>l.trim()).filter(Boolean);
 const label='(?:[0-9]\\.[0-9](?:i|D| (?:D[2-5]|T[2-6]))?|[DT][2-6])';
 const header=lines.shift();
 if(!new RegExp('^МАСЛО в ДВИГАТЕЛЬ(?: '+label+')?$','u').test(header??''))return null;
 if(lines[0]==='Модель:')lines.shift();
 const footer=lines.findIndex(l=>l.startsWith('Тип топлива:'));
 if(footer<1)return null;
 const sourceLines=lines.slice(0,footer),labels=[];
 const normalized=[];
 for(const line of sourceLines){
  const labeled=new RegExp('^- ('+label+') \\(([BD][0-9]{3,4}[TS][0-9]*)\\)( / .+)$','u').exec(line);
  const plain=/^- ([BD][0-9]{3,4}[TS][0-9]*)( \/ .+)$/u.exec(line);
  if(!labeled&&!plain)return null;
  labels.push(labeled?.[1]??null);
  normalized.push(labeled?`- ${labeled[2]}${labeled[3]}`:line);
 }
 const result=parseLiteralEngineApplication(['МАСЛО в ДВИГАТЕЛЬ','Модель:',...normalized,...lines.slice(footer)].join('\n'));
 if(!result)return null;
 // Do not silently repair a contradictory original fuel footer.
 if(result.branches.some(b=>b.engineCode.startsWith('D')&&result.rawFuel!=='Тип топлива: Дизель'||b.engineCode.startsWith('B')&&result.rawFuel!=='Тип топлива: Бензин'))return null;
 return {...result,rawApplication:application,sourceHeader:header,adapterPolicy:'VOLVO_COMPLETE_LITERAL_TABLE_V1',branches:result.branches.map((b,i)=>({...b,raw:sourceLines[i],sourceEngineLabel:labels[i]}))};
}
