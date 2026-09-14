import assert from "node:assert/strict";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  alias: { "@": new URL("../src", import.meta.url).pathname },
});

const { buildMannUnifiedTechnicalProfile } = await jiti.import("../src/lib/mann-unified-technical-profile.ts");

const base = {
  id: "revision-staged",
  sourceRequirementId: "requirement-primary",
  systemCode: "ENGINE_OIL",
  componentModel: null,
  applicabilityJson: {},
  technicalDataJson: { capacity: { nominalLiters: 5, toleranceLiters: 0.1, serviceContext: "WITH_FILTER" } },
  verifiedFieldsJson: ["technical.capacity"],
  fieldConfidenceJson: { "technical.capacity": "PRIMARY_SOURCE_VERIFIED" },
  evidenceJson: [{ publisher: "OEM", title: "Owner manual", url: "https://example.com/manual.pdf", pdfPage: 20, sha256: "must-not-leak" }],
  provenanceJson: {},
  state: "STAGED",
  verificationStatus: "PRIMARY_SOURCE_VERIFIED_FIELDS",
  matchClass: "PRIMARY_SOURCE_VERIFIED_SUBSET",
  matchScore: 100,
  applyEligible: false,
  createdAt: new Date("2026-09-04T00:00:00Z"),
  reviewConfirmed: true,
  run: {
    status: "COMPLETED",
    mode: "STAGING",
    independentHumanSignoff: false,
    productionApplyAuthorized: false,
    gatesJson: {},
  },
};

