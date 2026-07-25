#!/usr/bin/env node

import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url, { alias: { "@": resolve(workspaceRoot, "src") } });
const {
  classifyFluidSystem,
  parseCapacities,
  parseSpecifications,
  prepareFluidCatalog,
} = await jiti.import("../src/lib/fluid-catalog.ts");

assert.equal(classifyFluidSystem("МАСЛО в АКПП-6"), "AUTOMATIC_TRANSMISSION");
assert.equal(classifyFluidSystem("МАСЛО в МКПП-5"), "MANUAL_TRANSMISSION");
assert.equal(classifyFluidSystem("ЖИДКОСТЬ в ГУР"), "POWER_STEERING");
assert.equal(classifyFluidSystem("МАСЛО в ВАРИАТОР CVT"), "CVT_TRANSMISSION");
assert.equal(classifyFluidSystem("МАСЛО в ЗАДНИЙ РЕДУКТОР"), "REAR_DIFFERENTIAL");
assert.equal(classifyFluidSystem("АНТИФРИЗ в ИНВЕРТОР"), "INVERTER_COOLANT");

const capacities = parseCapacities("6.0-6.5 л. частичный\n8.1 л. полный");
assert.deepEqual(capacities.map((capacity) => [capacity.kind, capacity.minLiters, capacity.maxLiters]), [
  ["partial", 6, 6.5],
  ["total", 8.1, 8.1],
]);

const specifications = parseSpecifications("Renault RN 0710, API SN, ACEA C3 для SAE 5W-40", ["5W-40"]);
assert.ok(specifications.some((specification) => specification.type === "RENAULT"));
assert.ok(specifications.some((specification) => specification.type === "API"));
assert.ok(specifications.some((specification) => specification.type === "ACEA"));
assert.ok(specifications.some((specification) => specification.type === "SAE"));

const baseRow = {
  source_url: "https://podbormasla.ru/toyota/rav4/gen3/",
  page_path: "/toyota/rav4/gen3/",
  brand_slug: "toyota",
  model_slug: "rav4",
  generation_slug: "gen3",
  page_title: "Масло для Toyota RAV4 III, 2006-2010",
  table_index: 2,
  table_kind: "vehicle_fluids",
  headers_json: "[]",
  extra_columns_json: "{}",
  raw_cells_json: "[]",
  fetched_at: "2026-07-23T00:00:00.000Z",
  page_sha256: "page",
};
const rows = [
  {
    ...baseRow,
    row_id: "engine-row",
    row_index: 1,
    application: "МАСЛО в ДВИГАТЕЛЬ Модель: - 2AZ-FE / 170 л.с. Тип топлива: Бензин Объём двигателя: 2.4 л. Годы выпуска: 2006-2010",
    system_name: "МАСЛО в ДВИГАТЕЛЬ",
    model: "- 2AZ-FE / 170 л.с. / 2006-2010",
    fuel_type: "Бензин",
    engine_displacement: "2.4 л.",
    power: "170 л.с.",
    production_years: "2006-2010",
    fill_volume: "4.3 л.",
    specification: "API SN, ILSAC GF-5 для SAE 5W-30",
    replacement_interval: "10 тыс. км или 1 год",
    recommendation: "",
    sae_json: "[\"5W-30\"]",
  },
  {
    ...baseRow,
    row_id: "rear-diff-row",
    row_index: 2,
    application: "МАСЛО в ЗАДНИЙ РЕДУКТОР",
    system_name: "МАСЛО в ЗАДНИЙ РЕДУКТОР",
    model: "-",
    fill_volume: "0.9 л.",
    specification: "API GL-5 для SAE 80W-90",
    replacement_interval: "40 тыс. км",
    recommendation: "",
    sae_json: "[\"80W-90\"]",
  },
  {
    ...baseRow,
    row_id: "matrix-row",
    source_url: "https://podbormasla.ru/nissan/terrano/2gen/",
    page_path: "/nissan/terrano/2gen/",
    brand_slug: "nissan",
    model_slug: "terrano",
    generation_slug: "2gen",
    page_title: "Nissan Terrano II, 1995-2002",
    table_index: 4,
    row_index: 1,
    table_kind: "vehicle_fluid_matrix",
    application: "NISSAN TERRANO Кузов: LR50 Привод: 4WD КПП: АКПП-4 Годы выпуска: 1995-2002",
    system_name: "NISSAN TERRANO",
    extra_columns_json: JSON.stringify({
      column_2_моторное_масло: "ДВС: VG33E (3300 см³ / 170 л.с.) бензин Требования ОЕМ: API SJ Объём заливки: 3,7 л. Рекомендация: -",
      column_3_масло_кпп: "Тип: АКПП-4 Требования OEM: ATF Fluid D Объём заливки: 8,5 л. Рекомендация: -",
      column_5_тормозная_жидкость: "ТОРМОЗНАЯ ЖИДКОСТЬ: Рекомендация: DOT 4",
    }),
  },
];

const mannFiltersCsv = [
  "make,model,model_years,vehicle_text,effective_vehicle_text,detail,engine_code,kw,hp,vehicle_years,condition,filter_type,filter_subtype,mann_article,filter_note,pdf_page,catalog_page",
  "TOYOTA,RAV4 III,06-10,2.4,2.4,2.4,2AZ-FE,125,170,01/06-12/10,,oil,,W68/3,,1,1",
].join("\n");
const prepared = prepareFluidCatalog({
  rowsNdjson: rows.map((row) => JSON.stringify(row)).join("\n"),
  mannFiltersCsv,
  summaryJson: JSON.stringify({ counts: { rows: rows.length } }),
});

