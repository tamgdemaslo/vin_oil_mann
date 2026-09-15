// Parse the whole source application. A suffix must be retained, not dropped.
export function volvoApplicationBranches(value){
 if(typeof value!=='string')return null;
 const lines=value.trim().split('\n');
 if(!/^МАСЛО в ДВИГАТЕЛЬ(?: [0-9A-Za-z .\/]+)?$/u.test(lines.shift()??''))return null;
 const tail=lines.splice(-3);
 if(!/^Тип топлива: (Бензин|Дизель)$/u.test(tail[0]??'')||!/^Объём двигателя: \d\.\d л\.$/u.test(tail[1]??'')||!/^Годы выпуска: \d{4}-\d{4}$/u.test(tail[2]??''))return null;
 const branches=[];
 for(const line of lines){
  const m=/^- (\d\.\d[A-Za-z0-9 .\/]*?) \(([BD]\d{4}[TS]\d*)\) \/ (\d{2,3}) л\.с\. \/ (\d{4})-(\d{4}) \/ (2WD|4WD|2WD, 4WD)$/u.exec(line);
  if(!m||Number(m[4])>Number(m[5])||Number(m[4])<1886||Number(m[5])>2100)return null;
  branches.push({label:m[1],engineCode:m[2],powerHp:Number(m[3]),yearFrom:Number(m[4]),yearTo:Number(m[5]),driveCondition:m[6],sourcePhrase:line});
 }
 if(!branches.length||new Set(branches.map(b=>b.engineCode)).size!==branches.length)return null;
 return {branches,rawFuel:tail[0],rawDisplacement:tail[1],rawYears:tail[2]};
}