const staged = buildMannUnifiedTechnicalProfile([base]);
const marketLimitedOil={...base,applicabilityJson:{requiredMarket:'RU',matchedEngineScope:['RF']}};
assert.equal(buildMannUnifiedTechnicalProfile([marketLimitedOil],undefined,{engineCode:'RF'}).items.length,0);
assert.equal(buildMannUnifiedTechnicalProfile([marketLimitedOil],undefined,{engineCode:'RF',confirmedMarket:'RU'}).items.length,1);
assert.equal(buildMannUnifiedTechnicalProfile([marketLimitedOil],undefined,{engineCode:'RF',confirmedMarket:'DE'}).items.length,0);
assert.equal(buildMannUnifiedTechnicalProfile([marketLimitedOil],undefined,{engineCode:'OTHER',confirmedMarket:'RU'}).items.length,0);
assert.equal(buildMannUnifiedTechnicalProfile([{...marketLimitedOil,reviewConfirmed:false}],undefined,{engineCode:'RF',confirmedMarket:'RU'}).items.length,0);
for(const requiredMarket of ['RU','JP','US','KR','AE','EU','SOUTHEAST_ASIA']){
 const row={...marketLimitedOil,applicabilityJson:{...marketLimitedOil.applicabilityJson,requiredMarket}};
 for(const confirmedMarket of ['RU','JP','US','KR','AE','EU','SOUTHEAST_ASIA',undefined,'DE','Japan','jp'])assert.equal(buildMannUnifiedTechnicalProfile([row],undefined,{engineCode:'RF',confirmedMarket}).items.length,confirmedMarket===requiredMarket?1:0);
 assert.equal(buildMannUnifiedTechnicalProfile([{...row,reviewConfirmed:false}],undefined,{engineCode:'RF',confirmedMarket:requiredMarket}).items.length,0);
}
const gearboxLimitedOil={...base,applicabilityJson:{requiredTransmission:{type:'manual',gearCount:5}}};
assert.equal(buildMannUnifiedTechnicalProfile([gearboxLimitedOil]).items.length,0);
assert.equal(buildMannUnifiedTechnicalProfile([gearboxLimitedOil],'manual',{transmissionGearCount:5}).items.length,1);
assert.equal(buildMannUnifiedTechnicalProfile([gearboxLimitedOil],'automatic',{transmissionGearCount:5}).items.length,0);
assert.equal(buildMannUnifiedTechnicalProfile([gearboxLimitedOil],'manual',{transmissionGearCount:6}).items.length,0);
assert.equal(buildMannUnifiedTechnicalProfile([gearboxLimitedOil],'manual').items.length,0);
assert.equal(buildMannUnifiedTechnicalProfile([gearboxLimitedOil],undefined,{confirmedTransmissionType:'manual',transmissionGearCount:5}).items.length,0);
assert.deepEqual(buildMannUnifiedTechnicalProfile([gearboxLimitedOil]).transmissionOptions.map(o=>o.type),['manual']);
assert.deepEqual(buildMannUnifiedTechnicalProfile([gearboxLimitedOil],'manual').transmissionGearCountOptions,[5]);
assert.deepEqual(buildMannUnifiedTechnicalProfile([gearboxLimitedOil],'manual',{transmissionGearCount:5}).transmissionGearCountOptions,[5]);
assert.equal(buildMannUnifiedTechnicalProfile([gearboxLimitedOil],'automatic').transmissionGearCountOptions,undefined);
const engineLimitedGearboxOil={...gearboxLimitedOil,applicabilityJson:{...gearboxLimitedOil.applicabilityJson,matchedEngineScope:['CAXA']}};
assert.deepEqual(buildMannUnifiedTechnicalProfile([engineLimitedGearboxOil],undefined,{engineCode:'CZCA'}).transmissionOptions,[]);
assert.deepEqual(buildMannUnifiedTechnicalProfile([{...gearboxLimitedOil,reviewConfirmed:false}]).transmissionOptions,[]);
assert.deepEqual(buildMannUnifiedTechnicalProfile([{...gearboxLimitedOil,applicabilityJson:{requiredTransmission:{type:'manual',gearCount:'5'}}}]).transmissionOptions,[]);
const scopedBase={...base,applicabilityJson:{matchedEngineScope:['CAXA'],window:{intersection:{from:'2012-10',to:'2015-06'}}}};
assert.equal(buildMannUnifiedTechnicalProfile([scopedBase]).items.length,0);
assert.equal(buildMannUnifiedTechnicalProfile([scopedBase],undefined,{engineCode:'CAXA',year:2013}).items.length,1);
assert.equal(buildMannUnifiedTechnicalProfile([scopedBase],undefined,{engineCode:'CZCA',year:2013}).items.length,0);
assert.equal(buildMannUnifiedTechnicalProfile([scopedBase],undefined,{engineCode:'CAXA',year:2012}).items.length,0);
assert.equal(staged.status, "staged_preview");
assert.equal(staged.items.length, 1);
assert.equal(staged.items[0].systemLabel, "Моторное масло");
assert.deepEqual(staged.items[0].capacity, {
  nominalLiters: 5,
  minLiters: undefined,
  maxLiters: undefined,
  toleranceLiters: 0.1,
  serviceContext: "WITH_FILTER",
  serviceContextLabel: "с фильтром",
});
assert.equal(staged.items[0].capacities.length, 1);
assert.equal(staged.items[0].sourceStatus, "primary_source");
assert.equal(staged.items[0].requiresReview, false);
assert.equal(staged.items[0].userConfirmedTransmission, false);
assert.deepEqual(staged.transmissionOptions, []);
assert.equal(staged.containsCatalogPreview, false);
assert.deepEqual(staged.items[0].evidence, [{
  publisher: "OEM",
  title: "Owner manual",
  url: "https://example.com/manual.pdf",
  pdfPage: 20,
  printedPage: undefined,
}]);
assert.match(staged.notice, /не утверждено/u);

const unconfirmed = buildMannUnifiedTechnicalProfile([{ ...base, reviewConfirmed: false }]);
assert.deepEqual(unconfirmed, { status: "none", items: [], transmissionOptions: [], selectedTransmissionType: undefined, containsCatalogPreview: false });

const unverifiedCapacity = buildMannUnifiedTechnicalProfile([{
  ...base,
  fieldConfidenceJson: { "technical.capacity": "INFERRED" },
}]);
assert.deepEqual(unverifiedCapacity, { status: "none", items: [], transmissionOptions: [], selectedTransmissionType: undefined, containsCatalogPreview: false });

