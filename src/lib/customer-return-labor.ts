import { prisma } from "@/lib/db";
import { getScopedBranchId } from "@/lib/request-tenant-store";
import { assistantTariffContext } from "@/lib/ai-assistant/tariff-context";
import { resolveLaborPrice, type AppliedLaborRule } from "@/lib/ai-assistant/labor-pricing";

/** Legacy tariffs remain branch-owned even when their organization code is `default`. */
export async function resolveCustomerReturnLabor(organizationId:string,materialsOwner:"service"|"customer"="service"):Promise<AppliedLaborRule> {
  const branchId=getScopedBranchId();
  const tariff=await assistantTariffContext(organizationId);
  const current=await resolveLaborPrice({organizationId,locationId:tariff.locationId??"",serviceFamily:"engine_oil",procedureType:"oil_change",materialsOwner});
  // Never override a configured rule, including one requiring manual confirmation.
  if(current.source!=="system_policy" || organizationId==="default")return current;
  const now=new Date();
  const rules=await prisma.aIAssistantLaborPricingRule.findMany({
    where:{branchId,organizationId:"default",serviceFamily:"engine_oil",procedureType:"oil_change",active:true,
      vehicleId:null,aggregateCode:null,transmissionConfiguration:null,
      materialsOwner:{in:[materialsOwner]},effectiveFrom:{lte:now},OR:[{effectiveTo:null},{effectiveTo:{gte:now}}]},
    orderBy:[{effectiveFrom:"desc"},{updatedAt:"desc"},{id:"asc"}],
  });
  // A legacy location must agree with the resolved location, or be unique in this branch.
  const locations=[...new Set(rules.map(r=>r.locationId).filter(Boolean))];
  const locationId=tariff.locationId&&locations.includes(tariff.locationId)?tariff.locationId:locations.length===1?locations[0]:null;
  const rule=locationId?rules.find(r=>r.locationId===locationId):null;
  if(!rule)return current;
  return {id:rule.id,name:rule.name,source:"assistant_rule",laborPriceCents:rule.laborPriceCents,
    priceFromCents:rule.priceFromCents,priceToCents:rule.priceToCents,requiresHumanConfirmation:rule.requiresHumanConfirmation,
    comment:rule.comment,selectionReason:`Действующий тариф текущего филиала с прежним кодом организации default; ${materialsOwner==="customer"?"масло клиента":"материалы сервиса"}.`};
}
