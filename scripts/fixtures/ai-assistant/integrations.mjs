export class RosskoError extends Error {}
export const DEFAULT_ROSSKO_MARKUP_RULES = [{ fromCents:0,toCents:null,marginPercent:20 }];
export async function getAgentSettings() { return { rosskoSearchEnabled:true,rosskoMarkupRules:DEFAULT_ROSSKO_MARKUP_RULES,calculationRules:{literRoundingStep:1,transmissionMachineExchangeMultiplier:1.7,transmissionMinimumBillableLiters:0,maxTechnicalVerificationPasses:2,totalRoundingCents:100,...globalThis.__tgmReplay.rules} }; }
export async function rosskoConfig() { return {deliveryId:'fixture-delivery',addressId:'fixture-address'}; }
export async function rosskoSearch() { const f=globalThis.__tgmReplay;f.providerCalls++;if(f.rosskoFailure)throw new RosskoError('fetch failed');return f.rossko ?? {PartsList:{Part:[]}}; }
export async function resolveMannVehicle(args) { const f=globalThis.__tgmReplay;f.mannCalls++;(f.mannVehicles ??= []).push(args.vehicle);return f.mann ?? {status:'unresolved',decision:'NO_MATCH',selectedApplication:null,filters:[],localMatches:[],candidates:[]}; }
export async function getMannUnifiedTechnicalProfile() { return globalThis.__tgmReplay.profile ?? {status:'none',items:[],transmissionOptions:[],containsCatalogPreview:false}; }
export async function lookupVehicle() { const f=globalThis.__tgmReplay;f.vehicleCalls++;return {status:'resolved',vehicle:f.vehicle,fromCache:true,sourceMethods:[]}; }
export const normalizeVehicleMake = value => value;
export const normalizeVehicleModel = value => ({ canonical: value });
