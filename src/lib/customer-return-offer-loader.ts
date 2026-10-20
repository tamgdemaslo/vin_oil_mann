import { prisma } from "@/lib/db";
import { getScopedBranchId } from "@/lib/request-tenant-store";
import { assistantTariffContext } from "@/lib/ai-assistant/tariff-context";
import { resolveLaborPrice } from "@/lib/ai-assistant/labor-pricing";
import { attachCustomerReturnOffers, customerReturnSender, customerReturnBookingUrl } from "./customer-return-offer";
import type { ReturnCandidate, ReturnDocument } from "./customer-return-candidates";

/** Reads current branch prices and free stock only. Never reserves, writes, or sends. */
export async function enrichCustomerReturnOffers(candidates:ReturnCandidate[],documents:ReturnDocument[]) {
  if(!candidates.length)return candidates;
  const branchId=getScopedBranchId();
  const branch=await prisma.branch.findFirstOrThrow({where:{id:branchId},select:{slug:true,name:true,address:true,status:true,legacyOrganizationId:true,bookingSettings:{select:{publicBookingEnabled:true}}}});
  const organizationId=branch.legacyOrganizationId??branchId;
  const tariff=await assistantTariffContext(organizationId);
  const labor=await resolveLaborPrice({organizationId,locationId:tariff.locationId??"",serviceFamily:"engine_oil",procedureType:"oil_change",materialsOwner:"service"});
  const ids=new Set(candidates.flatMap(c=>c.reasons.flatMap(r=>r.documentIds)));
  const relevant=documents.filter(d=>ids.has(d.id));
  const productIds=[...new Set(relevant.flatMap(d=>d.lines.flatMap(l=>l.productId?[l.productId]:[])))];
  const products=await prisma.localProduct.findMany({where:{branchId,id:{in:productIds}},select:{id:true,name:true,uomName:true,salePriceCents:true,priceNeedsSetup:true,archived:true,entityType:true,stockBalances:{where:{branchId,store:{archived:false}},select:{available:true}}}});
  const context={
    sender:customerReturnSender(branch),
    bookingUrl:customerReturnBookingUrl(process.env.PUBLIC_BOOKING_ORIGIN??process.env.APP_ORIGIN??process.env.NEXT_PUBLIC_APP_ORIGIN,branchId,branch.status==="active"&&!!branch.bookingSettings?.publicBookingEnabled),
    laborCents:labor.source!=="system_policy"&&!labor.requiresHumanConfirmation&&labor.priceFromCents==null&&labor.priceToCents==null?labor.laborPriceCents:null,
    laborBasis: `${labor.name}. ${labor.selectionReason}`,
    products:products.map(p=>({id:p.id,name:p.name,unit:p.uomName,priceCents:p.salePriceCents,priceNeedsSetup:p.priceNeedsSetup,archived:p.archived,entityType:p.entityType,available:p.stockBalances.reduce((sum,b)=>sum+Math.max(0,Number(b.available)),0)})),
  };
  return candidates.map(candidate=>attachCustomerReturnOffers(candidate,relevant,context)).sort((a,b)=>Number(a.needsReview)-Number(b.needsReview)||a.displayName.localeCompare(b.displayName,"ru"));
}
