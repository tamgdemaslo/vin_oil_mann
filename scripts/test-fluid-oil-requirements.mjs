#!/usr/bin/env node

import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url, { alias: { "@": resolve(workspaceRoot, "src") } });
const {
  oilRequirementsFromCatalogMatch,
  selectFluidCatalogOilMatch,
} = await jiti.import("../src/lib/fluid-oil-requirements.ts");

const base = {
  makeNormalized: "TOYOTA",
  modelNormalized: "RAV4",
  yearFrom: 2019,
  yearTo: 2024,
  fillVolumeText: "4.6 л. с фильтром",
  serviceVolumeLiters: 4.6,
  fillVolumeMaxLiters: 4.6,
  contextConfidence: "row_engine",
};

const rows = [
  {
    ...base,
    id: "2ar",
    sourceUrl: "https://example.test/toyota/rav4/gen5/",
    engineCodesJson: ["2AR-FE"],
    engineVolumeCc: 2500,
    powerHp: 199,
    specificationsJson: [
      { type: "API", value: "API SN" },
      { type: "SAE", value: "5W-30" },
    ],
    viscosityGradesJson: ["5W-30"],
  },
  {
    ...base,
    id: "a25a",
    sourceUrl: "https://example.test/toyota/rav4/gen5/",
    engineCodesJson: ["A25A-FKS"],
    engineVolumeCc: 2500,
    powerHp: 203,
    specificationsJson: [
      { type: "API", value: "API SP" },
      { type: "ILSAC", value: "ILSAC GF-6A" },
      { type: "SAE", value: "0W-16" },
    ],
    viscosityGradesJson: ["0W-16"],
  },
];

const exact = selectFluidCatalogOilMatch({ make: "Toyota", model: "RAV4 (XA50)", year: "2021", engineCode: "A25A FKS", engineVolumeCc: 2500, powerHp: 203 }, rows);
assert.ok(exact);
assert.equal(exact.requirement.id, "a25a");
assert.ok(exact.matchedBy.includes("код двигателя"));

const requirements = oilRequirementsFromCatalogMatch(exact);
assert.deepEqual(requirements.sae_viscosities, ["0W-16"]);
assert.deepEqual(requirements.api, ["SP"]);
assert.deepEqual(requirements.ilsac, ["GF-6"]);
assert.equal(requirements.oil_capacity_liters, 4.6);
assert.equal(requirements.oil_capacity_note, "с фильтром");

const ambiguous = selectFluidCatalogOilMatch({ make: "Toyota", model: "RAV4", year: "2021" }, rows);
assert.equal(ambiguous, null);

const outOfRange = selectFluidCatalogOilMatch({ make: "Toyota", model: "RAV4", year: "2010", engineCode: "A25A-FKS" }, rows);
assert.equal(outOfRange, null);

console.log("Fluid catalog oil requirement lookup tests — passed");
