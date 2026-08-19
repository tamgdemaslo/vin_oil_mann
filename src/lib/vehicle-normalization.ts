const MAKE_ALIASES: Record<string, string> = {
  "MERCEDES-BENZ": "MERCEDES",
  "MERCEDES BENZ": "MERCEDES",
  MERCEDES: "MERCEDES",
  "МЕРСЕДЕС-БЕНЦ": "MERCEDES",
  МЕРСЕДЕС: "MERCEDES",
  VOLKSWAGEN: "VOLKSWAGEN",
  VW: "VOLKSWAGEN",
  "VW (VOLKSWAGEN)": "VOLKSWAGEN",
  ФОЛЬКСВАГЕН: "VOLKSWAGEN",
  "KIA MOTORS": "KIA",
  КИА: "KIA",
  "MINI (BMW GROUP)": "MINI",
  LANDROVER: "LAND ROVER",
  "LAND ROVER": "LAND ROVER",
  "ЛЕНД РОВЕР": "LAND ROVER",
  "ЛАНД РОВЕР": "LAND ROVER",
  "SSANG YONG": "SSANGYONG",
  SSANGYONG: "SSANGYONG",
  ССАНГЙОНГ: "SSANGYONG",
  GREATWALL: "GREAT WALL",
  "GREAT WALL": "GREAT WALL",
  "ГРЕЙТ ВОЛЛ": "GREAT WALL",
  "VOLVO CARS": "VOLVO",
  VOLVO: "VOLVO",
  ВОЛЬВО: "VOLVO",
  "LADA (SHIGULI)": "LADA",
  LADA: "LADA",
  VAZ: "LADA",
  ЛАДА: "LADA",
  ВАЗ: "LADA",
  HYUNDAI: "HYUNDAI",
  HYUNDAE: "HYUNDAI",
  ХЕНДЭ: "HYUNDAI",
  ХЕНДАЙ: "HYUNDAI",
  ХУНДАЙ: "HYUNDAI",
  NISSAN: "NISSAN",
  НИССАН: "NISSAN",
  OPEL: "OPEL",
  ОПЕЛЬ: "OPEL",
  GEELY: "GEELY",
  ДЖИЛИ: "GEELY",
  TOYOTA: "TOYOTA",
  ТОЙОТА: "TOYOTA",
  SKODA: "SKODA",
  ШКОДА: "SKODA",
  RENAULT: "RENAULT",
  РЕНО: "RENAULT",
  PEUGEOT: "PEUGEOT",
  ПЕЖО: "PEUGEOT",
  CITROEN: "CITROEN",
  СИТРОЕН: "CITROEN",
  MITSUBISHI: "MITSUBISHI",
  МИЦУБИСИ: "MITSUBISHI",
  МИТСУБИСИ: "MITSUBISHI",
  HONDA: "HONDA",
  ХОНДА: "HONDA",
  MAZDA: "MAZDA",
  МАЗДА: "MAZDA",
  FORD: "FORD",
  ФОРД: "FORD",
  AUDI: "AUDI",
  АУДИ: "AUDI",
  BMW: "BMW",
  БМВ: "BMW",
  LEXUS: "LEXUS",
  ЛЕКСУС: "LEXUS",
  CHEVROLET: "CHEVROLET",
  ШЕВРОЛЕ: "CHEVROLET",
  SUBARU: "SUBARU",
  СУБАРУ: "SUBARU",
  SUZUKI: "SUZUKI",
  СУЗУКИ: "SUZUKI",
  PORSCHE: "PORSCHE",
  ПОРШЕ: "PORSCHE",
  HAVAL: "HAVAL",
  ХАВАЛ: "HAVAL",
  CHERY: "CHERY",
  ЧЕРИ: "CHERY",
};

