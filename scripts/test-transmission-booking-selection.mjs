import assert from "node:assert/strict";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { isTransmissionOilVariant, normalizeBookingServiceSelection, toggleBookingServiceSelection } = await jiti.import("../src/lib/booking/transmission-selection.ts");
const services = [
  { id: "partial-shop", name: "Частичная замена масла в АКПП: наши материалы, без фильтра", price: 3500 },
  { id: "partial-customer", name: "Частичная замена масла в АКПП: ваши материалы, 2 фильтра", price: 10000 },
  { id: "hardware", name: "Аппаратная замена масла в АКПП: наши материалы, 1 фильтр", price: 7000 },
  { id: "level", name: "Выставление уровня АКПП", price: 2490 },
  { id: "filter", name: "Замена салонного фильтра", price: 500 },
];
const toggle = (ids, id) => toggleBookingServiceSelection(ids, id, services);

let selected = toggle(["filter", "level"], "partial-shop");
assert.deepEqual(selected, ["filter", "partial-shop"], "The included level service must not be charged or timed again");
selected = toggle(selected, "partial-customer");
assert.deepEqual(selected, ["filter", "partial-customer"], "Choosing another material/filter tariff replaces the previous AKPP tariff");
assert.equal(services.filter(service => selected.includes(service.id)).reduce((total, service) => total + service.price, 0), 10500);
assert.deepEqual(toggle(selected, "level"), selected, "An included level cannot be added as a paid extra");
selected = toggle(selected, "hardware");
assert.deepEqual(selected, ["filter", "hardware"], "Partial and hardware methods are mutually exclusive for one visit");
selected = toggle(selected, "hardware");
assert.deepEqual(toggle(selected, "level"), ["filter", "level"], "Standalone level remains bookable without an oil change");
assert.deepEqual(normalizeBookingServiceSelection(["obsolete", "partial-shop", "level", "filter", "hardware", "hardware"], services), ["filter", "hardware"], "Existing browser drafts are cleaned on load");
assert.equal(isTransmissionOilVariant("Диагностика АКПП"), false);
assert.equal(isTransmissionOilVariant("Замена масла в DSG"), false);
console.log("Transmission booking: exclusive tariffs, included level, independent services and draft restoration passed");
