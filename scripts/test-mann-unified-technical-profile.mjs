import assert from "node:assert/strict";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  alias: { "@": new URL("../src", import.meta.url).pathname },
});

const { buildMannUnifiedTechnicalProfile } = await jiti.import("../src/lib/mann-unified-technical-profile.ts");

const base = {
  id: "revision-staged",
  systemCode: "ENGINE_OIL",
  componentModel: null,
  technicalDataJson: { capacity: { nominalLiters: 5, toleranceLiters: 0.1, serviceContext: "WITH_FILTER" } },
  verifiedFieldsJson: ["technical.capacity"],
  fieldConfidenceJson: { "technical.capacity": "PRIMARY_SOURCE_VERIFIED" },
  evidenceJson: [{ publisher: "OEM", title: "Owner manual", url: "https://example.com/manual.pdf", pdfPage: 20, sha256: "must-not-leak" }],
  state: "STAGED",
  verificationStatus: "PRIMARY_SOURCE_VERIFIED_FIELDS",
  applyEligible: false,
  createdAt: new Date("2026-09-04T00:00:00Z"),
  reviewConfirmed: true,
  run: {
    status: "COMPLETED",
    mode: "STAGING",
    independentHumanSignoff: false,
    productionApplyAuthorized: false,
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
assert.deepEqual(staged.items[0].evidence, [{
  publisher: "OEM",
  title: "Owner manual",
  url: "https://example.com/manual.pdf",
  pdfPage: 20,
  printedPage: undefined,
}]);
assert.match(staged.notice, /не утверждено/u);

const unconfirmed = buildMannUnifiedTechnicalProfile([{ ...base, reviewConfirmed: false }]);
assert.deepEqual(unconfirmed, { status: "none", items: [] });

const unverifiedCapacity = buildMannUnifiedTechnicalProfile([{
  ...base,
  fieldConfidenceJson: { "technical.capacity": "INFERRED" },
}]);
assert.deepEqual(unverifiedCapacity, { status: "none", items: [] });

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
    mode: "APPLY",
    independentHumanSignoff: true,
    productionApplyAuthorized: true,
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
  },
}]);
assert.deepEqual(unauthorizedActive, { status: "none", items: [] });

console.log("MANN unified technical profile publication policy tests — passed");
