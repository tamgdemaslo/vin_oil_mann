/** Literal manufacturer row evidence, not a model alias or fluid approval.
 * Keep the original catalogue heading; it may disagree with the specific row.
 * Every identity field must match before row evidence overrides heading parsing.
 */
const ENTRIES = [{
  row: {
    vehicleVariantKey: "88347e623939d1ed13e25bdab4ef33af9126f5fc910576d3e7107fe6faf24864",
    make: "HYUNDAI",
    model: "Elantra II / Elantra TAGAZ (XD2)",
    vehicleText: "2.0 16V DOHC (HD)",
    effectiveVehicleText: "2.0 16V DOHC (HD)",
    engineCode: "G4GC", kw: "105", hp: "143",
    vehicleYears: "10/06-05/11", vehicleYearFrom: 2006, vehicleYearTo: 2011,
    condition: null,
  },
  bodyCodes: ["HD"],
  engineVolumeCc: 1975,
  evidence: {
    url: "https://www.mann-filter.com/ph-en/catalog/search-results/product.html/c2029_mann-filter.html",
    htmlSha256: "5d5d61f34c56cf94cf61710b0d868a9adbc699be785e70066631a5217433db83",
    manufacturerTypeId: "00000000219218",
    auditSha256: "d037880f479a5d115cb6b32809b936a12eed20a7722c292f28337b32a590f80f",
  },
}] as const;

type EvidenceRow = { [K in keyof typeof ENTRIES[number]["row"]]: string | number | null };

export function mannRowIdentityEvidence(row: EvidenceRow) {
  return ENTRIES.find(entry => Object.entries(entry.row).every(
    ([field, value]) => row[field as keyof EvidenceRow] === value,
  ));
}
