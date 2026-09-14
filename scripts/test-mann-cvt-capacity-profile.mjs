import assert from 'node:assert/strict';
import {createJiti} from 'jiti';
import {resolve} from 'node:path';
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(import.meta.dirname,'../src')}});
const {parseConditionalFluidCapacities:parse}=await jiti.import('../src/lib/fluid-capacity-conditions.ts');
const {buildMannUnifiedTechnicalProfile:profile}=await jiti.import('../src/lib/mann-unified-technical-profile.ts');
const text='5.8 л. с CVT 5.6 л. с МКПП',parsed=parse(text,'ENGINE_COOLANT');assert.equal(parsed.status,'structured');
const scope={sourceVehicleScope:{make:'toyota',model:'corolla'},matchedEngineScope:['1ZR-FE'],window:{intersection:{from:'2019-01',to:'2022-12'}}};
const validation={independentlyValidated:true,hardConflicts:[],reviewBlockers:[]},policy='MANN_CONDITIONAL_CAPACITY_PREVIEW_V1';
const row={id:'cvt-coolant-test',sourceRequirementId:'source-test',vehicleVariantKey:'test',systemCode:'ENGINE_COOLANT',componentModel:null,state:'STAGED',verificationStatus:'UNVERIFIED',matchClass:'CONFIRMED_MULTI_APPLICABILITY',applyEligible:false,createdAt:new Date('2026-09-14'),reviewConfirmed:false,
 fieldConfidenceJson:{'technical.capacity':'SECONDARY_SOURCE_PARSED_MEDIUM'},evidenceJson:[{publisher:'Fixture',url:'https://example.com/source'}],
 applicabilityJson:scope,technicalDataJson:{fillVolumeText:text,capacityBranches:parsed.branches.map(b=>({condition:b.condition,sourceSegment:b.sourceSegment,applicabilityJson:scope,validation}))},
 provenanceJson:{catalogPreviewPolicy:policy,catalogPreviewEligible:true,sourceTechnicalReviewRequired:true,independentValidation:validation},run:{status:'COMPLETED',mode:'STAGING',independentHumanSignoff:false,productionApplyAuthorized:false,gatesJson:{catalogPreviewPolicy:policy,automaticProductSelection:false}}};
const context={make:'toyota',model:'corolla',engineCode:'1ZR-FE',productionMonth:'2020-06'};
for(const [type,liters] of [['cvt',5.8],['manual',5.6]]){const result=profile([row],type,context);assert.equal(result.items.length,1);assert.equal(result.items[0].capacities.length,1);assert.equal(result.items[0].capacities[0].nominalLiters,liters);assert.equal(result.items[0].automaticSelectionEligible,false);}
for(const type of [undefined,'automatic','robot'])assert.equal(profile([row],type,context).items[0]?.capacities.length??0,0);
for(const patch of [{engineCode:'1ZR-FAE'},{engineCode:undefined},{model:'camry'},{productionMonth:'2023-01'}])assert.equal(profile([row],'cvt',{...context,...patch}).items.length,0);
const broken=structuredClone(row);broken.technicalDataJson.capacityBranches[0].sourceSegment='5.8 л. с АКПП';broken.technicalDataJson.capacities=[{nominalLiters:99}];assert.equal(profile([broken],'cvt',context).items.length,0);
console.log('CVT coolant profile: exact choices, identity and source integrity passed');
