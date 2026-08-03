export type ConfidenceLevel = "HIGH" | "MEDIUM" | "LOW";

export type VehicleRequestGoal =
  | "rough_quote"
  | "service_booking"
  | "oil_selection"
  | "filter_selection"
  | "general";

export type VehicleResolutionInput = {
  make: string;
  model: string;
  year: number | null;
  engine: string | null;
  power: string | null;
  transmission: string | null;
  drive: string | null;
  requestGoal: VehicleRequestGoal;
};

export type CatalogApplicationRow = {
  variantId: string;
  make: string;
  model: string;
  detail: string | null;
  vehicleText: string | null;
  effectiveVehicleText: string | null;
  engineCode: string | null;
  kw: string | null;
  hp: string | null;
  vehicleYears: string | null;
  vehicleYearFrom: number | null;
  vehicleYearTo: number | null;
  condition: string | null;
  filterType: string;
  filterSubtype: string | null;
  mannArticle: string;
  filterNote: string | null;
  sourceFile: string | null;
  catalogPage: number | null;
};

export type VehiclePart = {
  type: string;
  subtype: string | null;
  mannArticle: string;
  note: string | null;
};

export type VehicleVariant = {
  variantId: string;
  make: string;
  model: string;
  description: string;
  engineCode: string | null;
  kw: string | null;
  hp: string | null;
  vehicleYears: string | null;
  yearFrom: number | null;
  yearTo: number | null;
  condition: string | null;
  parts: VehiclePart[];
  source: { name: string; file: string | null; catalogPage: number | null };
};

export type VehicleResolution = {
  found: boolean;
  exact: boolean;
  ambiguous: boolean;
  variants: VehicleVariant[];
  commonParts: VehiclePart[];
  differences: Array<{ field: string; values: string[] }>;
  componentConfidence: {
    vehicleConfidence: ConfidenceLevel;
    oilSpecificationConfidence: ConfidenceLevel;
    oilVolumeConfidence: ConfidenceLevel;
    oilFilterConfidence: ConfidenceLevel;
    partsFitmentConfidence: ConfidenceLevel;
  };
  recommendedAction:
    | "continue"
    | "clarify"
    | "preliminary_quote_and_clarify"
    | "book_with_verification_note"
    | "request_more_parameters_or_handoff";
  clarifyingQuestion: string | null;
  preliminaryAllowed: boolean;
  verificationNoteRequired: boolean;
  canContinueWithoutVin: boolean;
  alternativeFields: string[];
  vinPolicy: {
    parameterSearchCompleted: true;
    required: false;
    askNow: false;
    onlyAfterAlternativesFail: true;
  };
  needsHumanReview: boolean;
};

export function didClientRefuseVin(text: string): boolean {
  return (
    /(?:нет|не\s+знаю|не\s+дам|без|не\s+хочу|не\s+могу)[^.!?\n]{0,35}(?:vin|вин)|(?:vin|вин)[^.!?\n]{0,35}(?:нет|не\s+знаю|не\s+дам|не\s+хочу|не\s+могу)/i.test(text) ||
    /(?:там\s+)?только\s+один\s+(?:мотор|двигатель)|(?:модификация|версия)\s+одна/i.test(text)
  );
}

function compact(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalize(value: unknown): string {
  return compact(value)
    .toUpperCase()
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/[^\p{L}\p{N}.]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function unique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map(compact).filter(Boolean))];
}

function partKey(part: VehiclePart): string {
  return [normalize(part.type), normalize(part.subtype), normalize(part.mannArticle)].join("|");
}

function partSignature(parts: VehiclePart[], type?: string): string {
  return parts
    .filter((part) => !type || normalize(part.type) === normalize(type))
    .map(partKey)
    .sort()
    .join(";");
}

function candidateText(variant: VehicleVariant): string {
  return normalize([
    variant.make,
    variant.model,
    variant.description,
    variant.engineCode,
    variant.kw,
    variant.hp,
    variant.condition,
  ].join(" "));
}

function matchesText(value: string | null, variant: VehicleVariant): boolean {
  const needle = normalize(value);
  return !needle || candidateText(variant).includes(needle);
}

function numbers(value: unknown): number[] {
  return (compact(value).match(/\d+(?:[.,]\d+)?/g) ?? [])
    .map((item) => Number(item.replace(",", ".")))
    .filter(Number.isFinite);
}

