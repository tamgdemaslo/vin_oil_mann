import { resolveHistoricalFilterMannArticles } from "@/lib/customer-return-historical-filter";
import { lookupCustomerReturnOilFilter } from "@/lib/customer-return-live-filter";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { getScopedBranchId } from "@/lib/request-tenant-store";
import { customerVehicleIdentity, normalizeVehicleIdentifier } from "@/lib/customer-vehicle-identity";
import { normalizePlateInput, type NormalizedVehicleIdentity } from "@/lib/vehicle-identity";
import { resolveMannVehicle } from "@/lib/mann-vehicle-resolver";
import { listMannFilters, matchMannArticlesToLocalProducts, normalizeMannArticle } from "@/lib/mann-catalog";
import { normalizeCrossReferenceBrand, parseOemParts } from "@/lib/part-number-cross-reference";
import { oilService, returnMaterialKind, returnFilterSelectionKey, type ReturnFilterSelection, type ReturnOfferProduct } from "@/lib/customer-return-offer";
import type { ReturnCandidate, ReturnDocument } from "@/lib/customer-return-candidates";

type HistoricalProduct = ReturnOfferProduct & { article?:string|null; code?:string|null; brand?:string|null; oemParts?:string|null };
const usable = (p:ReturnOfferProduct,quantity:number) => !p.archived && p.entityType==="product" && !p.priceNeedsSetup && Number.isSafeInteger(p.priceCents) && p.priceCents>0 && Number.isFinite(p.available) && p.available>=quantity;
const oilFilter = (type:string) => /^(oil|oil-filter)$/i.test(type);

/** No fuzzy name matching: only explicit MANN identity/crosses from the old card. */
export function historicalFilterMannArticles(product:HistoricalProduct|undefined):string[] {
  if(!product)return [];
  return [...new Set([
    ...(normalizeCrossReferenceBrand(product.brand)==="MANN"&&product.article?[product.article]:[]),
    ...parseOemParts(product.oemParts).filter(p=>p.brand==="MANN").map(p=>p.articleRaw),
  ].map(normalizeMannArticle).filter(Boolean))];
}

/** Reuses saved fitment first, then looks up a missing filter by VIN/plate.
 * Acquired applicability is cached; current stock and prices are never cached. No messages or AI.
 */
