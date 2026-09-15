import {parseLiteralEngineApplication} from './mann-literal-engine-application.mjs';

// Exact source syntax: power and drive on the same branch, not a cross-product.
export function parsePowerDriveEngineApplication(application,make){
 if(String(make).toUpperCase()!=='TOYOTA'||typeof application!=='string')return null;
 const lines=application.split(/\r?\n/u).map(s=>s.trim()).filter(Boolean);
 if(lines[0]!=='МАСЛО в ДВИГАТЕЛЬ'||lines[1]!=='Модель:')return null;
 const end=lines.findIndex(s=>s.startsWith('Тип топлива:'));if(end<3)return null;
 const originals=lines.slice(2,end),normalized=[];
 for(const line of originals){
  const m=/^- ([A-Z0-9]+(?:-[A-Z0-9]+)*) \/ (\d+) л\.с\. \((2WD|4WD)\) \/ (.+)$/u.exec(line);if(!m)return null;
  normalized.push(`- ${m[1]} / ${m[2]} л.с. / ${m[3]} / ${m[4]}`);
 }
 const parsed=parseLiteralEngineApplication([...lines.slice(0,2),...normalized,...lines.slice(end)].join('\n'));if(!parsed)return null;
 return {...parsed,rawApplication:application,adapterPolicy:'EXACT_POWER_DRIVE_BRANCH_V1',branches:parsed.branches.map((b,i)=>({...b,raw:originals[i]}))};
}
