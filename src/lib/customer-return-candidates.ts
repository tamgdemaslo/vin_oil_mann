import { customerVehicleIdentity, vehicleAttribute } from "./customer-vehicle-identity";

export type ReturnScenario = "missed_interval" | "oil_soon" | "single_visit";
export type ReturnReason = {
  scenario: ReturnScenario;
  vehicle: string;
  explanation: string;
  lastVisit: string;
  documentIds: string[];
  confidence: "history" | "estimate";
  needsReview: boolean;
};
export type ReturnCandidate = {
  id: string;
  clientKey: string;
  displayName: string;
  phone: string | null;
  reasons: ReturnReason[];
  draft: string;
  needsReview: boolean;
};
export type ReturnDocument = {
  id: string;
  clientKey: string;
  date: string;
  attributes: unknown;
  lines: { name: string; type: string; quantity: number; metric: string | null }[];
};
export const RETURN_SCENARIO_LABELS: Record<ReturnScenario, string> = {
  missed_interval: "Пропущен привычный интервал",
  oil_soon: "Приближается замена масла",
  single_visit: "Один визит около года назад",
};
const day = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(day(value)) && new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.ceil((sorted.length - 1) / 2)]) / 2;
};
export function parseReturnMileage(value: unknown): number | null {
  const raw = String(value ?? "").trim().toLowerCase().replace(/\s/g, "").replace(/(?:км|km)\.?$/, "");
  let number: number;
  if (/^\d{1,3}(?:[.,]\d{3})+$/.test(raw)) number = Number(raw.replace(/[.,]/g, ""));
  else if (/^\d+(?:[.,]\d+)?тыс\.?$/.test(raw)) number = Number(raw.replace(/тыс\.?$/, "").replace(",", ".")) * 1000;
  else if (/^\d+$/.test(raw)) number = Number(raw);
  else return null;
  return number > 0 && number <= 1_500_000 ? number : null;
}
function isOilChange(document: ReturnDocument): boolean {
  return document.lines.some(line => line.type === "service" && line.quantity > 0 && (
    line.metric === "ENGINE_OIL_CHANGE" || /замен.*(?:моторн.*масл|масл.*двигател)/i.test(line.name)
  ));
}
function makeDraft(name: string, reasons: ReturnReason[]): string {
  const greeting = name && !/без имени|розничн|не указан|^клиент$/i.test(name) ? `Здравствуйте, ${name}!` : "Здравствуйте!";
  const body = reasons.map(reason => {
    if (reason.scenario === "missed_interval") return `Раньше вы обращались к нам для замены моторного масла на ${reason.vehicle}. Хотели уточнить, какой сейчас пробег и актуально ли очередное обслуживание?`;
    if (reason.scenario === "oil_soon") return `Возможно, на ${reason.vehicle} приближается следующая замена моторного масла. Подскажите текущий пробег — поможем уточнить срок и подобрать удобное время.`;
    return `Вы были у нас ${new Intl.DateTimeFormat("ru-RU", {timeZone:"UTC"}).format(new Date(reason.lastVisit + "T00:00:00Z"))}${reason.vehicle !== "Автомобиль не указан" ? ` на ${reason.vehicle}` : ""}. Хотели уточнить, актуально ли сейчас обслуживание автомобиля. Если да, поможем подобрать удобное время.`;
  });
  return `${greeting} Это Эко-платформа.\n\n${body.join("\n\n")}`;
}

