import { withAssistantExecution } from "@/lib/ai-assistant/execution";
import { prisma } from "@/lib/db";
import { getScopedBranchId } from "@/lib/request-tenant-store";
import { lookupVehicle, normalizePlateInput } from "@/lib/vehicle-identity";
import { resolveMannVehicle } from "@/lib/mann-vehicle-resolver";
import { normalizeMannArticle } from "@/lib/mann-catalog";
import type { ReturnOfferProduct } from "@/lib/customer-return-offer";

type Input = {vin?:string|null;plate?:string|null;organizationId:string};
type Applicability = {ids:string[];basis:string;issue?:string};
const pending=new Map<string,Promise<Applicability>>();
const failureCooldown=new Map<string,{until:number;result:Applicability}>();

/** The same TRONK → MANN → compatible local products path used in a new shipment.
 * TRONK persists its own lookup cache. No separate supplier or guessed variant.
 */
async function resolveApplicability(input:Input):Promise<Applicability> {
  const lookup=await withAssistantExecution(20_000,undefined,()=>lookupVehicle({
    organizationId:input.organizationId,inputType:input.vin?"vin":"plate",input:input.vin??input.plate!,extended:true,
  }));
  if(lookup.status!=="found"||lookup.candidates.length!==1||!lookup.vehicle){
    return {ids:[],basis:"TRONK",issue:"По VIN или госномеру не удалось однозначно определить автомобиль для подбора фильтра."};
  }
  const vehicle=lookup.vehicle;
  if(input.vin&&vehicle.vin!==input.vin||!input.vin&&vehicle.licensePlate&&normalizePlateInput(vehicle.licensePlate).normalized!==normalizePlateInput(input.plate!).normalized){
    return {ids:[],basis:"TRONK",issue:"Идентификатор найденного автомобиля не совпал с историей обслуживания."};
  }
  // A VIN is optional for plate results: the shipment also resolves MANN from
  // make/model/engine/year supplied directly by TRONK.
  const resolution=await resolveMannVehicle({organizationId:input.organizationId,vehicle});
  if(resolution.status!=="resolved")return {ids:[],basis:"TRONK → MANN",issue:resolution.status==="candidates"
    ?"Как в отгрузке: нужно подтвердить MANN-модификацию автомобиля перед подбором фильтра."
    :"По характеристикам автомобиля не найдена MANN-модификация для масляного фильтра."};
  const filters=resolution.filters.filter(f=>/^(oil|oil-filter)$/i.test(f.filterType));
  const articles=new Set(filters.map(f=>normalizeMannArticle(f.mannArticle)));
  if(!filters.length||articles.size!==1||filters.some(f=>!!f.condition))return {ids:[],basis:"TRONK → MANN",issue:"В MANN нет однозначного масляного фильтра без дополнительных условий применимости."};
  const article=filters[0].mannArticle;
  const ids=[...new Set(resolution.localMatches.filter(m=>articles.has(m.mannArticleNormalized)).flatMap(m=>m.compatibleProducts.map(p=>p.id)))];
  return {ids,basis:`Подбор как в отгрузке: TRONK по ${input.vin?"VIN":"госномеру"} → подтверждённая модификация MANN → ${article} → OEM Parts / ProductMannLink.`,...(!ids.length?{issue:`Для MANN ${article} не найден совместимый товар в каталоге филиала.`}:{})};
}

export async function lookupCustomerReturnOilFilter(input:Input):Promise<{products:ReturnOfferProduct[];basis:string;issue?:string}|null> {
  const branchId=getScopedBranchId();
  const identity=input.vin??(input.plate?normalizePlateInput(input.plate).normalized:"");
  if(!identity||input.vin&&!/^[A-HJ-NPR-Z0-9]{17}$/.test(input.vin))return null;
  const key=JSON.stringify([branchId,input.organizationId,input.vin?"vin":"plate",identity]);
  let applicability:Applicability;
  const previous=failureCooldown.get(key);
  if(previous&&previous.until>Date.now())applicability=previous.result;
  else {
    if(!pending.has(key))pending.set(key,resolveApplicability(input));
    const work=pending.get(key)!;
    try{applicability=await work;}catch{applicability={ids:[],basis:"TRONK → MANN",issue:"Подбор фильтра временно недоступен. Повторите расчёт позже."};}
    finally{if(pending.get(key)===work)pending.delete(key);}
    if(!applicability.ids.length){if(failureCooldown.size>=1000)failureCooldown.clear();failureCooldown.set(key,{until:Date.now()+60_000,result:applicability});}
    else failureCooldown.delete(key);
  }
  if(!applicability.ids.length)return {products:[],basis:applicability.basis,issue:applicability.issue};
  // The catalogue matcher can summarize one warehouse; the daily offer uses
  // fresh free stock from all active stores of the selected branch.
  const products=await prisma.localProduct.findMany({where:{branchId,id:{in:applicability.ids},archived:false,entityType:"product"},select:{id:true,name:true,uomName:true,salePriceCents:true,priceNeedsSetup:true,archived:true,entityType:true,stockBalances:{where:{branchId,store:{archived:false}},select:{available:true}}}});
  return {products:products.map(p=>({id:p.id,name:p.name,unit:p.uomName,priceCents:p.salePriceCents,priceNeedsSetup:p.priceNeedsSetup,archived:p.archived,entityType:p.entityType,available:p.stockBalances.reduce((s,b)=>s+Math.max(0,Number(b.available)),0)})),basis:applicability.basis};
}