function matchesPower(value: string | null, variant: VehicleVariant): boolean {
  const requested = numbers(value);
  if (!requested.length) return true;
  const isKw = /квт|kw/i.test(value ?? "");
  const isHp = /л\.?\s*с\.?|hp|ps/i.test(value ?? "");
  const candidates = isKw ? numbers(variant.kw) : isHp ? numbers(variant.hp) : [...numbers(variant.hp), ...numbers(variant.kw)];
  return requested.some((target) => candidates.some((candidate) => Math.abs(candidate - target) <= 1));
}

export function groupCatalogApplications(rows: CatalogApplicationRow[]): VehicleVariant[] {
  const groups = new Map<string, CatalogApplicationRow[]>();
  for (const row of rows) {
    const list = groups.get(row.variantId) ?? [];
    list.push(row);
    groups.set(row.variantId, list);
  }

  return [...groups.entries()].map(([variantId, items]) => {
    const first = items[0];
    const parts = new Map<string, VehiclePart>();
    for (const item of items) {
      const part: VehiclePart = {
        type: item.filterType,
        subtype: item.filterSubtype,
        mannArticle: item.mannArticle,
        note: item.filterNote,
      };
      if (!parts.has(partKey(part))) parts.set(partKey(part), part);
    }
    return {
      variantId,
      make: first.make,
      model: first.model,
      description: compact(first.effectiveVehicleText || first.vehicleText || first.detail || first.model),
      engineCode: first.engineCode,
      kw: first.kw,
      hp: first.hp,
      vehicleYears: first.vehicleYears,
      yearFrom: first.vehicleYearFrom,
      yearTo: first.vehicleYearTo,
      condition: first.condition,
      parts: [...parts.values()].sort((a, b) => partKey(a).localeCompare(partKey(b))),
      source: {
        name: "Локальная база применяемости MANN",
        file: first.sourceFile,
        catalogPage: first.catalogPage,
      },
    };
  });
}

function relevantVariants(input: VehicleResolutionInput, variants: VehicleVariant[]): VehicleVariant[] {
  let selected = variants;
  if (input.engine) {
    const matching = selected.filter((variant) => matchesText(input.engine, variant));
    if (matching.length) selected = matching;
  }
  if (input.power) {
    const matching = selected.filter((variant) => matchesPower(input.power, variant));
    if (matching.length) selected = matching;
  }
  if (input.transmission) {
    const matching = selected.filter((variant) => matchesText(input.transmission, variant));
    if (matching.length) selected = matching;
  }
  if (input.drive) {
    const matching = selected.filter((variant) => matchesText(input.drive, variant));
    if (matching.length) selected = matching;
  }
  return selected.slice(0, 12);
}

function commonParts(variants: VehicleVariant[]): VehiclePart[] {
  if (!variants.length) return [];
  const commonKeys = new Set(variants[0].parts.map(partKey));
  for (const variant of variants.slice(1)) {
    const keys = new Set(variant.parts.map(partKey));
    for (const key of commonKeys) if (!keys.has(key)) commonKeys.delete(key);
  }
  return variants[0].parts.filter((part) => commonKeys.has(partKey(part)));
}

function difference(field: string, values: Array<string | null | undefined>) {
  const distinct = unique(values);
  return distinct.length > 1 ? { field, values: distinct } : null;
}

function optionLabel(variant: VehicleVariant): string {
  const pieces = [variant.description];
  if (variant.hp && !normalize(variant.description).includes(normalize(variant.hp))) pieces.push(`${variant.hp} л.с.`);
  if (variant.engineCode && !normalize(variant.description).includes(normalize(variant.engineCode))) pieces.push(`двигатель ${variant.engineCode}`);
  return unique(pieces).join(", ");
}

function clarifyingQuestion(variants: VehicleVariant[], differences: VehicleResolution["differences"]): string | null {
  if (variants.length < 2) return null;
  if (variants.length <= 3) {
    return `Каталог нашёл различия: ${variants.map((variant) => `«${optionLabel(variant)}»`).join(" или ")}. Какой вариант у вас?`;
  }
  const power = differences.find((item) => item.field === "power");
  if (power) return `Уточните мощность двигателя: ${power.values.join(", ")} л.с.?`;
  const engineCode = differences.find((item) => item.field === "engineCode");
  if (engineCode) return `Уточните код двигателя: ${engineCode.values.join(", ")}?`;
  return "Уточните тип топлива и мощность двигателя — по ним каталог разделяет найденные модификации.";
}