const active = buildMannUnifiedTechnicalProfile([base, {
  ...base,
  id: "revision-active",
  technicalDataJson: {
    capacity: { nominalLiters: 5.2, serviceContext: "WITH_FILTER" },
    specifications: [{ type: "OEM", value: "VW 504 00" }],
    viscosityGrades: ["5W-30"],
  },
  verifiedFieldsJson: ["technical.capacity", "technical.specifications", "technical.viscosityGrades"],
  fieldConfidenceJson: {
    "technical.capacity": "PRIMARY_SOURCE_VERIFIED",
    "technical.specifications": "PRIMARY_SOURCE_VERIFIED",
    "technical.viscosityGrades": "PRIMARY_SOURCE_VERIFIED",
  },
  state: "ACTIVE",
  applyEligible: true,
  reviewConfirmed: true,
  run: {
    status: "COMPLETED",
    mode: "MATERIALIZED",
    independentHumanSignoff: true,
    productionApplyAuthorized: true,
    gatesJson: {},
  },
}]);
assert.equal(active.status, "active");
assert.equal(active.items.length, 1, "active data replaces staged preview data");
assert.equal(active.items[0].capacity.nominalLiters, 5.2);
assert.deepEqual(active.items[0].specifications, ["VW 504 00"]);
assert.deepEqual(active.items[0].viscosityGrades, ["5W-30"]);
assert.equal(active.notice, undefined);

const unauthorizedActive = buildMannUnifiedTechnicalProfile([{
  ...base,
  state: "ACTIVE",
  applyEligible: true,
  run: {
    status: "COMPLETED",
    mode: "APPLY",
    independentHumanSignoff: true,
    productionApplyAuthorized: false,
    gatesJson: {},
  },
}]);
assert.deepEqual(unauthorizedActive, { status: "none", items: [], transmissionOptions: [], selectedTransmissionType: undefined, containsCatalogPreview: false });

const catalogBase = {
  ...base,
  id: "revision-catalog",
  sourceRequirementId: "requirement-catalog",
  technicalDataJson: {
    capacities: [
      { nominalLiters: 5.9, minLiters: 5.9, maxLiters: 5.9, confidence: "HIGH", kind: "WITH_FILTER", serviceContext: "UNKNOWN", filterContext: "WITH_FILTER" },
      { nominalLiters: 5.5, minLiters: 5.5, maxLiters: 5.5, confidence: "HIGH", kind: "WITHOUT_FILTER", serviceContext: "UNKNOWN", filterContext: "WITHOUT_FILTER" },
    ],
    specifications: [
      { type: "RAW", value: "ACEA C2 for SAE 0W-30" },
      { type: "ACEA", value: "ACEA C2" },
      { type: "SAE", value: "0W-30" },
    ],
    viscosityGrades: ["0W-30", "5W-30"],
    replacementIntervalText: "10 тыс. км или 1 год",
  },
  verifiedFieldsJson: [],
  fieldConfidenceJson: {
    "technical.capacity": "SECONDARY_SOURCE_PARSED_HIGH",
    "technical.specifications": "SECONDARY_SOURCE_PARSED_HIGH",
    "technical.viscosityGrades": "SECONDARY_SOURCE_PARSED_HIGH",
    "technical.replacementInterval": "SECONDARY_SOURCE_PARSED_MEDIUM",
  },
  evidenceJson: [{ publisher: "podbormasla.ru", title: "Каталог технических жидкостей", url: "https://example.com/catalog" }],
  provenanceJson: {
    catalogPreviewPolicy: "MANN_V9_CONSERVATIVE_MATCHER",
    catalogPreviewEligible: true,
    independentValidation: { independentlyValidated: true, hardConflicts: [], reviewBlockers: [] },
  },
  state: "STAGED",
  verificationStatus: "UNVERIFIED",
  matchClass: "CONFIRMED_SINGLE",
  applyEligible: false,
  reviewConfirmed: false,
  run: {
    status: "COMPLETED",
    mode: "STAGING",
    independentHumanSignoff: false,
    productionApplyAuthorized: false,
    gatesJson: {
      catalogPreviewPolicy: "MANN_V9_CONSERVATIVE_MATCHER",
      automaticProductSelection: false,
    },
  },
};

const catalog = buildMannUnifiedTechnicalProfile([catalogBase]);
assert.equal(catalog.status, "catalog_preview");
assert.equal(catalog.items.length, 1);
assert.deepEqual(catalog.items[0].capacities.map((capacity) => [capacity.nominalLiters, capacity.serviceContext]), [
  [5.9, "WITH_FILTER"],
  [5.5, "WITHOUT_FILTER"],
]);
assert.deepEqual(catalog.items[0].specifications, ["ACEA C2"]);
assert.deepEqual(catalog.items[0].viscosityGrades, ["0W-30", "5W-30"]);
assert.equal(catalog.items[0].replacementInterval, "10 тыс. км или 1 год");
assert.equal(catalog.items[0].sourceStatus, "catalog_preview");
assert.equal(catalog.items[0].requiresReview, false);
assert.equal(catalog.containsCatalogPreview, true);
assert.match(catalog.notice, /не подтверждены производителем/u);

