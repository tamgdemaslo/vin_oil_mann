/**
 * Volvo calls XC60 2008–2017 generation I; MANN lists these applications
 * under XC60, separately from XC60 II. This is catalogue identity evidence,
 * not OEM approval of any fluid. Do not generalize bare model names to I.
 * Sources checked 2026-09-14:
 * https://www.volvocars.com/us/media/models/xc60gen1/2006/
 * https://www.mann-filter.com/uk-en/catalogue/search-results/product.html/hu8014z_mann-filter.html
 */
const XC60_FIRST_GENERATION_APPLICATIONS = new Set([
  "D4204T4|110|150|03/15-04/17",
  "D4204T14|140|190|03/15-02/17",
  "D4204T5|133|181|11/13-12/15",
  "B4204T11|180|245|11/13-02/17",
  "B4204T9|225|306|11/13-12/17",
]);

export function mannRowGenerationEvidence(row: {
  make?: string | null;
  model?: string | null;
  modelYears?: string | null;
  engineCode?: string | null;
  kw?: string | number | null;
  hp?: string | number | null;
  vehicleYears?: string | null;
}): "I" | undefined {
  // Exact archived application corroborated by MANN's current C 2964 table.
  // Suzuki distinguishes the SX4 introduced in 2006 from its 2013 S-CROSS
  // successor. Do not transfer this identity to other SX4 powers or periods.
  // https://www.mann-filter.com/de-de/katalog/suchergebnisse/produkt.html/c2964_mann-filter.html
  // https://www.globalsuzuki.com/globalnews/2016/0929a.html
  if (row.make === "SUZUKI" && row.model === "SX4" && row.modelYears == null
      && row.engineCode === "M16A" && String(row.kw) === "82"
      && String(row.hp) === "112" && row.vehicleYears === "06/06-12/15") return "I";
  // Volvo's V50 2003–2012 model line maps to local generation I.
  // Bound to the literal MANN model period, not all bare model names.
  // https://www.volvocars.com/intl/media/press-releases/9DDB78D308D773EB/
  // https://www.mann-filter.com/au-en/catalog/search-results/product.suffix.html/c16134/2_mann-filter.html
  if (row.make === "VOLVO CARS" && row.model === "V50" && row.modelYears === "04-12") {
    const years = row.vehicleYears?.match(/^(0[1-9]|1[0-2])\/(\d{2})-(0[1-9]|1[0-2])\/(\d{2})$/);
    if (!row.vehicleYears || (years && Number(years[2]) >= 3 && Number(years[4]) <= 12
      && Number(`${years[2]}${years[1]}`) <= Number(`${years[4]}${years[3]}`))) return "I";
    return undefined;
  }
  if (row.make !== "VOLVO CARS" || row.model !== "XC60" || row.modelYears !== "08 ->") return undefined;
  const engine = (row.engineCode ?? "").replace(/\s+/g, "").toUpperCase();
  const key = `${engine}|${row.kw ?? ""}|${row.hp ?? ""}|${row.vehicleYears ?? ""}`;
  return XC60_FIRST_GENERATION_APPLICATIONS.has(key) ? "I" : undefined;
}
