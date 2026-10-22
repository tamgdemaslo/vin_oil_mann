import { toServiceDateInput } from "./date-time";
import type { ReturnCandidate } from "./customer-return-candidates";
import type { CustomerReturnSharedState } from "./customer-return-shared-types";

export const RETURN_CONTACT_STATUSES=["sent","queued","sending","unknown"];
/** A new calendar day, scenario, price or template is never a new reason to contact a customer. */
export function returnContactBlocks(candidate:Pick<ReturnCandidate,"offers">,previous:CustomerReturnSharedState):boolean {
  if(!RETURN_CONTACT_STATUSES.includes(previous.deliveryStatus??""))return false;
  if(previous.deliveryStatus!=="sent")return true;
  const contacted=toServiceDateInput(previous.deliveryAt??previous.updatedAt);
  // Only confirmed new engine-oil service AFTER the previous invitation opens a new cycle.
  return !candidate.offers?.length || candidate.offers.some(offer=>!offer.sourceDate||offer.sourceDate<=contacted);
}
export function returnFingerprintOffers(fingerprint:string):Pick<ReturnCandidate,"offers"> {
  try{const value=JSON.parse(fingerprint);if(Array.isArray(value.offers)&&value.offers.every((offer:unknown)=>offer&&typeof offer==="object"&&"sourceDate" in offer&&typeof offer.sourceDate==="string"))return {offers:value.offers};}catch{}
  return {};
}
/** Current-day optimistic versions stay local to the day, while delivery history stays visible. */
export function effectiveCustomerReturnState(candidate:Pick<ReturnCandidate,"offers">,state:CustomerReturnSharedState):CustomerReturnSharedState {
  if(state.deliveryStatus&&state.deliveryStatus!=="none")return state;
  const previous=state.previousDelivery;
  if(!previous||!returnContactBlocks(candidate,previous))return state;
  return {...previous,version:state.version,serviceDate:state.serviceDate,previousDelivery:previous,historyServiceDate:previous.serviceDate};
}
