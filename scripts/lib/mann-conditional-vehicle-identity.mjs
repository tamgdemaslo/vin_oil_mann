// Mirrors the chassis/model prerequisites in matcher eligibleCandidate.
// Missing gearbox evidence may be deferred to user choice, not vehicle identity.
export function conditionalVehicleIdentityReasons(source,candidate){
 const reasons=[];
 if(!candidate?.featureContributions?.some(f=>f.feature==='базовая модель'&&f.weight>=18))reasons.push('NO_STRONG_MODEL_IDENTITY');
 const explicit=Boolean(source.generation||(Array.isArray(source.bodyCodesJson)&&source.bodyCodesJson.length));
 if(explicit&&!candidate?.matchedFields?.some(f=>f==='поколение'||f==='код кузова'))reasons.push('MISSING_EXPLICIT_CHASSIS_IDENTITY');
 return reasons;
}
