// Source text only. Fuel must be independently supplied, never inferred from
// the engine-code prefix, selected volume or target gearbox.
export function explicitFuelCapacities(value){
 if(typeof value!=='string')return null;
 const text=value.trim(),number='([0-9]+(?:[.,][0-9]+)?)';
 const clause=`${number} л\\. для (бензиновых|дизельных)`;
 const match=new RegExp(`^${clause}\\s+${clause}$`,'u').exec(text);
 if(!match||match[2]===match[4])return null;
 const rows=[[match[1],match[2]],[match[3],match[4]]].map(([v,f])=>({fuelType:f==='бензиновых'?'gasoline':'diesel',liters:Number(v.replace(',','.'))}));
 if(rows.some(r=>!Number.isFinite(r.liters)||r.liters<=0||r.liters>100))return null;
 return rows;
}
export function selectExplicitFuelCapacity(text,fuelType){
 if(!['gasoline','diesel'].includes(fuelType))return null;
 return explicitFuelCapacities(text)?.find(r=>r.fuelType===fuelType)??null;
}
