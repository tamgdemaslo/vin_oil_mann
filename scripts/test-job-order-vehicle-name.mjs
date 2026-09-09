import assert from "node:assert/strict";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { cleanJobOrderVehicleName } = await jiti.import("../src/lib/job-order-vehicle-name.ts");
const vin = "VF34C5FTF55219364";
const plate = "С881ТО39";

for (const value of [
  `PEUGEOT 308 · ${plate} · VIN ${vin}`,
  `PEUGEOT 308 · VIN: ${vin} · гос. номер: ${plate}`,
  `PEUGEOT 308 ${plate} ${vin}`,
  `PEUGEOT 308 · С 881 ТО 39 · VIN ${vin.toLowerCase()}`,
]) {
  assert.equal(cleanJobOrderVehicleName(value, vin, plate), "PEUGEOT 308");
}
for (const value of ["PEUGEOT 308", "Mercedes-Benz E 200", "BMW X5 (G05)", "Mazda CX-5"]) {
  assert.equal(cleanJobOrderVehicleName(value, vin, plate), value);
  assert.equal(cleanJobOrderVehicleName(value, "—", "—"), value);
}
assert.equal(cleanJobOrderVehicleName(`VIN ${vin}`, vin, "—"), "");
assert.equal(cleanJobOrderVehicleName("Peugeot 308 GT", "—", "С881ТО39"), "Peugeot 308 GT");
console.log("Job order vehicle name checks passed");