const mixed = buildMannUnifiedTechnicalProfile([
  { ...base, id: "active-engine", state: "ACTIVE", applyEligible: true,
    run: { ...base.run, mode: "MATERIALIZED", independentHumanSignoff: true, productionApplyAuthorized: true } },
  { ...base, id: "staged-brakes", systemCode: "BRAKE_FLUID" },
  { ...catalogBase, id: "catalog-coolant", systemCode: "ENGINE_COOLANT" },
  catalogBase,
]);
assert.equal(mixed.status, "active");
assert.equal(mixed.items.length, 3, "verified engine oil must not hide other fluids");
assert.equal(mixed.items.find(item => item.systemCode === "ENGINE_OIL").revisionId, "active-engine");
assert.deepEqual(mixed.items.filter(item => item.automaticSelectionEligible).map(item => item.revisionId), ["active-engine"]);
assert.equal(mixed.containsCatalogPreview, true);
assert.match(mixed.notice, /предварительные/u);
const stagedMixed = buildMannUnifiedTechnicalProfile([base, { ...catalogBase, systemCode: "BRAKE_FLUID" }]);
assert.equal(stagedMixed.items.length, 2);
assert.ok(stagedMixed.items.every(item => !item.automaticSelectionEligible));
const emptyActive = buildMannUnifiedTechnicalProfile([
  { ...base, state: "ACTIVE", applyEligible: true, evidenceJson: [],
    run: { ...base.run, mode: "MATERIALIZED", independentHumanSignoff: true, productionApplyAuthorized: true } },
  catalogBase,
]);
assert.equal(emptyActive.items.length, 1, "unusable primary revision cannot hide readable catalog data");
assert.equal(emptyActive.items[0].automaticSelectionEligible, false);
assert.equal(emptyActive.status, "catalog_preview");

const catalogReview = buildMannUnifiedTechnicalProfile([{ ...catalogBase, id: "revision-catalog-review", state: "REVIEW" }]);
assert.equal(catalogReview.status, "catalog_preview");
assert.equal(catalogReview.items[0].capacities.length, 0, "parser-review capacity is not published as a number");
assert.equal(catalogReview.items[0].requiresReview, true);
assert.deepEqual(catalogReview.items[0].specifications, ["ACEA C2"]);

const unsafeCatalog = buildMannUnifiedTechnicalProfile([{
  ...catalogBase,
  run: { ...catalogBase.run, gatesJson: { catalogPreviewPolicy: "UNKNOWN", automaticProductSelection: false } },
}]);
assert.deepEqual(unsafeCatalog, { status: "none", items: [], transmissionOptions: [], selectedTransmissionType: undefined, containsCatalogPreview: false });

const conditionalTransmission = {
  ...catalogBase,
  id: "revision-automatic",
  sourceRequirementId: "requirement-automatic",
  systemCode: "AUTOMATIC_TRANSMISSION",
  applicabilityJson: { transmissionType: "automatic", engineCodes: ["G4LC"] },
  technicalDataJson: {
    capacities: [{ nominalLiters: 6.7, minLiters: 6.7, maxLiters: 6.7, confidence: "HIGH", serviceContext: "UNKNOWN" }],
    specifications: [{ type: "OEM", value: "HYUNDAI ATF SP-IV" }],
    replacementIntervalText: "100 тыс. км или 6 лет",
  },
  matchClass: "CONDITIONAL_TRANSMISSION",
  matchScore: 92,
  state: "REVIEW",
  provenanceJson: {
    conditionalTransmissionPolicy: "USER_CONFIRMED_TRANSMISSION_V1",
    conditionalTransmissionEligible: true,
    independentValidation: {
      vehicleIdentityIndependentlyValidated: true,
      hardConflicts: [],
      reviewBlockers: ["MANN variant не подтверждает тип или модель коробки"],
    },
  },
  run: {
    ...catalogBase.run,
    gatesJson: {
      conditionalTransmissionPolicy: "USER_CONFIRMED_TRANSMISSION_V1",
      automaticProductSelection: false,
    },
  },
};