export async function loadCustomerReturnFilterSelections(candidates:ReturnCandidate[],documents:ReturnDocument[],products:HistoricalProduct[],organizationId:string) {
  const branchId=getScopedBranchId();
  const byProduct=new Map(products.map(p=>[p.id,p]));
  const selections:Record<string,ReturnFilterSelection[]>={};
  const issues:Record<string,string>={};
  const historyMatches=new Map<string,Promise<string[]>>();
  const matches=new Map<string,Promise<ReturnOfferProduct[]>>();
  const vehicles=new Map<string,Promise<{articles:string[];basis:string}|null>>();
  async function currentMatches(articles:string[]) {
    const key=[...articles].sort().join("|");
    if(!matches.has(key))matches.set(key,(async()=>{
      const result=await matchMannArticlesToLocalProducts({organizationId,mannArticles:articles.map(mannArticle=>({mannArticle,filterType:"oil"}))});
      const ids=[...new Set(result.flatMap(r=>r.compatibleProducts.map(p=>p.id)))];
      if(!ids.length)return [];
      // Re-read unrestricted branch stock: catalogue summaries can be limited to five stores.
      const rows=await prisma.localProduct.findMany({where:{branchId,id:{in:ids},archived:false,entityType:"product"},select:{id:true,name:true,uomName:true,salePriceCents:true,priceNeedsSetup:true,archived:true,entityType:true,stockBalances:{where:{branchId,store:{archived:false}},select:{available:true}}}});
      return rows.map(p=>({id:p.id,name:p.name,unit:p.uomName,priceCents:p.salePriceCents,priceNeedsSetup:p.priceNeedsSetup,archived:p.archived,entityType:p.entityType,available:p.stockBalances.reduce((s,b)=>s+Math.max(0,Number(b.available)),0)}));
    })());
    return matches.get(key)!;
  }
  async function vehicleArticles(history:ReturnDocument[],counterpartyId?:string|null) {
    const identities=history.map(d=>customerVehicleIdentity(d.attributes));
    const vins=[...new Set(identities.flatMap(i=>i.vin?[i.vin]:[]))];
    const plates=[...new Set(identities.flatMap(i=>i.plate?[i.plate]:[]))];
    if(vins.length>1||!vins.length&&plates.length!==1)return null;
    const identifier=vins[0]??plates[0];
    const key=identifier?`${counterpartyId??""}:${identifier}`:null;
    if(!key)return null;
    if(!vehicles.has(key))vehicles.set(key,(async()=>{
      const profiles=counterpartyId?await prisma.clientVehicle.findMany({where:{branchId,counterpartyId,status:"ACTIVE",verificationStatus:"CONFIRMED"},select:{vin:true,plate:true,mannVariantIdsJson:true,make:true,model:true,year:true}}):[];
      const matchingProfiles=profiles.filter(p=>vins.length?normalizeVehicleIdentifier(p.vin)===vins[0]:plates.includes(normalizeVehicleIdentifier(p.plate)));
      // Two passports for the same identifier need a person to resolve the conflict.
      if(matchingProfiles.length>1)return null;
      const profile=matchingProfiles[0];
      const variantIds=profile&&Array.isArray(profile.mannVariantIdsJson)?profile.mannVariantIdsJson.filter((v):v is string=>typeof v==="string"):[];
      if(profile&&variantIds.length){
        const groups=await Promise.all(variantIds.map(variantId=>listMannFilters({variantId,make:profile.make,model:profile.model,year:profile.year})));
        const articles=[...new Set(groups.flat().filter(f=>oilFilter(f.filterType)&&!f.condition).map(f=>f.mannArticle))];
        // Different oil-filter applications are not interchangeable merely because they fit a model family.
        if(articles.length===1)return {articles,basis:`Подтверждённый паспорт автомобиля и MANN по ${vins.length?"VIN":"госномеру"}.`};
        return null;
      }
      const inputs=[...vins,...plates.map(p=>normalizePlateInput(p).normalized)];
      const rows=await prisma.vehicleLookupCache.findMany({where:{branchId,organizationId,status:"success",normalizedInputHash:{in:inputs.map(v=>createHash("sha256").update(v).digest("hex"))}},select:{normalizedVehicleJson:true},orderBy:{completedAt:"desc"}});
      const decoded=rows.map(r=>r.normalizedVehicleJson as NormalizedVehicleIdentity|null).filter((v):v is NormalizedVehicleIdentity=>!!v&&typeof v==="object"&&!Array.isArray(v));
      // A VIN in history must agree with the lookup. A plate must not override it.
      const usable=decoded.filter(v=>vins.length ? v.vin===vins[0] : normalizePlateInput(v.licensePlate??"").normalized===normalizePlateInput(plates[0]).normalized);
      if(!usable.length)return null;
      const signatures=new Set(usable.map(v=>JSON.stringify([v.vin,v.makeCanonical,v.modelCanonical,v.engineCode,v.year])));
      if(signatures.size!==1)return null;
      const resolution=await resolveMannVehicle({organizationId,vehicle:usable[0]});
      if(resolution.status!=="resolved")return null;
      const filters=resolution.filters.filter(f=>oilFilter(f.filterType)&&!f.condition);
      return new Set(filters.map(f=>f.mannArticleNormalized)).size===1?{articles:[...new Set(filters.map(f=>f.mannArticle))],basis:`Подтверждённый подбор MANN по ${vins.length?"VIN":"госномеру"} автомобиля.`}:null;
    })());
    return vehicles.get(key)!;
  }
  const processed=new Set<string>();
  async function process(candidate:ReturnCandidate,reason:ReturnCandidate["reasons"][number]){
    const key=returnFilterSelectionKey(reason);
    if(processed.has(key)||reason.needsReview)return;
    processed.add(key);
    const history=documents.filter(d=>reason.documentIds.includes(d.id));
    const date=history.filter(oilService).map(d=>d.date).sort().at(-1);
    if(!date)return;
    const old=history.filter(d=>d.date===date).flatMap(d=>d.lines).filter(l=>l.quantity>0&&returnMaterialKind(l)==="filter");
    // Multiple old filters can be a kit or separate applications; never collapse them into one SKU.
    if(old.length>1)return;
    const quantity=old[0]?.quantity??1;
    if(!Number.isSafeInteger(quantity)||quantity<=0)return;
    const previous=old[0]?.productId?byProduct.get(old[0].productId):undefined;
    if(previous&&usable(previous,quantity))return;
    try {
      const historyKey=JSON.stringify([previous?.id,old[0]?.name]);
      if(!historyMatches.has(historyKey))historyMatches.set(historyKey,resolveHistoricalFilterMannArticles({product:previous,historicalName:old[0]?.name??"",organizationId}));
      let articles=await historyMatches.get(historyKey)!;
      const historical=articles.length>0;
      let basis=`Прежний фильтр ${old[0]?.name??"из истории"} → MANN ${articles.join(", ")} → совместимый товар филиала. Двигатель не требуется.`;
      if(!articles.length){const vehicle=await vehicleArticles(history,candidate.counterpartyId).catch(()=>null);if(vehicle){articles=vehicle.articles;basis=vehicle.basis;}}
      let options=(articles.length?await currentMatches(articles).catch(()=>[]):[]).filter(p=>usable(p,quantity));
      if(!options.length&&historical){
        issues[key]=`Связь прежнего фильтра с MANN ${articles.join(", ")} установлена. Нет совместимого товара с достаточным свободным остатком и настроенной ценой; зарезервированный остаток не предлагается.`;
        return;
      }
      if(!options.length){
        const identities=history.map(d=>customerVehicleIdentity(d.attributes));
        const vins=[...new Set(identities.flatMap(i=>i.vin?[i.vin]:[]))];
        const plates=[...new Set(identities.flatMap(i=>i.plate?[i.plate]:[]))];
        // Never use an old plate to replace a known VIN, or choose between conflicting VINs.
        if(vins.length>1||!vins.length&&plates.length!==1)return;
        const live=await lookupCustomerReturnOilFilter({organizationId,vin:vins[0],plate:vins.length?null:plates[0]});
        if(live){options=live.products.filter(p=>usable(p,quantity));basis=live.basis;if(live.issue)issues[key]=live.issue;else if(!options.length)issues[key]="Для подобранного фильтра нет достаточного свободного остатка или настроенной цены в филиале.";}
      }
      options.sort((a,b)=>a.priceCents-b.priceCents||a.id.localeCompare(b.id));
      if(options[0])selections[key]=[{product:options[0],quantity,replaces:old[0]?.name??null,basis}];
    } catch {
      // An unavailable catalogue must not break the daily queue or silently approve the old filter.
    }
  }
  const jobs=candidates.flatMap(candidate=>candidate.reasons.map(reason=>({candidate,reason})));
  let next=0;
  await Promise.all(Array.from({length:Math.min(3,jobs.length)},async()=>{
    while(next<jobs.length){const job=jobs[next++];await process(job.candidate,job.reason);}
  }));
  return {selections,issues};
}
