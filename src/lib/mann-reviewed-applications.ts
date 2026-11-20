import { normalizePartNumberForCrossMatch } from "@/lib/part-number-cross-reference";
import type { MannCatalogFilter } from "@/lib/mann-catalog";

// Supplements are catalogue records with source evidence, not per-VIN overrides.
// No production import or schema mutation is performed at application startup.
const key = "mann-online:mercedes:w203:c200kompressor:m111955:200005-200205";
const base = {
  vehicleVariantKey: key, make: "MERCEDES-BENZ", makeNormalized: "MERCEDES-BENZ",
  model: "C-Klasse(W203/C203/S203)", modelNormalized: "C KLASSE W203 C203 S203", modelYears: "00-12",
  vehicleText: "C 200 Kompressor (W/C/S203)", effectiveVehicleText: "C 200 Kompressor (W/C/S203)",
  engineCode: "M 111.955", engineCodeNormalized: "M111.955", kw: "120", hp: "163",
  engineVolumeCc: 1998, manufacturerTypeCodes: ["203.045"],
  vehicleYears: "05/00-05/02", vehicleYearFrom: 2000, vehicleYearTo: 2002, condition: null,
};
export const reviewedMannSources = {
  identity: "https://catalog.hengst.com/en/online-catalog/product/7835310000-01/de/",
  oil: "https://www.mann-filter.com/uk-en/catalogue/search-results/product.html/hu727/1x_mann-filter.html",
  air: "https://www.mann-filter.com/uk-en/catalogue/search-results/product.html/c47109_mann-filter.html",
  fuel: "https://www.mann-filter.com/content/dam/website/mann-filter/mann-filter-com/de/dokumente/MANN-FILTER_PKW_Katalog_2020_21.pdf",
  cabin: "https://www.mann-filter.com/de-de/katalog/suchergebnisse/produkt.html/cuk3461_mann-filter.html",
};
export function reviewedMannRows() { return [{ ...base }]; }
export function reviewedMannApplications(keys: readonly string[]) { return keys.includes(key) ? reviewedMannRows() : []; }
export function reviewedMannFilters(variantKey: string): MannCatalogFilter[] | undefined {
  if (variantKey !== key) return undefined;
  return ([['oil', 'HU 727/1 x'], ['air', 'C 47 109'], ['fuel', 'WK 720'], ['cabin', 'CUK 3461']] as const).map(([filterType, mannArticle]) => ({
    filterType, mannArticle, mannArticleNormalized: normalizePartNumberForCrossMatch(mannArticle).canonical,
    filterSubtype: null, filterNote: `Источник MANN: ${reviewedMannSources[filterType]}`,
    condition: filterType === 'cabin' ? 'Проверить применяемость по исполнению климатической системы и расположению руля.' : null,
    vehicleText: base.vehicleText, effectiveVehicleText: base.effectiveVehicleText,
    engineCode: base.engineCode, kw: base.kw, hp: base.hp, vehicleYears: base.vehicleYears, pdfPage: null, catalogPage: null,
  }));
}
