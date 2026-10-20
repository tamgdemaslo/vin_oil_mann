import type { ReturnDocument } from "./customer-return-candidates";
import type { ReturnFilterSelection, ReturnOfferProduct } from "./customer-return-offer";

export type ReturnOilProduct = ReturnOfferProduct & {
  brand?:string|null; sae?:string|null; acea?:string|null; apiSpec?:string|null;
  oem?:string|null; ilsac?:string|null; packageVolume?:string|null;
};
type OilLine=ReturnDocument["lines"][number];

/** Millilitres keep historical 100 ml portions and fractional litres exact. */
export function returnOilPackMl(name:string):number|null {
  const matches=[...name.matchAll(/(?:^|[\s,;(])(\d+(?:[.,]\d+)?)\s*(мл|ml|л|l)(?=$|[\s.,;)])/gi)];
  const values=[...new Set(matches.map(m=>Number(m[1].replace(",","."))*(/^(мл|ml)$/i.test(m[2])?1:1000)))];
  return values.length===1&&Number.isSafeInteger(values[0])&&values[0]>0?values[0]:null;
}
export function returnOilLineKey(name:string):string {
  return name.toLowerCase().replace(/\d{1,2}\s*w\s*-?\s*\d{2}/gi,s=>s.replace(/\s|-/g,""))
    .replace(/(?:^|[\s,;(])\d+(?:[.,]\d+)?\s*(?:мл|ml|л|l)(?=$|[\s.,;)])/gi," ")
    .replace(/моторное\s+масло|engine\s+oil|на\s+ро[зс]лив/gi," ")
    .replace(/[^a-zа-яё0-9]/gi,"");
}
const specification=(value:string|null|undefined)=>(value??"").toUpperCase().split(/[;|]/).map(s=>s.replace(/\s/g,"")).filter(Boolean).sort().join(";");
export function sameReturnOil(a:ReturnOilProduct,b:ReturnOilProduct):boolean {
  return !!a.brand?.trim()&&!!a.sae?.trim()&&!!(a.acea||a.apiSpec||a.oem||a.ilsac)
    &&returnOilLineKey(a.name)===returnOilLineKey(b.name)
    &&["brand","sae","acea","apiSpec","oem","ilsac"].every(k=>specification(a[k as keyof ReturnOilProduct] as string|null)===specification(b[k as keyof ReturnOilProduct] as string|null));
}
function saleUnit(p:ReturnOilProduct):{ml:number;bulk:boolean}|null {
  const named=returnOilPackMl(p.name),field=p.packageVolume?returnOilPackMl(p.packageVolume):null;
  if(named&&field&&named!==field)return null;
  const ml=named??field;if(!ml)return null;
  if(/^(л\.?|l|литр(?:а|ов)?)$/i.test(p.unit?.trim()??""))return ml===1000?{ml:1000,bulk:true}:null;
  return /^(шт\.?|pcs?|штука)$/i.test(p.unit?.trim()??"")?{ml,bulk:false}:null;
}
const usable=(p:ReturnOilProduct)=>!p.archived&&p.entityType==="product"&&!p.priceNeedsSetup&&Number.isSafeInteger(p.priceCents)&&p.priceCents>0&&Number.isFinite(p.available)&&p.available>0;
type Choice={cost:number;quantities:Map<string,number>};
function cheaper(a:Choice,b:Choice|undefined) {
  return !b||a.cost<b.cost||a.cost===b.cost&&[...a.quantities.values()].reduce((s,q)=>s+q,0)<[...b.quantities.values()].reduce((s,q)=>s+q,0);
}
/** Exact volume only. Buying a larger can needs staff approval, not an automatic surplus. */
function exactCombination(products:ReturnOilProduct[],target:number):Map<string,number>|null {
  if(!Number.isSafeInteger(target)||target<=0||target>100_000)return null;
  const states=new Map<number,Choice>([[0,{cost:0,quantities:new Map()}]]);
  const sealed=products.filter(p=>saleUnit(p)&&!saleUnit(p)!.bulk).sort((a,b)=>a.id.localeCompare(b.id));
  for(const p of sealed){
    const ml=saleUnit(p)!.ml;let remaining=Math.min(Math.floor(p.available),Math.floor(target/ml));
    for(let size=1;remaining>0;size*=2){
      const count=Math.min(size,remaining);remaining-=count;
      for(const [volume,choice]of [...states]){
        const next=volume+ml*count;if(next>target)continue;
        const quantities=new Map(choice.quantities);quantities.set(p.id,(quantities.get(p.id)??0)+count);
        const candidate={cost:choice.cost+count*p.priceCents,quantities};if(cheaper(candidate,states.get(next)))states.set(next,candidate);
      }
    }
  }
  const bulk=products.filter(p=>saleUnit(p)?.bulk).sort((a,b)=>a.priceCents-b.priceCents||a.id.localeCompare(b.id));
  let best:Choice|undefined;
  for(const [volume,choice]of states){
    let missing=target-volume;const quantities=new Map(choice.quantities);let cost=choice.cost;
    for(const p of bulk){const ml=Math.min(missing,Math.floor(p.available*1000+1e-6));if(!ml)continue;
      quantities.set(p.id,ml/1000);cost+=Math.round(ml/1000*p.priceCents);missing-=ml;
    }
    const candidate={cost,quantities};if(!missing&&cheaper(candidate,best))best=candidate;
  }
  return best?.quantities??null;
}

