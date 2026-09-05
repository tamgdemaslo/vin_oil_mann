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
