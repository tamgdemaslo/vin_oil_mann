export async function getSession() { return globalThis.__tgmPricingSession; }
export async function getBranchContext() { return globalThis.__tgmPricingContext; }
export function branchErrorResponse() { return { error:'Access denied',status:403 }; }