export function selectCustomerReturnOil(lines:OilLine[],products:ReturnOilProduct[]):{selections:ReturnFilterSelection[];issues:string[]} {
  const byId=new Map(products.map(p=>[p.id,p]));
  const groups=new Map<string,{source:ReturnOilProduct;lines:OilLine[];ml:number;original:Map<string,number>}>();
  const issues:string[]=[];
  for(const line of lines){
    const p=line.productId?byId.get(line.productId):undefined;
    const pack=returnOilPackMl(line.name),ml=pack==null?NaN:pack*line.quantity;
    if(!p||returnOilLineKey(line.name)!==returnOilLineKey(p.name)){
      issues.push(`Не подтверждено то же масло по истории: ${line.name}.`);continue;
    }
    if(!Number.isFinite(ml)||ml<=0||Math.abs(ml-Math.round(ml))>1e-6||ml>100_000){issues.push(`Не подтверждён исходный объём масла: ${line.name}.`);continue;}
    const identity=[returnOilLineKey(p.name),...['brand','sae','acea','apiSpec','oem','ilsac'].map(k=>specification(p[k as keyof ReturnOilProduct] as string|null))].join('|');
    const g=groups.get(identity)??{source:p,lines:[],ml:0,original:new Map<string,number>()};
    g.lines.push(line);g.ml+=Math.round(ml);
    const unit=saleUnit(p);if(unit)g.original.set(p.id,(g.original.get(p.id)??0)+ml/unit.ml);
    groups.set(identity,g);
  }
  const selections:ReturnFilterSelection[]=[];
  for(const g of groups.values()){
    const canKeep=g.original.size>0&&g.lines.every(l=>!!saleUnit(byId.get(l.productId!)!))&&[...g.original].every(([id,q])=>{
      const p=byId.get(id)!;return usable(p)&&p.available+1e-6>=q&&(saleUnit(p)!.bulk||Number.isInteger(q));
    });
    const options=products.filter(p=>usable(p)&&(p.id===g.source.id||sameReturnOil(g.source,p)));
    const quantities=canKeep?g.original:exactCombination(options,g.ml);
    if(!quantities){issues.push(`Нет подтверждённого комплекта того же масла на точные ${g.ml/1000} л: ${g.source.name}. Нужны свободный остаток, цена и совпадающие характеристики; лишний объём автоматически не добавляется.`);continue;}
    const changed=g.lines.some(l=>{const p=byId.get(l.productId!)!;return returnOilPackMl(l.name)!==saleUnit(p)?.ml;})||[...quantities].some(([id,q])=>q!==g.original.get(id))||quantities.size!==g.original.size;
    const originalText=g.lines.map(l=>`${l.name} × ${l.quantity}`).join('; ');
    for(const [id,quantity]of quantities)selections.push({product:byId.get(id)!,quantity:Math.round(quantity*1000)/1000,
      replaces:changed?originalText:null,basis:changed?`Объём по исходным строкам: ${g.ml/1000} л. То же масло; пересчитаны фасовки и единицы продажи по текущей цене.`:"Сохранены масло и объём из прошлого обслуживания."});
  }
  return issues.length?{selections:[],issues}:{selections,issues};
}
