import type { ReturnCandidate, ReturnDocument, ReturnReason } from "./customer-return-candidates";
import { customerReturnOfferMessage,withCustomerReturnBookingLink } from "./customer-return-message";
import { selectCustomerReturnOil, type ReturnOilProduct } from "./customer-return-oil";

export type ReturnOfferLine = { stockPolicy?:"always_available"; kind?:"oil"|"filter"|"seal"; brand?:string|null; productId:string; name:string; quantity:number; unit:string; priceCents:number; sumCents:number; available:number; selectionBasis?:string; replaces?:string };
export type ReturnOffer = { optionalFilters?:("air"|"cabin")[]; materialsOwner?:"service"|"customer"; status:"ready"|"review"; vehicle:string; sourceDate:string; documentIds:string[]; lines:ReturnOfferLine[]; laborCents:number|null; laborBasis:string; totalCents:number|null; issues:string[] };
export type ReturnOfferProduct = { brand?:string|null; id:string; name:string; unit:string|null; priceCents:number; archived:boolean; available:number; entityType:string; priceNeedsSetup?:boolean };
export type ReturnFilterSelection = { product:ReturnOfferProduct; quantity:number; replaces:string|null; basis:string };
export const returnFilterSelectionKey = (reason:ReturnReason) => [...reason.documentIds].sort().join("|");
export type ReturnOfferContext = { customerLaborCents?:number|null; customerLaborBasis?:string; sender:string; bookingUrl:string|null; laborCents:number|null; laborBasis:string; products:ReturnOfferProduct[]; oilProducts?:ReturnOilProduct[]; filterSelections?:Record<string,ReturnFilterSelection[]>; filterLookupIssues?:Record<string,string> };
export const returnMoney = (cents:number) => new Intl.NumberFormat("ru-RU",{maximumFractionDigits:2}).format(cents/100)+" ₽";
export function customerReturnSender(branch:{slug:string;name:string;address:string|null}) {
  const location=`${branch.slug} ${branch.name} ${branch.address??""}`;
  if(/gagar|гагар/i.test(location))return "Это Сергей, мастер-приёмщик «Там, где масло» на Гагарина.";
  if(/dach|дачн/i.test(location)){
    const house=location.match(/дачн[а-яё]*[\s,]*(\d+[а-яa-z]?)/i)?.[1];
    return `Это Вадим, мастер-приёмщик «Там, где масло» на Дачной${house?`, ${house}`:""}.`;
  }
  return "Это мастер-приёмщик «Там, где масло».";
}
export function customerReturnBookingUrl(origin:string|undefined,branchId:string,enabled:boolean):string|null {
  if(!enabled || !origin)return null;
  try { const url=new URL(origin);if(!["https:","http:"].includes(url.protocol)||url.username||url.password)return null;url.pathname="/booking";url.search="";url.hash="";url.searchParams.set("branchId",branchId);return url.toString(); }catch{return null;}
}
export const oilService = (d:ReturnDocument)=>d.lines.some(l=>l.type==="service"&&l.quantity>0&&(l.metric==="ENGINE_OIL_CHANGE"||/замен.*(?:моторн.*масл|масл.*двигател)/i.test(l.name)));
export const returnMaterialKind = (l:ReturnDocument["lines"][number]) => {
  if(l.type==="service")return null;
  if(l.metric==="ENGINE_OIL"||/моторн.*масл|масл.*моторн/i.test(l.name))return "oil";
  if(l.metric==="OIL_FILTER"||/фильтр.*масл|масл.*фильтр/i.test(l.name))return /крышк|корпус/i.test(l.name)?null:"filter";
  if(/сливн.*пробк|пробк.*сливн/i.test(l.name)||isReturnOilDrainRing(l.name))return "seal";
  return null;
};
/** Operational exception applies to drain sealing rings, never plugs or transmission/filter seals. */
export function isReturnOilDrainRing(name:string):boolean {
  return /кольц|шайб/i.test(name) && /сливн.*пробк|пробк.*сливн|универсальн/i.test(name) && !/акпп|кпп|трансмис|редуктор|радиатор|фильтр/i.test(name);
}
// A historical quantity must never be multiplied by a new package/volume price.
const volume = (name:string) => name.toLowerCase().replace(",", ".").match(/(\d+(?:\.\d+)?)\s*(мл|л)(?:\b|[.\s,)]|$)/u)?.slice(1).join(":")??null;
export function buildCustomerReturnOffer(reason:ReturnReason,documents:ReturnDocument[],context:ReturnOfferContext):ReturnOffer {
  const history=documents.filter(d=>reason.documentIds.includes(d.id));
  const sourceDate=history.filter(oilService).map(d=>d.date).sort().at(-1)??"";
  const source=history.filter(d=>d.date===sourceDate).sort((a,b)=>a.id.localeCompare(b.id));
  // A later filter visit also counts: do not suggest a filter already purchased/replaced since the oil change.
  const filterHistory=history.filter(d=>sourceDate&&d.date>=sourceDate).flatMap(d=>d.lines).filter(line=>line.quantity>0);
  const optionalFilters:("air"|"cabin")[]=sourceDate?(["air","cabin"] as const).filter(kind=>!filterHistory.some(line=>{
    const metric=kind==="air"?"AIR_FILTER":"CABIN_FILTER";
    if(line.metric===metric||line.metric===`${metric}_REPLACEMENT`)return true;
    if(/корпус|крышк|датчик|очистител|дезинфек/i.test(line.name))return false;
    return kind==="air"?/воздушн.*фильтр|фильтр.*воздушн/i.test(line.name):/салонн.*фильтр|фильтр.*салон/i.test(line.name);
  })):[];
  const issues:string[]=[];
  const filterIssue=context.filterLookupIssues?.[returnFilterSelectionKey(reason)];
  if(filterIssue)issues.push(filterIssue);
  if(reason.vehicle==="Автомобиль не указан")issues.push("В истории не указаны модель и госномер автомобиля.");
  if(reason.needsReview)issues.push("Привязка автомобиля или история пробега требует проверки.");
  if(!sourceDate)issues.push("В истории нет подтверждённой замены моторного масла.");
  let materials=source.flatMap(d=>d.lines).filter(l=>l.quantity>0&&returnMaterialKind(l));
  const possibleUnclassifiedOil=source.flatMap(d=>d.lines).some(line=>line.type!=="service"&&line.quantity>0&&!returnMaterialKind(line)&&/моторн.*масл|масл.*моторн|\d{1,2}\s*w\s*-?\s*\d{2}/i.test(line.name));
  const customerOil=!!sourceDate&&!possibleUnclassifiedOil&&!materials.some(line=>returnMaterialKind(line)==="oil");
  const laborCents=customerOil?context.customerLaborCents??null:context.laborCents;
  const laborBasis=customerOil?context.customerLaborBasis??"Тариф замены с маслом клиента не подтверждён.":context.laborBasis;
  const oil=!customerOil&&context.oilProducts?selectCustomerReturnOil(materials.filter(l=>returnMaterialKind(l)==="oil"),context.oilProducts):{selections:[],issues:[]};
  issues.push(...oil.issues);
  if(oil.selections.length){
    materials=materials.filter(l=>returnMaterialKind(l)!=="oil");
    materials.push(...oil.selections.map(s=>({productId:s.product.id,name:s.product.name,quantity:s.quantity,type:"product",metric:"ENGINE_OIL"})));
  }
  const filterSelections=context.filterSelections?.[returnFilterSelectionKey(reason)]??[];
  const selections=[...filterSelections,...oil.selections];
  const selectedById=new Map(selections.map(s=>[s.product.id,s]));
  if(filterSelections.length){
    materials=materials.filter(l=>returnMaterialKind(l)!=="filter");
    materials.push(...filterSelections.map(s=>({productId:s.product.id,name:s.product.name,quantity:s.quantity,type:"product",metric:"OIL_FILTER"})));
  }
  if(!customerOil&&!materials.some(l=>returnMaterialKind(l)==="oil"))issues.push("В прошлом обслуживании не найдено масло сервиса.");
  if(!customerOil&&!materials.some(l=>returnMaterialKind(l)==="filter"))issues.push("В прошлом обслуживании не найден масляный фильтр.");
  const products=new Map([...context.products,...selections.map(s=>s.product)].map(p=>[p.id,p]));
  const grouped=new Map<string,{line:ReturnDocument["lines"][number];quantity:number}>();
  for(const line of materials){
    const product=line.productId?products.get(line.productId):null;
    if(!product){issues.push(`Нет актуальной карточки: ${line.name}.`);continue;}
    if(product.archived||product.entityType!=="product"){issues.push(`Товар недоступен для предложения: ${product.name}.`);continue;}
    if(returnMaterialKind(line)==="oil"&&volume(line.name)!==volume(product.name)){issues.push(`Изменилась фасовка ${product.name}; количество нужно проверить.`);continue;}
    const previous=grouped.get(product.id);grouped.set(product.id,{line,quantity:(previous?.quantity??0)+line.quantity});
  }
  const lines:ReturnOfferLine[]=[];
  for(const [id,item]of grouped){
    const p=products.get(id)!;const quantity=Math.round(item.quantity*1000)/1000;
    if(p.priceNeedsSetup||!Number.isFinite(quantity)||quantity<=0||!Number.isSafeInteger(p.priceCents)||p.priceCents<=0){issues.push(`Не настроена цена или количество: ${p.name}.`);continue;}
    const available=Number.isFinite(p.available)?p.available:0;
    const ring=isReturnOilDrainRing(p.name)&&returnMaterialKind(item.line)==="seal";
    if(!ring&&available+0.000001<quantity)issues.push(`Недостаточно ${p.name}: требуется ${quantity}, доступно ${available} ${p.unit??"шт"}.`);
    lines.push({...(ring?{stockPolicy:"always_available" as const}:{}),kind:returnMaterialKind(item.line)??undefined,brand:p.brand,productId:id,name:p.name,quantity,unit:p.unit??"шт",priceCents:p.priceCents,sumCents:Math.round(quantity*p.priceCents),available,...(selectedById.has(id)?{selectionBasis:selectedById.get(id)!.basis,replaces:selectedById.get(id)!.replaces??undefined}:{})});
  }
  lines.sort((a,b)=>{
    const rank=(id:string)=>({oil:0,filter:1,seal:2}[returnMaterialKind(grouped.get(id)!.line)??"seal"]);
    return rank(a.productId)-rank(b.productId)||a.productId.localeCompare(b.productId);
  });
  if(laborCents==null||!Number.isSafeInteger(laborCents)||laborCents<0)issues.push("Не подтверждён точный тариф работы филиала.");
  const total=lines.reduce((s,l)=>s+l.sumCents,0)+(laborCents??0);
  if(!Number.isSafeInteger(total)||total<0||total===0&&!customerOil)issues.push("Не удалось рассчитать итоговую стоимость.");
  return {optionalFilters,status:issues.length?"review":"ready",vehicle:reason.vehicle,sourceDate,documentIds:source.map(d=>d.id).sort(),lines,materialsOwner:customerOil?"customer":"service",laborCents,laborBasis,totalCents:issues.length?null:total,issues:[...new Set(issues)]};
}
export function attachCustomerReturnOffers(candidate:ReturnCandidate,documents:ReturnDocument[],context:ReturnOfferContext):ReturnCandidate {
  const reasons=candidate.reasons.filter((r,i,all)=>all.findIndex(other=>(other.vehicleKey??other.vehicle)===(r.vehicleKey??r.vehicle))===i);
  const offers=reasons.map(r=>buildCustomerReturnOffer(r,documents,context));
  const required=new Map<string,number>();
  for(const offer of offers)for(const line of offer.lines)required.set(line.productId,(required.get(line.productId)??0)+line.quantity);
  for(const offer of offers)for(const line of offer.lines){
    if(line.stockPolicy!=="always_available"&&(required.get(line.productId)??0)>line.available+0.000001 && offer.status==="ready"){
      offer.status="review";offer.totalCents=null;
      offer.issues.push(`Недостаточно ${line.name} для всех автомобилей в этом предложении.`);
    }
  }
  const ready=offers.every(o=>o.status==="ready");
  const name=candidate.displayName&&!/без имени|розничн|не указан|^клиент$/i.test(candidate.displayName)?`, ${candidate.displayName}`:"";
  const blocks=reasons.map((reason,index)=>customerReturnOfferMessage(reason,offers[index],returnMoney));
  const greeting=name?`${candidate.displayName}, здравствуйте!`:"Здравствуйте!";
  const booking="Напишите, какой день вам удобен, помогу записаться.";
  const text=`${greeting} ${context.sender}\n\n${blocks.join("\n\n")}\n\n${booking}`;
  return {...candidate,offers,bookingUrl:context.bookingUrl,offerReady:ready,needsReview:candidate.needsReview||!ready,draft:context.bookingUrl?withCustomerReturnBookingLink(text,context.bookingUrl,true):text.trim()};
}
