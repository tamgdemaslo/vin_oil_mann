import assert from "node:assert/strict";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const {
  clientVehicleCompleteness,
  mergeClientVehiclePassport,
  normalizeManualVehicleProfile,
  vehicleIdentityToProfileWrite,
} = await jiti.import("../src/lib/client-vehicle-profile.ts");

const decoded = vehicleIdentityToProfileWrite({
  vin: " z94k241bbjr074943 ",
  licensePlate: "с729ве39",
  makeRaw: "HYUNDAI",
  makeCanonical: "HYUNDAI",
  modelRaw: "Solaris II",
  modelCanonical: "SOLARIS",
  engineVolumeLiters: 1.4,
  powerHp: 100,
  engineCode: "g4lc",
  sourceMethods: ["tronk_vindecode2"],
  confidence: "high",
});
assert.equal(decoded.values.vin, "Z94K241BBJR074943");
assert.equal(decoded.values.plate, "С729ВЕ39");
assert.equal(decoded.values.engineVolumeCc, 1400);
assert.equal(decoded.values.engineCode, "G4LC");
assert.equal(decoded.confidence, "HIGH");

const autoMerge = mergeClientVehiclePassport({
  existing: { make: "HYUNDAI", model: "Solaris", year: 2018, transmissionType: "manual" },
  fieldSources: {
    transmissionType: {
      source: "vehicle_card",
      confidence: "HIGH",
      verificationStatus: "CONFIRMED",
      updatedAt: "2026-09-01T10:00:00.000Z",
    },
  },
  incoming: { ...decoded, values: { ...decoded.values, year: 2019, transmissionType: "automatic", fuelType: "petrol" } },
  mode: "auto",
  now: "2026-09-05T10:00:00.000Z",
  actorLogin: "ilya",
});
assert.equal(autoMerge.values.year, 2018, "automatic lookup must not overwrite an existing year");
assert.equal(autoMerge.values.transmissionType, "manual", "automatic lookup must not overwrite a confirmed transmission");
assert.equal(autoMerge.values.fuelType, "petrol", "automatic lookup should fill empty fields");
assert.deepEqual(autoMerge.changedFields, ["makeCanonical", "modelCanonical", "plate", "vin", "engineCode", "engineVolumeCc", "powerHp", "fuelType"]);

const manual = normalizeManualVehicleProfile({
  make: " Hyundai ",
  model: " Solaris ",
  year: "2018",
  engineVolumeCc: "1400",
  mileage: "154 000",
  transmissionType: "АКПП",
});
const confirmedMerge = mergeClientVehiclePassport({
  existing: autoMerge.values,
  fieldSources: autoMerge.fieldSources,
  incoming: manual,
  mode: "confirmed",
  now: "2026-09-05T11:00:00.000Z",
  actorLogin: "ilya",
});
assert.equal(confirmedMerge.values.transmissionType, "АКПП");
assert.equal(confirmedMerge.values.mileage, 154000);
assert.equal(confirmedMerge.fieldSources.transmissionType.verificationStatus, "CONFIRMED");
assert.equal(confirmedMerge.fieldSources.transmissionType.updatedBy, "ilya");

const normalizedPowertrain = normalizeManualVehicleProfile({
  transmissionType: "REAR_DRIVE · AUTOMATIC",
  driveType: "REAR_DRIVE",
});
assert.equal(normalizedPowertrain.values.transmissionType, "АКПП");
assert.equal(normalizedPowertrain.values.driveType, "Задний");
assert.equal(normalizeManualVehicleProfile({ transmissionType: "FORWARD_CONTROL · VARIATOR" }).values.transmissionType, "Вариатор");
assert.equal(normalizeManualVehicleProfile({ transmissionType: "ALL_WHEEL_DRIVE · UNKNOWN_TRANSMISSION" }).values.transmissionType, null);

const completeValues = {
  make: "HYUNDAI",
  model: "Solaris",
  year: 2018,
  vin: "Z94K241BBJR074943",
  engineVolumeCc: 1400,
  powerHp: 100,
  fuelType: "petrol",
  transmissionType: "automatic",
  driveType: "front",
  mileage: 154000,
};
const completeness = clientVehicleCompleteness(completeValues);
assert.deepEqual(completeness, { completed: 10, total: 10, percent: 100, missing: [] });

const frameCompleteness = clientVehicleCompleteness({ ...completeValues, vin: null, frameNumber: "KZN130-0001234" });
assert.equal(frameCompleteness.missing.includes("vin"), false, "frame number must satisfy the vehicle identity requirement");

console.log("Client vehicle passport merge and completeness tests — passed");