const conditionalManual = {
  ...conditionalTransmission,
  id: "revision-manual",
  sourceRequirementId: "requirement-manual",
  systemCode: "MANUAL_TRANSMISSION",
  applicabilityJson: { transmissionType: "manual", engineCodes: ["G4LC"] },
  technicalDataJson: {
    capacities: [{ nominalLiters: 1.6, minLiters: 1.6, maxLiters: 1.6, confidence: "HIGH", serviceContext: "UNKNOWN" }],
    specifications: [{ type: "OEM", value: "API GL-4" }],
  },
};

const beforeTransmissionChoice = buildMannUnifiedTechnicalProfile([catalogBase, conditionalTransmission, conditionalManual]);
assert.deepEqual(beforeTransmissionChoice.transmissionOptions.map((option) => [option.type, option.label]), [
  ["automatic", "АКПП"],
  ["manual", "МКПП"],
]);
assert.equal(beforeTransmissionChoice.items.some((item) => item.systemCode.includes("TRANSMISSION")), false);

const automaticSelected = buildMannUnifiedTechnicalProfile([catalogBase, conditionalTransmission, conditionalManual], "automatic");
assert.equal(automaticSelected.selectedTransmissionType, "automatic");
assert.equal(automaticSelected.items.some((item) => item.systemCode === "MANUAL_TRANSMISSION"), false);
const automaticItem = automaticSelected.items.find((item) => item.systemCode === "AUTOMATIC_TRANSMISSION");
assert.ok(automaticItem);
assert.equal(automaticItem.capacity.nominalLiters, 6.7);
assert.deepEqual(automaticItem.specifications, ["HYUNDAI ATF SP-IV"]);
assert.equal(automaticItem.userConfirmedTransmission, true);
assert.equal(automaticItem.requiresReview, false);

const unsafeConditional = buildMannUnifiedTechnicalProfile([{
  ...conditionalTransmission,
  run: { ...conditionalTransmission.run, gatesJson: { ...conditionalTransmission.run.gatesJson, automaticProductSelection: true } },
}], "automatic");
assert.deepEqual(unsafeConditional, { status: "none", items: [], transmissionOptions: [], selectedTransmissionType: "automatic", containsCatalogPreview: false });

console.log("MANN unified technical profile publication policy tests — passed");
const namedBox={...conditionalTransmission,componentModel:'A4CF1'};
const decimalBox={...conditionalTransmission,componentModel:'- 722.695'};
assert.equal(buildMannUnifiedTechnicalProfile([decimalBox],'automatic').items.length,0);
assert.equal(buildMannUnifiedTechnicalProfile([decimalBox],'automatic',{transmissionModel:'722.695'}).items.length,1);
assert.equal(buildMannUnifiedTechnicalProfile([decimalBox],'automatic',{transmissionModel:'722.699'}).items.length,0);
assert.equal(buildMannUnifiedTechnicalProfile([decimalBox],'manual',{transmissionModel:'722.695'}).items.length,0);
assert.equal(buildMannUnifiedTechnicalProfile([{...decimalBox,componentModel:'722.695 до серийного номера 2834526'}],'automatic',{transmissionModel:'722.695'}).items.length,0);
const missingModel=buildMannUnifiedTechnicalProfile([namedBox],'automatic');
assert.equal(missingModel.items.length,0,'type choice cannot confirm a named gearbox');
assert.deepEqual(missingModel.transmissionComponentOptions,['A4CF1']);
assert.equal(buildMannUnifiedTechnicalProfile([namedBox],'automatic',{transmissionModel:'A4CF2'}).items.length,0);
const exactModel=buildMannUnifiedTechnicalProfile([namedBox],'automatic',{transmissionModel:'a4cf1'});
assert.equal(exactModel.items.length,1);
assert.equal(exactModel.items[0].userConfirmedTransmissionModel,true);
assert.equal(exactModel.items[0].automaticSelectionEligible,false);
assert.equal(buildMannUnifiedTechnicalProfile([namedBox],'manual',{transmissionModel:'A4CF1'}).items.length,0);
const alternatives=buildMannUnifiedTechnicalProfile([{...namedBox,componentModel:'K311 / K313'}],'automatic',{transmissionModel:'K311'});
assert.equal(alternatives.items.length,0);
assert.deepEqual(alternatives.transmissionConditionsToReview,['K311 / K313']);
const datedBox={...namedBox,applicabilityJson:{...namedBox.applicabilityJson,window:{intersection:{from:'2012-10',to:'2015-06'}}}};
assert.equal(buildMannUnifiedTechnicalProfile([datedBox],'automatic',{transmissionModel:'A4CF1',year:2012}).items.length,0);
assert.equal(buildMannUnifiedTechnicalProfile([datedBox],'automatic',{transmissionModel:'A4CF1',productionMonth:'2012-10'}).items.length,1);
console.log('MANN exact transmission component selection tests passed');
const gearRows=[4,6].map(count=>({...conditionalTransmission,id:`gear-${count}`,componentModel:null,
  applicabilityJson:{transmissionType:'automatic',transmissionGearCount:count,sourceVehicleScope:{make:'Kia',model:'Rio',generation:'III'},
    matchedEngineScope:['G4FA'],window:{intersection:{from:'2012-01',to:'2015-12'}}}}));