assert.equal(prepared.sourceRows.length, 3);
assert.equal(prepared.requirements.length, 5);
assert.equal(prepared.stats.warnings.length, 0);
const rearDiff = prepared.requirements.find((requirement) => requirement.sourceRowId === "rear-diff-row");
assert.ok(rearDiff);
assert.deepEqual(rearDiff.engineCodesJson, ["2AZ-FE"]);
assert.equal(rearDiff.engineVolumeCc, 2400);
assert.equal(rearDiff.systemCode, "REAR_DIFFERENTIAL");
assert.equal(rearDiff.replacementKmMin, 40_000);
assert.ok(prepared.links.some((link) => link.requirementId === rearDiff.id && link.status === "auto_matched"));
assert.equal(prepared.requirements.filter((requirement) => requirement.sourceRowId === "matrix-row").length, 3);

function prepareOneVehicle({ rowId, make, model, generation, title, engine, volume, power = "", fuel, years, mannRows }) {
  const row = {
    ...baseRow,
    row_id: rowId,
    source_url: `https://podbormasla.ru/${make}/${model}/${generation}/`,
    page_path: `/${make}/${model}/${generation}/`,
    brand_slug: make,
    model_slug: model,
    generation_slug: generation,
    page_title: title,
    row_index: 1,
    application: `МАСЛО в ДВИГАТЕЛЬ Модель: ${engine} Тип топлива: ${fuel} Объём двигателя: ${volume} л. Мощность: ${power} Годы выпуска: ${years}`,
    system_name: "МАСЛО в ДВИГАТЕЛЬ",
    model: engine,
    fuel_type: fuel,
    engine_displacement: `${volume} л.`,
    power,
    production_years: years,
    fill_volume: "5.0 л.",
    specification: "API SP для SAE 5W-30",
    replacement_interval: "10 тыс. км",
    recommendation: "",
    sae_json: "[\"5W-30\"]",
  };
  return prepareFluidCatalog({
    rowsNdjson: JSON.stringify(row),
    mannFiltersCsv: [mannFiltersCsv.split("\n")[0], ...mannRows].join("\n"),
    summaryJson: JSON.stringify({ counts: { rows: 1 } }),
  });
}

const audiBodyMatch = prepareOneVehicle({
  rowId: "audi-cyrillic-body",
  make: "audi",
  model: "a4",
  generation: "gen3",
  title: "Масло для Audi A4 | 3 поколение (В7) | 2005-2008",
  engine: "AEB",
  volume: "1.8",
  power: "150 л.с.",
  fuel: "Бензин",
  years: "2005-2008",
  mannRows: [
    "AUDI,A4(8E/B7),04-08,1.8T,1.8T,1.8T,AEB,110,150,01/05-12/08,,oil,,W1,,1,1",
    "AUDI,A4(8K/B8),08-15,1.8TFSI,1.8TFSI,1.8TFSI,AEB,110,150,01/08-12/15,,oil,,W2,,1,1",
  ],
});
assert.equal(audiBodyMatch.stats.autoMatchedRequirements, 1);
assert.equal(audiBodyMatch.links.filter((link) => link.status === "auto_matched").length, 1);
assert.equal(audiBodyMatch.links[0]?.mannModel, "A4(8E/B7)");

const engineAlias = prepareOneVehicle({
  rowId: "engine-alias",
  make: "bmw",
  model: "x1",
  generation: "gen1",
  title: "Масло для BMW X1 E84, 1 поколение, 2009-2015",
  engine: "N55B30",
  volume: "3.0",
  power: "306 л.с.",
  fuel: "Бензин",
  years: "2009-2015",
  mannRows: ["BMW,X1(E84),09-15,35iX(E84),35iX(E84),35iX(E84),N55B30A,225,306,01/09-12/15,,oil,,W3,,1,1"],
});
assert.equal(engineAlias.links[0]?.status, "auto_matched");
assert.equal(engineAlias.links[0]?.matchMethod, "make_model_engine_alias");

const subaruEj255VariantCue = prepareOneVehicle({
  rowId: "subaru-ej255-variant-cue",
  make: "subaru",
  model: "forester",
  generation: "gen2",
  title: "Масло для Subaru Forester SG, 2002-2008",
  engine: "EJ255",
  volume: "2.5",
  fuel: "Бензин",
  years: "2002-2008",
  mannRows: [
    "SUBARU,Forester(SG),02-08,2.5XT-Turbo(SG),2.5XT-Turbo(SG),2.5XT-Turbo(SG),EJ25,169,230,01/02-12/08,,oil,,W4,,1,1",
    "SUBARU,Forester(SG),02-08,2.5RX(SG),2.5RX(SG),2.5RX(SG),EJ25,127,173,01/02-12/08,,oil,,W5,,1,1",
  ],
});
assert.equal(subaruEj255VariantCue.stats.autoMatchedRequirements, 1);
assert.equal(subaruEj255VariantCue.stats.reviewRequirements, 0);
assert.equal(subaruEj255VariantCue.links.length, 1);
assert.equal(subaruEj255VariantCue.links[0]?.mannVehicleText, "2.5XT-Turbo(SG)");

console.log("Fluid catalog normalization and MANN matching tests — passed");
