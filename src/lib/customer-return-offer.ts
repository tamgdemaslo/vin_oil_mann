import type { ReturnCandidate, ReturnDocument, ReturnReason } from "./customer-return-candidates";

export type ReturnOfferLine = { productId:string; name:string; quantity:number; unit:string; priceCents:number; sumCents:number; available:number; selectionBasis?:string; replaces?:string };
export type ReturnOffer = { status:"ready"|"review"; vehicle:string; sourceDate:string; documentIds:string[]; lines:ReturnOfferLine[]; laborCents:number|null; laborBasis:string; totalCents:number|null; issues:string[] };
export type ReturnOfferProduct = { id:string; name:string; unit:string|null; priceCents:number; archived:boolean; available:number; entityType:string; priceNeedsSetup?:boolean };
export type ReturnFilterSelection = { product:ReturnOfferProduct; quantity:number; replaces:string|null; basis:string };
export const returnFilterSelectionKey = (reason:ReturnReason) => [...reason.documentIds].sort().join("|");
export type ReturnOfferContext = { sender:string; bookingUrl:string|null; laborCents:number|null; laborBasis:string; products:ReturnOfferProduct[]; filterSelections?:Record<string,ReturnFilterSelection[]>; filterLookupIssues?:Record<string,string> };
export const returnMoney = (cents:number) => new Intl.NumberFormat("ru-RU",{maximumFractionDigits:2}).format(cents/100)+" ₽";
export function customerReturnSender(branch:{slug:string;name:string;address:string|null}) {
  const location=`${branch.slug} ${branch.name} ${branch.address??""}`;
  if(/gagar|гагар/i.test(location))return "Это Сергей, мастер-приёмщик «Там, где масло» на Гагарина.";
  if(/dach|дачн/i.test(location))return "Это Вадим, мастер-приёмщик «Там, где масло» на Дачной.";
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
  if(/сливн.*пробк|пробк.*сливн/i.test(l.name))return "seal";
  return null;
};
// A historical quantity must never be multiplied by a new package/volume price.
const volume = (name:string) => name.toLowerCase().replace(",", ".").match(/(\d+(?:\.\d+)?)\s*(мл|л)(?:\b|[.\s,)]|$)/u)?.slice(1).join(":")??null;
export function buildCustomerReturnOffer(reason:ReturnReason,documents:ReturnDocument[],context:ReturnOfferContext):ReturnOffer {
  const history=documents.filter(d=>reason.documentIds.includes(d.id));
  const sourceDate=history.filter(oilService).map(d=>d.date).sort().at(-1)??"";
  const source=history.filter(d=>d.date===sourceDate).sort((a,b)=>a.id.localeCompare(b.id));
  const issues:string[]=[];
  const filterIssue=context.filterLookupIssues?.[returnFilterSelectionKey(reason)];
  if(filterIssue)issues.push(filterIssue);
  if(reason.vehicle==="Автомобиль не указан")issues.push("В истории не указаны модель и госномер автомобиля.");
  if(reason.needsReview)issues.push("Привязка автомобиля или история пробега требует проверки.");
  if(!sourceDate)issues.push("В истории нет подтверждённой замены моторного масла.");
  let materials=source.flatMap(d=>d.lines).filter(l=>l.quantity>0&&returnMaterialKind(l));
  const selections=context.filterSelections?.[returnFilterSelectionKey(reason)]??[];
  const selectedById=new Map(selections.map(s=>[s.product.id,s]));
  if(selections.length){
    materials=materials.filter(l=>returnMaterialKind(l)!=="filter");
    materials.push(...selections.map(s=>({productId:s.product.id,name:s.product.name,quantity:s.quantity,type:"product",metric:"OIL_FILTER"})));
  }
  if(!materials.some(l=>returnMaterialKind(l)==="oil"))issues.push("В прошлом обслуживании не найдено масло сервиса.");
  if(!materials.some(l=>returnMaterialKind(l)==="filter"))issues.push("В прошлом обслуживании не найден масляный фильтр.");
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
    if(available+0.000001<quantity)issues.push(`Недостаточно ${p.name}: требуется ${quantity}, доступно ${available} ${p.unit??"шт"}.`);
    lines.push({productId:id,name:p.name,quantity,unit:p.unit??"шт",priceCents:p.priceCents,sumCents:Math.round(quantity*p.priceCents),available,...(selectedById.has(id)?{selectionBasis:selectedById.get(id)!.basis,replaces:selectedById.get(id)!.replaces??undefined}:{})});
  }
  lines.sort((a,b)=>{
    const rank=(id:string)=>({oil:0,filter:1,seal:2}[returnMaterialKind(grouped.get(id)!.line)??"seal"]);
    return rank(a.productId)-rank(b.productId)||a.productId.localeCompare(b.productId);
  });
  if(context.laborCents==null||!Number.isSafeInteger(context.laborCents)||context.laborCents<0)issues.push("Не подтверждён точный тариф работы филиала.");
  const total=lines.reduce((s,l)=>s+l.sumCents,0)+(context.laborCents??0);
  if(!Number.isSafeInteger(total)||total<=0)issues.push("Не удалось рассчитать итоговую стоимость.");
  return {status:issues.length?"review":"ready",vehicle:reason.vehicle,sourceDate,documentIds:source.map(d=>d.id).sort(),lines,laborCents:context.laborCents,laborBasis:context.laborBasis,totalCents:issues.length?null:total,issues:[...new Set(issues)]};
}
function reasonText(reason:ReturnReason){
  const date=new Intl.DateTimeFormat("ru-RU",{timeZone:"UTC"}).format(new Date(reason.lastVisit+"T00:00:00Z"));
  if(reason.scenario==="missed_interval")return `После последней замены масла ${date} прошло больше времени, чем обычно между вашими обслуживаниями у нас.`;
  if(reason.scenario==="oil_soon")return reason.confidence==="estimate"?"По истории ваших обслуживаний приближается ориентировочный срок следующей замены моторного масла.":`С последней замены масла ${date} скоро пройдёт год — напоминаю о следующем обслуживании.`;
  return `Вы были у нас ${date} — почти год назад. Приглашаю на следующее обслуживание.`;
}
export function attachCustomerReturnOffers(candidate:ReturnCandidate,documents:ReturnDocument[],context:ReturnOfferContext):ReturnCandidate {
  const reasons=candidate.reasons.filter((r,i,all)=>all.findIndex(other=>(other.vehicleKey??other.vehicle)===(r.vehicleKey??r.vehicle))===i);
  const offers=reasons.map(r=>buildCustomerReturnOffer(r,documents,context));
  const required=new Map<string,number>();
  for(const offer of offers)for(const line of offer.lines)required.set(line.productId,(required.get(line.productId)??0)+line.quantity);
  for(const offer of offers)for(const line of offer.lines){
    if((required.get(line.productId)??0)>line.available+0.000001 && offer.status==="ready"){
      offer.status="review";offer.totalCents=null;
      offer.issues.push(`Недостаточно ${line.name} для всех автомобилей в этом предложении.`);
    }
  }
  const ready=offers.every(o=>o.status==="ready");
  const name=candidate.displayName&&!/без имени|розничн|не указан|^клиент$/i.test(candidate.displayName)?`, ${candidate.displayName}`:"";
  const blocks=reasons.map((r,i)=>{
    const offer=offers[i];
    if(offer.status!=="ready")return `${reasonText(r)}\n\nПредложение для ${r.vehicle} требует проверки сотрудником. Итоговая цена пока не рассчитана.`;
    return `${reasonText(r)}\n\nПредлагаю замену моторного масла и масляного фильтра на ${r.vehicle}. Комплект:\n${offer.lines.map(l=>`• ${l.name} — ${l.quantity} ${l.unit}: ${returnMoney(l.sumCents)}`).join("\n")}\n${offer.laborCents===0?"• Работа по замене масла и фильтра включена.":`• Замена масла и фильтра: ${returnMoney(offer.laborCents!)}.`}\n\nИтого с работой — ${returnMoney(offer.totalCents!)}.\nПеречисленные материалы доступны в филиале на момент расчёта.`;
  });
  return {...candidate,offers,bookingUrl:context.bookingUrl,offerReady:ready,needsReview:candidate.needsReview||!ready,draft:`Здравствуйте${name}! ${context.sender}\n\n${blocks.join("\n\n")}\n\n${context.bookingUrl?`Выбрать удобное время и записаться: ${context.bookingUrl}`:""}`.trim()};
}