const gearContext={make:'Kia',model:'Rio',generation:'III',engineCode:'G4FA',year:2013};
const gearChoices=buildMannUnifiedTechnicalProfile(gearRows,'automatic',gearContext);
assert.deepEqual(gearChoices.transmissionGearCountOptions,[4,6]);assert.equal(gearChoices.items.length,0);
assert.equal(buildMannUnifiedTechnicalProfile(gearRows,undefined,gearContext).transmissionOptions[0].type,'automatic');
for(const count of [4,6])assert.deepEqual(buildMannUnifiedTechnicalProfile(gearRows,'automatic',{...gearContext,transmissionGearCount:count}).items.map(r=>r.revisionId),[`gear-${count}`]);
assert.equal(buildMannUnifiedTechnicalProfile(gearRows,'automatic',{...gearContext,transmissionGearCount:5}).items.length,0);
for(const wrong of [{model:'Ceed'},{generation:'II'},{engineCode:'WRONG'},{year:2001}]){
  const result=buildMannUnifiedTechnicalProfile(gearRows,'automatic',{...gearContext,...wrong});
  assert.equal(result.items.length,0);assert.equal(result.transmissionGearCountOptions,undefined);
}
const namedGear={...gearRows[1],componentModel:'A6GF1'};
assert.equal(buildMannUnifiedTechnicalProfile([namedGear],'automatic',{...gearContext,transmissionGearCount:6}).items.length,0);
assert.equal(buildMannUnifiedTechnicalProfile([namedGear],'automatic',{...gearContext,transmissionModel:'A6GF1'}).items.length,0);
assert.equal(buildMannUnifiedTechnicalProfile([namedGear],'automatic',{...gearContext,transmissionModel:'A6GF1',transmissionGearCount:6}).items.length,1);
assert.equal(buildMannUnifiedTechnicalProfile([{...gearRows[0],applicabilityJson:{...gearRows[0].applicabilityJson,transmissionGearCount:'4'}}],'automatic',gearContext).transmissionGearCountOptions,undefined);
console.log('Gear-count choice discovery and strict item gating passed');
const listText='- 716.605 - 716.628 - 716.631';
const listModels=['716.605','716.628','716.631'];
const listRow={...gearRows[1],componentModel:listText,
 applicabilityJson:{...gearRows[1].applicabilityJson,componentModel:listText},
 provenanceJson:{...gearRows[1].provenanceJson,explicitTransmissionModelList:{policy:'EXPLICIT_DECIMAL_MODEL_LIST_V1',sourceComponentModel:listText,models:listModels}},
 run:{...gearRows[1].run,gatesJson:{...gearRows[1].run.gatesJson,transmissionModelListPolicy:'EXPLICIT_DECIMAL_MODEL_LIST_V1'}}};
