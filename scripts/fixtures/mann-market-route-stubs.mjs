// Isolated schema/serialization test only: never used by application imports.
export const MANN_TRANSMISSION_TYPES=['automatic','manual','cvt','robot'];
export async function requireBranchApi(){return {ok:true,context:{test:true}};}
export async function runWithBranchApiContext(context,fn){if(!context.test)throw Error('test-only stub');return fn();}
export async function getMannUnifiedTechnicalProfile(variantKeys,transmissionType,vehicleContext){return {variantKeys,transmissionType,vehicleContext};}
