const FLUID_STOP_WORDS = new Set([
  "genuine",
  "original",
  "originale",
  "fluid",
  "oil",
  "oem",
  "жидкость",
  "масло",
  "оригинал",
  "оригинальное",
  "оригинальная",
]);

export type LocalFluidCandidate = {
  id: string;
  name: string;
  salePriceCents: number;
  uomName: string | null;
  packageVolume: string | null;
  markingMode: string | null;
  atf: string | null;
  oemAtf: string | null;
  searchText: string | null;
  availableUnits: number;
};

export type LocalFluidSelection = {
  productId: string;
  productName: string;
  quantity: number;
  availableUnits: number;
  packageLiters: number;
  totalCents: number;
  compatibilityEvidence: string;
};

function normalizedWords(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[ёЁ]/g, "е")
    .toLocaleLowerCase("ru-RU")
    .replace(/cvtf/giu, "cvt")
    .replace(/[^\p{L}\p{N}.]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export function fluidSpecificationTokens(value: string) {
  return normalizedWords(value).filter((word) => !FLUID_STOP_WORDS.has(word));
}

export function normalizeFluidSpecification(value: string) {
  return fluidSpecificationTokens(value).join(" ");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function fluidSpecificationMatchIndex(source: string, requiredSpec: string) {
  const tokens = fluidSpecificationTokens(requiredSpec);
  if (tokens.length < 2) return -1;
  const pattern = tokens
    .map((token) => token === "cvt" ? "cvtf?" : escapeRegExp(token))
    .join("[^\\p{L}\\p{N}]{0,32}");
  return new RegExp(pattern, "iu").exec(source)?.index ?? -1;
}

export function fluidSpecificationExcerpt(sourceValue: string, requiredSpec: string, max = 360) {
  const source = String(sourceValue ?? "").trim();
  if (!source) return null;
  const foundAt = fluidSpecificationMatchIndex(source, requiredSpec);
  if (foundAt < 0) return null;
  const start = Math.max(0, foundAt - Math.floor(max / 3));
  const end = Math.min(source.length, start + max);
  return `${start > 0 ? "…" : ""}${source.slice(start, end)}${end < source.length ? "…" : ""}`;
}

function specificationCodes(value: string) {
  return [...value.matchAll(/\b\d{3}(?:\.\d{1,3})+\b/g)].map((match) => match[0]);
}

function technicalText(candidate: Pick<LocalFluidCandidate, "atf" | "oemAtf" | "searchText">) {
  return [candidate.atf, candidate.oemAtf, candidate.searchText].filter(Boolean).join("\n");
}

export function fluidSpecificationMatches(candidate: Pick<LocalFluidCandidate, "atf" | "oemAtf" | "searchText">, requiredSpec: string) {
  const source = technicalText(candidate);
  const normalizedRequired = normalizeFluidSpecification(requiredSpec);
  const normalizedSource = normalizeFluidSpecification(source);
  if (!normalizedRequired || !normalizedSource) return false;
  if (normalizedSource.includes(normalizedRequired)) return true;

  const codes = specificationCodes(requiredSpec);
  if (!codes.length || !codes.every((code) => source.toLocaleLowerCase("ru-RU").includes(code.toLocaleLowerCase("ru-RU")))) return false;
  const nonNumericTokens = fluidSpecificationTokens(requiredSpec).filter((token) => /\p{L}/u.test(token));
  return nonNumericTokens.length === 0 || nonNumericTokens.every((token) => normalizedSource.includes(token));
}

function localizedNumber(value: string) {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function packageVolumeLiters(candidate: Pick<LocalFluidCandidate, "uomName" | "packageVolume" | "markingMode">) {
  const uom = String(candidate.uomName ?? "").trim().toLocaleLowerCase("ru-RU");
  if (candidate.markingMode === "BULK_OIL_FROM_MARKED_BARREL" || /^(?:л|литр(?:а|ов)?|l|liter|litre)$/iu.test(uom)) return 1;
  const source = String(candidate.packageVolume ?? "");
  const match = source.match(/(\d+(?:[.,]\d+)?)\s*(?:л|l|liter|litre)(?=\s|$|[,;/)])/iu);
  return match ? localizedNumber(match[1]) ?? 1 : 1;
}

function quantityForLiters(candidate: LocalFluidCandidate, requiredLiters: number) {
  const litersPerUnit = packageVolumeLiters(candidate);
  const isLiterUnit = litersPerUnit === 1 && (
    candidate.markingMode === "BULK_OIL_FROM_MARKED_BARREL" ||
    /^(?:л|литр(?:а|ов)?|l|liter|litre)$/iu.test(String(candidate.uomName ?? "").trim())
  );
  return {
    litersPerUnit,
    quantity: isLiterUnit ? Math.round(requiredLiters * 1000) / 1000 : Math.ceil(requiredLiters / litersPerUnit),
  };
}

function evidenceFor(candidate: LocalFluidCandidate, requiredSpec: string) {
  const source = technicalText(candidate);
  const exactExcerpt = fluidSpecificationExcerpt(source, requiredSpec, 240);
  if (exactExcerpt) return exactExcerpt;
  const tokens = fluidSpecificationTokens(requiredSpec);
  const normalizedSource = normalizeFluidSpecification(source);
  const normalizedNeedle = tokens.join(" ");
  const normalizedIndex = normalizedSource.indexOf(normalizedNeedle);
  if (normalizedIndex < 0) return requiredSpec;
  const words = normalizedSource.split(" ");
  const before = normalizedSource.slice(0, normalizedIndex).split(" ").length - 1;
  return words.slice(Math.max(0, before - 3), Math.min(words.length, before + tokens.length + 4)).join(" ");
}

export function selectPreferredLocalFluid(candidates: LocalFluidCandidate[], requiredSpec: string, requiredLiters: number): LocalFluidSelection | null {
  if (!Number.isFinite(requiredLiters) || requiredLiters <= 0 || !normalizeFluidSpecification(requiredSpec)) return null;
  const eligible = candidates.flatMap((candidate) => {
    if (candidate.salePriceCents <= 0 || candidate.availableUnits <= 0 || !fluidSpecificationMatches(candidate, requiredSpec)) return [];
    const { litersPerUnit, quantity } = quantityForLiters(candidate, requiredLiters);
    if (quantity <= 0 || candidate.availableUnits + 0.0001 < quantity) return [];
    return [{ candidate, litersPerUnit, quantity, totalCents: Math.round(candidate.salePriceCents * quantity) }];
  });
  eligible.sort((left, right) => left.totalCents - right.totalCents || right.candidate.availableUnits - left.candidate.availableUnits || left.candidate.name.localeCompare(right.candidate.name, "ru"));
  const selected = eligible[0];
  if (!selected) return null;
  return {
    productId: selected.candidate.id,
    productName: selected.candidate.name,
    quantity: selected.quantity,
    availableUnits: selected.candidate.availableUnits,
    packageLiters: selected.litersPerUnit,
    totalCents: selected.totalCents,
    compatibilityEvidence: evidenceFor(selected.candidate, requiredSpec),
  };
}
