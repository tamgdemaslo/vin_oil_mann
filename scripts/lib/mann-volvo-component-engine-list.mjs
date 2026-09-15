// Parse only a complete, explicit component-engine restriction; never infer
// equipment membership from engines elsewhere in the same table.
export function volvoComponentEngineList(application){
 if(typeof application!=='string')return {status:'ABSENT',branches:[]};
 const marker='* используется в автомобилях с двс:',parts=application.split(marker);
 if(parts.length===1)return {status:'ABSENT',branches:[]};
 if(parts.length!==2)return {status:'REVIEW',branches:[]};
 const prefix=parts[0].trim();
 if(!/^МАСЛО в (?:А|М|Р)КПП-\d+(?: \(Робот \d+-ступ\))?\nМодель:\s*-?\s*[A-Z0-9-]+(?:, [A-Z0-9-]+)*$/u.test(prefix))return {status:'REVIEW',branches:[]};
 const lines=parts[1].trim().split('\n'),branches=[];
 for(const line of lines){
  const m=/^- (\d\.\d\s*[TD]\d*) \(([BD]\d{4}[TS]\d*)\s*\)\s*(?:\/\s*)?(\d{2,3}) л\.с\.$/u.exec(line.trim());
  if(!m)return {status:'REVIEW',branches:[]};
  branches.push({engineCode:m[2],powerHp:Number(m[3]),sourcePhrase:line.trim()});
 }
 if(!branches.length||new Set(branches.map(b=>b.engineCode)).size!==branches.length)return {status:'REVIEW',branches:[]};
 return {status:'EXPLICIT',componentText:prefix,branches};
}