const listContext={...gearContext,transmissionGearCount:6};
assert.deepEqual(buildMannUnifiedTechnicalProfile([listRow],'automatic',listContext).transmissionComponentOptions,listModels);
assert.equal(buildMannUnifiedTechnicalProfile([listRow],'automatic',listContext).items.length,0);
for(const model of listModels){
 const result=buildMannUnifiedTechnicalProfile([listRow],'automatic',{...listContext,transmissionModel:model});
 assert.equal(result.items.length,1);assert.equal(result.items[0].componentModel,listText);
 assert.equal(result.items[0].userConfirmedTransmissionModel,true);assert.equal(result.items[0].automaticSelectionEligible,false);
}
for(const model of ['716.600',listText,'716.6','',undefined])assert.equal(buildMannUnifiedTechnicalProfile([listRow],'automatic',{...listContext,transmissionModel:model}).items.length,0);
for(const patch of [{engineCode:'WRONG'},{year:2000},{transmissionGearCount:5},{transmissionGearCount:undefined},{model:'Ceed'}])assert.equal(buildMannUnifiedTechnicalProfile([listRow],'automatic',{...listContext,transmissionModel:listModels[0],...patch}).items.length,0);
assert.equal(buildMannUnifiedTechnicalProfile([listRow],'manual',{...listContext,transmissionModel:listModels[0]}).items.length,0);
for(const row of [
 {...listRow,run:gearRows[1].run},
 {...listRow,provenanceJson:gearRows[1].provenanceJson},
 {...listRow,componentModel:listText+' до с/н 2834526'},
 {...listRow,applicabilityJson:{...listRow.applicabilityJson,componentModel:'716.605'}},
 {...listRow,provenanceJson:{...listRow.provenanceJson,explicitTransmissionModelList:{...listRow.provenanceJson.explicitTransmissionModelList,models:['716.605','716.600']}}},
])assert.equal(buildMannUnifiedTechnicalProfile([row],'automatic',{...listContext,transmissionModel:listModels[0]}).items.length,0);
console.log('Explicit model list: opt-in, exact membership and identity/count gates passed');
const cvtText='- RE0F10D - Jatco JF016E',cvtModels=['RE0F10D','JATCO JF016E'],cvtPolicy='EXPLICIT_CVT_SOURCE_MODEL_LIST_V1';
const {transmissionGearCount:unusedCvtCount,...cvtScope}=listRow.applicabilityJson;
const cvtRow={...listRow,systemCode:'CVT_TRANSMISSION',componentModel:cvtText,
 applicabilityJson:{...cvtScope,transmissionType:'cvt',componentModel:cvtText},
 provenanceJson:{...listRow.provenanceJson,explicitTransmissionModelList:{policy:cvtPolicy,sourceComponentModel:cvtText,models:cvtModels}},
 run:{...listRow.run,gatesJson:{...listRow.run.gatesJson,transmissionModelListPolicy:cvtPolicy}}};
