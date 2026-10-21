import type { ReturnOffer, ReturnOfferLine } from "./customer-return-offer";
import type { ReturnReason } from "./customer-return-candidates";
import { returnOilPackMl } from "./customer-return-oil";

const amount=(value:number)=>new Intl.NumberFormat("ru-RU",{maximumFractionDigits:3}).format(value);
const unit=(line:ReturnOfferLine)=>line.unit.trim().replace(/\.$/,"");
const count=(line:ReturnOfferLine)=>line.quantity===1?"":` — ${amount(line.quantity)} ${unit(line)}`;
const tidy=(value:string)=>value.replace(/\s+/g," ").replace(/^[\s,;.:]+|[\s,;.:]+$/g,"").trim();
const bookingIntro="Или выберите время самостоятельно:";

export function withCustomerReturnBookingLink(text:string,url:string,include:boolean):string {
  if(include)return text.includes(url)?text:`${text.trim()}\n\n${bookingIntro}\n${url}`;
  const lines:string[]=[];
  for(const line of text.split("\n")){
    if(!line.includes(url)){lines.push(line);continue;}
    const remainder=line.replaceAll(url,"").trim();
    if(remainder && ![bookingIntro,"Выбрать удобное время и записаться:","Самостоятельная запись:"].includes(remainder))lines.push(remainder);
    else if(lines.at(-1)?.trim()===bookingIntro)lines.pop();
  }
  return lines.join("\n").replace(/\n{3,}/g,"\n\n").trim();
}

/** Display labels only. Never changes the selected SKU, quantity, price or detailed offer. */
export function customerReturnMaterialLabel(line:ReturnOfferLine):string {
  const kind=line.kind;
  if(kind==="seal"){
    if(line.stockPolicy==="always_available")return "Универсальное уплотнительное кольцо сливной пробки"+count(line);
    const label=/кольц/i.test(line.name)?"Уплотнительное кольцо сливной пробки":/шайб/i.test(line.name)?"Уплотнительная шайба сливной пробки":/прокладк/i.test(line.name)?"Прокладка сливной пробки":"Сливная пробка";
    return label+count(line);
  }
  if(kind==="filter"){
    // Prefer the current card's brand. Recognize common explicit labels when old cards lack it.
    const known=line.name.match(/\b(LYNX(?:auto)?|MANN(?:-FILTER)?|FILTRON|MAHLE|KNECHT|BOSCH|DENCKERMANN|SAKURA|PURFLUX|JS ASAKASHI|BLUE PRINT|JAPANPARTS|GOODWILL|BIG FILTER|MASUMA|MILES|PATRON|STELLOX|NITTO|ACDelco)\b/i)?.[1];
    const raw=line.brand?.trim()||known;
    const brand=raw?/^lynx(?:auto)?$/i.test(raw)?"LYNX":/^mann(?:-filter)?$/i.test(raw)?"MANN":raw:"";
    return `Масляный фильтр${brand?` ${brand}`:""}${count(line)}`;
  }
  if(kind==="oil"){
    const bulk=/^(л\.?|l|литр(?:а|ов)?)$/i.test(line.unit.trim());
    const onTap=bulk||/на\s+ро[зс]лив/i.test(line.name);
    const name=tidy(line.name
      .replace(/(?:^|[\s,;(])\d+(?:[.,]\d+)?\s*(?:мл|ml|л|l)(?=$|[\s.,;)])/gi," ")
      .replace(/моторное\s+масло|engine\s+oil|на\s+ро[зс]лив/gi," ")
      .replace(/\b[ABCE]\d(?:\/[ABCE]\d)+\b/gi," "))||"Моторное масло";
    const pack=returnOilPackMl(line.name);
    const quantity=bulk?`${amount(line.quantity)} л`:pack?`${amount(pack/1000)} л${line.quantity===1?"":` × ${amount(line.quantity)} ${unit(line)}`}`:`${amount(line.quantity)} ${unit(line)}`;
    return `${name}${onTap?" на розлив":""}, ${quantity}`;
  }
  // Old snapshots without material metadata retain their complete label rather than guessing.
  return `${tidy(line.name)}${count(line)}`;
}

export function customerReturnReasonText(reason:ReturnReason):string {
  const previous=new Date(reason.lastVisit+"T00:00:00Z");
  const date=new Intl.DateTimeFormat("ru-RU",{timeZone:"UTC"}).format(previous);
  if(reason.scenario==="missed_interval")return `После последней замены масла у нас ${date} на ${reason.vehicle} прошло больше времени, чем обычно между вашими обслуживаниями.`;
  if(reason.scenario==="oil_soon"){
    if(reason.confidence==="estimate")return `По истории ваших обслуживаний у нас на ${reason.vehicle} приближается ориентировочный срок следующей замены моторного масла.`;
    const year=previous.getUTCFullYear()+1,month=previous.getUTCMonth();
    const anniversary=new Date(Date.UTC(year,month,Math.min(previous.getUTCDate(),new Date(Date.UTC(year,month+1,0)).getUTCDate())));
    const label=new Intl.DateTimeFormat("ru-RU",{day:"numeric",month:"long",timeZone:"UTC"}).format(anniversary);
    return `${label} будет год с последней замены масла у нас на ${reason.vehicle}. Напоминаю о следующем обслуживании.`;
  }
  return `Вы были у нас ${date} на ${reason.vehicle} — почти год назад. Приглашаю на следующее обслуживание.`;
}

export function customerReturnOfferMessage(reason:ReturnReason,offer:ReturnOffer,money:(cents:number)=>string):string {
  const intro=customerReturnReasonText(reason);
  if(offer.status!=="ready"||offer.totalCents==null)return `${intro}\n\nПредложение для ${reason.vehicle} требует проверки сотрудником. Итоговая цена пока не рассчитана.`;
  const materials=offer.lines.map(line=>`• ${customerReturnMaterialLabel(line)}${line.stockPolicy==="always_available"?` — ${money(line.sumCents)}`:""}`).join(";\n");
  const filters=offer.optionalFilters??[];
  const filterNames=filters.length===2?"воздушного и салонного фильтров":filters[0]==="air"?"воздушного фильтра":"салонного фильтра";
  const optionalFilters=filters.length?`\n\nПроверили историю: на прошлой замене масла у нас нет записи о замене ${filterNames}. Если актуально, можем подобрать ${filters.length===2?"оба фильтра":"фильтр"} для вашего автомобиля. Подбор и замена оплачиваются отдельно и в указанную сумму не входят.`:"";
  const exclusions=offer.lines.some(line=>line.kind==="filter")?"Масло в стоимость не входит.":"Масло и фильтр в стоимость не входят.";
  if(offer.materialsOwner==="customer")return `${intro}\n\nПри прошлой замене у нас была оформлена работа без покупки масла. Приглашаем снова — можно приехать со своим маслом.\n\n${offer.lines.length?`Замена с вашим маслом, работа и перечисленные материалы: ${money(offer.totalCents)}.\n\nВ стоимость входят:\n${materials}.\n\n${exclusions}`:`Работа по замене моторного масла: ${money(offer.totalCents)}. Масло и фильтр в стоимость не входят.`}${optionalFilters}`;
  return `${intro}\n\nЗамена моторного масла и фильтра с материалами и работой: ${money(offer.totalCents)}.\n\nВ стоимость входят:\n${materials}.${optionalFilters}`;
}
