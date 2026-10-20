import { loadCustomerReturnFilterSelections } from "@/lib/customer-return-filter-loader";
import { prisma } from "@/lib/db";
import { getScopedBranchId } from "@/lib/request-tenant-store";
import { resolveCustomerReturnLabor } from "@/lib/customer-return-labor";
import { attachCustomerReturnOffers, customerReturnSender, customerReturnBookingUrl } from "./customer-return-offer";
import type { ReturnCandidate, ReturnDocument } from "./customer-return-candidates";

/** Uses current branch prices/free stock; missing filter applicability may be looked up and cached. Never reserves or sends. */
export async function enrichCustomerReturnOffers(candidates:ReturnCandidate[],documents:ReturnDocument[]) {
  if(!candidates.length)return candidates;
  const branchId=getScopedBranchId();
  const branch=await prisma.branch.findFirstOrThrow({where:{id:branchId},select:{slug:true,name:true,address:true,status:true,legacyOrganizationId:true,bookingSettings:{select:{publicBookingEnabled:true}}}});
  const organizationId=branch.legacyOrganizationId??branchId;
  const labor=await resolveCustomerReturnLabor(organizationId);
  const ids=new Set(candidates.flatMap(c=>c.reasons.flatMap(r=>r.documentIds)));
  const relevant=documents.filter(d=>ids.has(d.id));
  const productIds=[...new Set(relevant.flatMap(d=>d.lines.flatMap(l=>l.productId?[l.productId]:[])))];
  const products=await prisma.localProduct.findMany({where:{branchId,id:{in:productIds}},select:{id:true,name:true,article:true,code:true,brand:true,oemParts:true,uomName:true,salePriceCents:true,priceNeedsSetup:true,archived:true,entityType:true,stockBalances:{where:{branchId,store:{archived:false}},select:{available:true}}}});
  const context={
    sender:customerReturnSender(branch),
    bookingUrl:customerReturnBookingUrl(process.env.PUBLIC_BOOKING_ORIGIN??process.env.APP_ORIGIN??process.env.NEXT_PUBLIC_APP_ORIGIN,branchId,branch.status==="active"&&!!branch.bookingSettings?.publicBookingEnabled),
    laborCents:labor.source!=="system_policy"&&!labor.requiresHumanConfirmation&&labor.priceFromCents==null&&labor.priceToCents==null?labor.laborPriceCents:null,
    laborBasis: `${labor.name}. ${labor.selectionReason}`,
    products:products.map(p=>({id:p.id,name:p.name,article:p.article,code:p.code,brand:p.brand,oemParts:p.oemParts,unit:p.uomName,priceCents:p.salePriceCents,priceNeedsSetup:p.priceNeedsSetup,archived:p.archived,entityType:p.entityType,available:p.stockBalances.reduce((sum,b)=>sum+Math.max(0,Number(b.available)),0)})),
  };
  const {selections:filterSelections,issues:filterLookupIssues}=await loadCustomerReturnFilterSelections(candidates,relevant,context.products,organizationId);
  return candidates.map(candidate=>attachCustomerReturnOffers(candidate,relevant,{...context,filterSelections,filterLookupIssues})).sort((a,b)=>Number(a.needsReview)-Number(b.needsReview)||a.displayName.localeCompare(b.displayName,"ru"));
}