const cvtContext={...gearContext};
const choices=buildMannUnifiedTechnicalProfile([cvtRow],'cvt',cvtContext);
assert.deepEqual(choices.transmissionComponentOptions,[...cvtModels].sort());assert.equal(choices.transmissionGearCountOptions,undefined);assert.equal(choices.items.length,0);
for(const model of cvtModels){const result=buildMannUnifiedTechnicalProfile([cvtRow],'cvt',{...cvtContext,transmissionModel:model});assert.equal(result.items.length,1);assert.equal(result.items[0].componentModel,cvtText);assert.equal(result.items[0].automaticSelectionEligible,false);assert.equal(result.items[0].userConfirmedTransmissionModel,true);}
for(const model of ['JF016E','RE0F10A',cvtText,undefined])assert.equal(buildMannUnifiedTechnicalProfile([cvtRow],'cvt',{...cvtContext,transmissionModel:model}).items.length,0);
for(const type of [undefined,'automatic','manual','robot'])assert.equal(buildMannUnifiedTechnicalProfile([cvtRow],type,{...cvtContext,transmissionModel:cvtModels[0]}).items.length,0);
for(const patch of [{engineCode:'WRONG'},{engineCode:undefined},{model:'Ceed'},{year:2000}])assert.equal(buildMannUnifiedTechnicalProfile([cvtRow],'cvt',{...cvtContext,transmissionModel:cvtModels[0],...patch}).items.length,0);
for(const row of [
 {...cvtRow,run:gearRows[1].run},
 {...cvtRow,provenanceJson:gearRows[1].provenanceJson},
 {...cvtRow,componentModel:cvtText+' до 2015'},
 {...cvtRow,applicabilityJson:{...cvtRow.applicabilityJson,transmissionGearCount:6}},
 {...cvtRow,applicabilityJson:{...cvtRow.applicabilityJson,componentModel:'RE0F10D'}},
 {...cvtRow,provenanceJson:{...cvtRow.provenanceJson,explicitTransmissionModelList:{...cvtRow.provenanceJson.explicitTransmissionModelList,models:['RE0F10D','JF016E']}}},
])assert.equal(buildMannUnifiedTechnicalProfile([row],'cvt',{...cvtContext,transmissionModel:cvtModels[0]}).items.length,0);
console.log('CVT explicit source alternatives: opt-in, no alias/fixed count, strict identity and model selection passed');
const {explicitMannAlphanumericModels:alphaParse}=await jiti.import('../src/lib/mann-transmission-model-list.ts');
assert.deepEqual(alphaParse('- RS5F30A - RS5F31A'),['RS5F30A','RS5F31A']);
assert.deepEqual(alphaParse('- Jatco JF015E'),['JATCO JF015E']);
for(const text of ['01J (VL300 Multitronic)','- 01V (ZF 5HP19)','- A343F / 1998-2002','- 6AT','- 7DCT','- 1998','- C50 - C50','- C50 до 2010','- TF-80SC / TF-80SD','- C50 *','- LSD'])assert.equal(alphaParse(text),null,text);
const alphaPolicy='EXPLICIT_ALPHANUMERIC_SOURCE_MODEL_LIST_V1';
for(const [text,models,type,count]of [['- RS5F30A - RS5F31A',['RS5F30A','RS5F31A'],'manual',5],['- RE7R01B',['RE7R01B'],'automatic',7],['- Jatco JF015E',['JATCO JF015E'],'cvt',undefined]]){
 const scope={...cvtScope,transmissionType:type,componentModel:text,...(count?{transmissionGearCount:count}:{})};
 const row={...listRow,systemCode:type==='manual'?'MANUAL_TRANSMISSION':type==='cvt'?'CVT_TRANSMISSION':'AUTOMATIC_TRANSMISSION',componentModel:text,applicabilityJson:scope,
  provenanceJson:{...listRow.provenanceJson,explicitTransmissionModelList:{policy:alphaPolicy,sourceComponentModel:text,models}},run:{...listRow.run,gatesJson:{...listRow.run.gatesJson,transmissionModelListPolicy:alphaPolicy}}};
 const context={...gearContext,transmissionGearCount:count};
 assert.deepEqual(buildMannUnifiedTechnicalProfile([row],type,context).transmissionComponentOptions,[...models].sort());
 for(const model of models)assert.equal(buildMannUnifiedTechnicalProfile([row],type,{...context,transmissionModel:model}).items.length,1);
 for(const model of [undefined,'WRONG',text])assert.equal(buildMannUnifiedTechnicalProfile([row],type,{...context,transmissionModel:model}).items.length,0);
 const selected={...context,transmissionModel:models[0]};
 for(const wrong of [{engineCode:undefined},{engineCode:'WRONG'},{year:1990},...(count?[{transmissionGearCount:undefined},{transmissionGearCount:99}]:[])])assert.equal(buildMannUnifiedTechnicalProfile([row],type,{...selected,...wrong}).items.length,0);
 for(const wrongType of [undefined,'manual','automatic','robot','cvt'].filter(t=>t!==type))assert.equal(buildMannUnifiedTechnicalProfile([row],wrongType,selected).items.length,0);
 for(const changed of [{...row,run:listRow.run},{...row,provenanceJson:listRow.provenanceJson},{...row,componentModel:text+' до 2010'},{...row,provenanceJson:{...row.provenanceJson,explicitTransmissionModelList:{policy:alphaPolicy,sourceComponentModel:text,models:['OTHER']}}}])assert.equal(buildMannUnifiedTechnicalProfile([changed],type,selected).items.length,0);
 if(type==='cvt')assert.equal(buildMannUnifiedTechnicalProfile([{...row,applicabilityJson:{...scope,transmissionGearCount:6}}],type,selected).items.length,0);
}
console.log('Alphanumeric source bullets: exact opt-in models, no qualifier loss, all gates passed');