const CYRILLIC_TRANSLITERATION: Record<string, string> = {
  А: "A", Б: "B", В: "V", Г: "G", Д: "D", Е: "E", Ё: "E", Ж: "ZH", З: "Z", И: "I", Й: "I",
  К: "K", Л: "L", М: "M", Н: "N", О: "O", П: "P", Р: "R", С: "S", Т: "T", У: "U", Ф: "F",
  Х: "KH", Ц: "TS", Ч: "CH", Ш: "SH", Щ: "SHCH", Ъ: "", Ы: "Y", Ь: "", Э: "E", Ю: "YU", Я: "YA",
};

function normalizedText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/Ё/g, "Е")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

export function transliterateVehicleText(value: unknown): string {
  return normalizedText(value).replace(/[А-ЯЁ]/g, (character) => CYRILLIC_TRANSLITERATION[character] ?? character);
}

export function normalizeVehicleMake(value: unknown): string | undefined {
  const normalized = normalizedText(value);
  if (!normalized) return undefined;
  return MAKE_ALIASES[normalized] ?? normalized;
}

export function vehicleMakeAliasEntries(): Array<[string, string]> {
  return Object.entries(MAKE_ALIASES).sort((left, right) => right[0].length - left[0].length);
}

export function splitCombinedVehicleDescription(value: unknown): { makeRaw?: string; makeCanonical?: string; modelRaw?: string } {
  const normalized = normalizedText(value);
  if (!normalized) return {};
  for (const [form, canonical] of vehicleMakeAliasEntries()) {
    if (normalized !== form && !normalized.startsWith(`${form} `)) continue;
    let modelRaw = normalized.slice(form.length).trim();
    // Registration data often appends a powertrain description to the model,
    // for example "OPEL VECTRA 1.8I 16V". A decimal displacement starts that
    // suffix; numeric model names such as BMW 3 or Discovery 3 are preserved.
    modelRaw = modelRaw.replace(/\s+\d+[.,]\d+.*$/u, "").trim();
    return { makeRaw: form, makeCanonical: canonical, modelRaw: modelRaw || undefined };
  }
  return {};
}

export function normalizeVehicleModel(value: unknown, make?: string): { raw?: string; canonical?: string; generation?: string; bodyCode?: string } {
  const raw = String(value ?? "").trim() || undefined;
  if (!raw) return {};
  let normalized = normalizedText(raw);
  const canonicalMake = normalizeVehicleMake(make);
  if (canonicalMake) {
    const makeForms = [...new Set([
      canonicalMake,
      ...vehicleMakeAliasEntries()
        .filter(([, canonical]) => canonical === canonicalMake)
        .map(([form]) => form),
    ])].sort((left, right) => right.length - left.length);
    const matchingForm = makeForms.find((form) => normalized === form || normalized.startsWith(`${form} `));
    if (matchingForm) normalized = normalized.slice(matchingForm.length).trim();
  }
  normalized = transliterateVehicleText(normalized);
  const codes = [...normalized.matchAll(/\b(?:[A-Z]\d{1,3}[A-Z]?|\d[A-Z]\d|[A-Z]{1,3}\d{1,3})\b/g)].map((match) => match[0]);
  // Some providers prepend an alphabetic platform code to the commercial model
  // (for example "XX MODEL") while catalogues put it in parentheses. Restrict
  // this fallback to a short leading token followed by a substantial model word.
  const leadingPlatformCode = normalized.match(/^([A-Z]{2,3})\s+[A-Z]{4,}(?:\s|$)/)?.[1];
  const generation = normalized.match(/(?:^|[\s(/,])(XV|XIV|XIII|XII|XI|X|IX|VIII|VII|VI|V|IV|III|II|I)(?=$|[\s(),/])/)?.[1];
  const canonical = normalized
    .replace(/\([^)]*\)/g, " ")
    .replace(/(^|[\s(/,])(?:XV|XIV|XIII|XII|XI|X|IX|VIII|VII|VI|V|IV|III|II|I)(?=$|[\s(),/])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return { raw, canonical: canonical || normalized, generation, bodyCode: codes[0] ?? leadingPlatformCode };
}

export function normalizeEngineCode(value: unknown): string | undefined {
  const normalized = transliterateVehicleText(value).replace(/[\s_-]/g, "");
  return normalized || undefined;
}