export function resolveVehicleVariants(input: VehicleResolutionInput, allVariants: VehicleVariant[]): VehicleResolution {
  const variants = relevantVariants(input, allVariants);
  const found = variants.length > 0;
  const sharedParts = commonParts(variants);
  const fullPartSignatures = unique(variants.map((variant) => partSignature(variant.parts)));
  const oilFilterSignatures = unique(variants.map((variant) => partSignature(variant.parts, "oil")));
  const engineCodes = unique(variants.map((variant) => variant.engineCode));
  const descriptions = unique(variants.map((variant) => variant.description));
  const powers = unique(variants.map((variant) => variant.hp));
  const allPartsSame = fullPartSignatures.length === 1 && Boolean(fullPartSignatures[0]);
  const oilFiltersSame = oilFilterSignatures.length === 1 && Boolean(oilFilterSignatures[0]);
  const engineMateriallyDifferent = engineCodes.length > 1 || powers.length > 1 || (descriptions.length > 1 && !allPartsSame);
  const exact = variants.length === 1 && Boolean(input.engine || input.power);

  const differences = [
    difference("modification", variants.map((variant) => variant.description)),
    difference("engineCode", variants.map((variant) => variant.engineCode)),
    difference("power", variants.map((variant) => variant.hp)),
    difference(
      "oilFilter",
      variants.map((variant) => variant.parts.filter((part) => normalize(part.type) === "OIL").map((part) => part.mannArticle).sort().join(", "))
    ),
  ].filter((item): item is { field: string; values: string[] } => Boolean(item));

  const vehicleConfidence: ConfidenceLevel = !found
    ? "LOW"
    : exact || (variants.length > 1 && allPartsSame && !engineMateriallyDifferent)
      ? "HIGH"
      : variants.length === 1 || !engineMateriallyDifferent
        ? "MEDIUM"
        : "LOW";
  const oilSpecificationConfidence: ConfidenceLevel = !found || engineMateriallyDifferent ? "LOW" : "MEDIUM";
  const oilVolumeConfidence: ConfidenceLevel = oilSpecificationConfidence;
  const oilFilterConfidence: ConfidenceLevel = !found || !oilFilterSignatures.some(Boolean) ? "LOW" : oilFiltersSame ? "HIGH" : "LOW";
  const partsFitmentConfidence: ConfidenceLevel = !found ? "LOW" : allPartsSame ? "HIGH" : sharedParts.length ? "MEDIUM" : "LOW";

  let recommendedAction: VehicleResolution["recommendedAction"] = "continue";
  let needsClarification = false;
  let preliminaryAllowed = false;
  let verificationNoteRequired = false;
  if (!found) {
    recommendedAction = "request_more_parameters_or_handoff";
  } else if (input.requestGoal === "rough_quote" && engineMateriallyDifferent) {
    recommendedAction = "preliminary_quote_and_clarify";
    needsClarification = true;
    preliminaryAllowed = true;
  } else if (input.requestGoal === "service_booking" && variants.length > 1) {
    recommendedAction = "book_with_verification_note";
    verificationNoteRequired = true;
  } else if (input.requestGoal === "filter_selection" && oilFilterConfidence !== "HIGH") {
    recommendedAction = "clarify";
    needsClarification = true;
  } else if (input.requestGoal === "oil_selection" && engineMateriallyDifferent) {
    recommendedAction = "clarify";
    needsClarification = true;
  } else if (input.requestGoal === "general" && engineMateriallyDifferent && !allPartsSame) {
    recommendedAction = "clarify";
    needsClarification = true;
  }

  return {
    found,
    exact,
    ambiguous: variants.length > 1 && engineMateriallyDifferent,
    variants,
    commonParts: sharedParts,
    differences,
    componentConfidence: {
      vehicleConfidence,
      oilSpecificationConfidence,
      oilVolumeConfidence,
      oilFilterConfidence,
      partsFitmentConfidence,
    },
    recommendedAction,
    clarifyingQuestion: needsClarification ? clarifyingQuestion(variants, differences) : null,
    preliminaryAllowed,
    verificationNoteRequired,
    canContinueWithoutVin: found,
    alternativeFields: found
      ? ["мощность двигателя", "код двигателя", "тип топлива", "коробка передач", "привод"]
      : ["точное название модели", "год выпуска", "объём или код двигателя", "мощность двигателя"],
    vinPolicy: {
      parameterSearchCompleted: true,
      required: false,
      askNow: false,
      onlyAfterAlternativesFail: true,
    },
    needsHumanReview: !found || (input.requestGoal === "filter_selection" && oilFilterConfidence === "LOW"),
  };
}