/** Pure daily calculation. Full branch history only; never sends, creates tasks or calls AI. */
export function buildCustomerReturnCandidates(input: {
  today: string;
  documents: ReturnDocument[];
  clients: { clientKey: string; displayName: string; phone: string | null }[];
}): ReturnCandidate[] {
  if (!validDate(input.today)) return [];
  const today = day(input.today);
  const documents = input.documents.filter(d => validDate(d.date) && d.date <= input.today);
  const byClient = new Map<string, ReturnDocument[]>(), plateVins = new Map<string, Set<string>>(), vinClients = new Map<string, Set<string>>();
  const identities = new Map(documents.map(d => [d.id, customerVehicleIdentity(d.attributes)]));
  for (const d of documents) {
    byClient.set(d.clientKey, [...(byClient.get(d.clientKey) ?? []), d]);
    const { vin, plate } = identities.get(d.id)!;
    if (vin) { if (!vinClients.has(vin)) vinClients.set(vin, new Set()); vinClients.get(vin)!.add(d.clientKey); }
    if (vin && plate) { if (!plateVins.has(plate)) plateVins.set(plate, new Set()); plateVins.get(plate)!.add(vin); }
  }
  const result: ReturnCandidate[] = [];
  for (const client of input.clients) {
    const history = byClient.get(client.clientKey) ?? [];
    if (!history.length) continue;
    const reasons: ReturnReason[] = [], cars = new Map<string, ReturnDocument[]>();
    let clientReview = false;
    for (const d of history) {
      const {vin, plate} = identities.get(d.id)!;
      const linkedVins = plate ? plateVins.get(plate) : undefined;
      const car = vin || (plate && (!linkedVins || linkedVins.size <= 1) ? [...(linkedVins ?? [])][0] || plate : null);
      if (!car) clientReview = true;
      else cars.set(car, [...(cars.get(car) ?? []), d]);
      if (linkedVins && linkedVins.size > 1 || vin && vinClients.get(vin)!.size > 1) clientReview = true;
    }
    for (const carDocs of cars.values()) {
      const visits = new Map<string, {oil: boolean; miles: Set<number>; docs: string[]; label: string}>();
      for (const d of [...carDocs].sort((a,b)=>a.date.localeCompare(b.date))) {
        const visit = visits.get(d.date) ?? {oil:false, miles:new Set<number>(), docs:[], label:identities.get(d.id)!.label};
        visit.oil ||= isOilChange(d); visit.docs.push(d.id);
        const miles = parseReturnMileage(vehicleAttribute(d.attributes, "mileage"));
        if (miles != null) visit.miles.add(miles);
        if (identities.get(d.id)!.label !== "Автомобиль не указан") visit.label = identities.get(d.id)!.label;
        visits.set(d.date, visit);
      }
      const ordered = [...visits].map(([date,v])=>({date,...v,mileage:v.miles.size===1?[...v.miles][0]:null}));
      const oil = ordered.filter(v=>v.oil), lastOil = oil.at(-1);
      if (!lastOil) continue;
      const points = ordered.filter(v=>v.mileage!=null), rates: number[]=[];
      let badMileage = ordered.some(v=>v.miles.size>1);
      for (let i=1;i<points.length;i++) {
        const elapsed = day(points[i].date)-day(points[i-1].date), distance=points[i].mileage!-points[i-1].mileage!;
        if (distance<0 || distance/elapsed>1000) badMileage=true;
        if (elapsed>=14 && distance>0 && distance/elapsed<=500) rates.push(distance/elapsed);
      }
      const recent = rates.slice(-3), speed=recent.length>=2?median(recent):null, lastPoint=points.at(-1);
      const forecastable = !badMileage && speed!=null && median(recent.map(r=>Math.abs(r-speed)))/speed<=.5 && lastPoint && today-day(lastPoint.date)<=365;
      const estimate = forecastable && lastOil.mileage!=null ? lastPoint.mileage!+speed*(today-day(lastPoint.date))-lastOil.mileage : null;
      const knownDistance = !badMileage && lastOil.mileage!=null && lastPoint ? lastPoint.mileage!-lastOil.mileage : null;
      const elapsed = today-day(lastOil.date), vehicle=ordered.at(-1)!.label;
      const base = {vehicle,lastVisit:lastOil.date,documentIds:ordered.flatMap(v=>v.docs),needsReview:clientReview||badMileage};
      if (oil.length>=3) {
        const gaps=oil.slice(1).map((v,i)=>day(v.date)-day(oil[i].date)).slice(-4), usual=median(gaps);
        if (usual>=30 && usual<=400 && median(gaps.map(g=>Math.abs(g-usual)))/usual<=.35 && elapsed>usual*1.5 && elapsed-usual>=30) {
          reasons.push({...base,scenario:"missed_interval",confidence:"history",explanation:`Обычный интервал — ${Math.round(usual)} дн.; после последней замены — ${elapsed} дн. Дат замены в истории: ${oil.length}.`});
        }
      }
      const alreadyDue=elapsed>=365 || knownDistance!=null&&knownDistance>=8000 || estimate!=null&&estimate>=8000;
      const calendarSoon=elapsed>=335, mileageSoon=estimate!=null&&speed!=null&&estimate+speed*30>=8000;
      if (!alreadyDue && (calendarSoon||mileageSoon)) {
        reasons.push({...base,scenario:"oil_soon",confidence:mileageSoon?"estimate":"history",explanation:calendarSoon?`После замены масла — ${elapsed} дн.; до календарного года — ${365-elapsed} дн.`:`По истории пробега порог 8 000 км ожидается в ближайшие 30 дней. Расчётный прирост после замены — ${Math.round(estimate!)} км; текущий пробег нужно уточнить.`});
      }
    }
    const dates=[...new Set(history.map(d=>d.date))].sort(), lastDate=dates.at(-1)!, absent=today-day(lastDate);
    if (dates.length===1 && absent>=335 && absent<365) {
      const vehicleLabels=[...new Set(history.map(d=>identities.get(d.id)!.label))];
      reasons.push({scenario:"single_visit",vehicle:vehicleLabels.length===1?vehicleLabels[0]:"Автомобиль не указан",explanation:`Один день посещения за всю доступную историю; после него — ${absent} дн.`,lastVisit:lastDate,documentIds:history.map(d=>d.id),confidence:"history",needsReview:clientReview});
    }
    if (!reasons.length) continue;
    // One editable draft per customer, even if several vehicles/reasons qualify.
    const draftReasons = reasons.filter((r,i)=>reasons.findIndex(x=>x.vehicle===r.vehicle)===i);
    result.push({id:client.clientKey,clientKey:client.clientKey,displayName:client.displayName,phone:client.phone,reasons,draft:makeDraft(client.displayName,draftReasons),needsReview:reasons.some(r=>r.needsReview)});
  }
  return result.sort((a,b)=>Number(a.needsReview)-Number(b.needsReview)||a.displayName.localeCompare(b.displayName,"ru"));
}
