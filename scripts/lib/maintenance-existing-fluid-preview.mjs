import {createHash} from 'node:crypto';
export const EXISTING_FLUID_PREVIEW_POLICY='MANN_ENGINE_DATE_SCOPED_PREVIEW_V1';
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
/** Conservative engine/basic-fluid proposal only. No write, approval or scope invention. */
export function existingFluidPreview({requirement:r,variantKey,decision,capacity,window,engineScope,sourceFingerprint,denied=false,existing=false}){
 const reasons=[];const target=decision.targets.find(t=>t.vehicleVariantKey===variantKey);
 if(existing)reasons.push('EXISTING_REVISION');if(denied)reasons.push('DENIED_ASSOCIATION');
 if(!['ENGINE_OIL','ENGINE_COOLANT','BRAKE_FLUID'].includes(r.systemCode))reasons.push('CONDITIONAL_COMPONENT_REQUIRES_SEPARATE_REVIEW');
 if(!/^https:\/\//i.test(r.sourceUrl??'')||r.contextConfidence==='ai_research'||r.sourceTableKey==='AI_SELECTED_MANN_RESEARCH_V1')reasons.push('SOURCE_NOT_LEGACY_CATALOG');
 if(!decision.status.startsWith('CONFIRMED')||!target?.independentlyValidated||target.hardConflicts.length||target.reviewBlockers.length)reasons.push('CURRENT_FULL_MAKE_MATCH_NOT_CONFIRMED');
 if(!window?.intersection?.from||!window.intersection.to)reasons.push('DATE_WINDOW_UNRESOLVED');
 if(!engineScope?.length)reasons.push('NO_EXACT_ENGINE_SCOPE');
 if(r.transmissionType||r.driveType||r.componentModel?.trim()&&!/^[-—]$/.test(r.componentModel.trim()))reasons.push('SOURCE_HAS_COMPONENT_CONDITIONS');
 if(reasons.length)return {reasons};
 const specifications=Array.isArray(r.specificationsJson)?r.specificationsJson:[];
 const viscosities=Array.isArray(r.viscosityGradesJson)?r.viscosityGradesJson:[];
 const capacityEligible=!capacity.needsReview&&capacity.capacities.length>0&&capacity.capacities.every(c=>c.confidence!=='LOW');
 if(!specifications.length&&!viscosities.length&&!capacityEligible)return {reasons:['NO_SAFE_PARSED_FIELDS']};
 const applicabilityJson={sourceVehicleScope:{make:r.make,model:r.model,...(r.generation?{generation:r.generation}:{})},matchedEngineScope:engineScope,window};
 const technicalDataJson={fillVolumeText:r.fillVolumeText,capacities:capacityEligible?capacity.capacities:[],specifications,viscosityGrades:viscosities};
 const semanticFingerprint=sha({policy:EXISTING_FLUID_PREVIEW_POLICY,sourceRequirementId:r.id,variantKey,applicabilityJson,technicalDataJson});
 return {reasons:[],revision:{id:'mtar_'+semanticFingerprint.slice(0,24),semanticFingerprint,sourceRequirementId:r.id,vehicleVariantKey:variantKey,systemCode:r.systemCode,componentModel:null,applicabilityJson,technicalDataJson,verifiedFieldsJson:[],fieldConfidenceJson:{'technical.capacity':capacityEligible?'SECONDARY_SOURCE_PARSED_MEDIUM':'NONE','technical.specifications':specifications.length?'SECONDARY_SOURCE_PARSED_MEDIUM':'NONE','technical.viscosityGrades':viscosities.length?'SECONDARY_SOURCE_PARSED_MEDIUM':'NONE'},evidenceJson:[{title:r.sourceRow?.pageTitle??'Сохранённый каталог технических жидкостей',url:r.sourceUrl}],provenanceJson:{catalogPreviewPolicy:EXISTING_FLUID_PREVIEW_POLICY,catalogPreviewEligible:true,sourceTechnicalReviewRequired:true,sourceAssociationFingerprint:sourceFingerprint,independentValidation:target,reuseExistingDatabaseOnly:true,sourceRequirementHash:sha(r),rawCapacityHeldForReview:!capacityEligible},matchClass:decision.status,matchScore:target.score,state:'STAGED',verificationStatus:'UNVERIFIED',applyEligible:false}};
}
