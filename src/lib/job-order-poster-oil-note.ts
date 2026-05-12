/**
 * Подпись в бортжурнале — по возможности только моторное масло (или явные признаки жидкости),
 * не фильтры, не «масляный фильтр», не уплотнения/пробки (раньше «liqu» цепляло «уплотнительное»).
 */

export type RawProductRow = {
  assortment?: { name?: string; meta?: { type?: string; href?: string } };
};

function assortmentKind(pos: RawProductRow): "service" | "product" {
  const t = pos.assortment?.meta?.type;
  if (t === "service") return "service";
  if (t === "product") return "product";
  const href = pos.assortment?.meta?.href ?? "";
  if (/\/entity\/service\//i.test(href)) return "service";
  if (/\/entity\/product\//i.test(href)) return "product";
  return "product";
}

/** Фильтры — не жидкое масло. */
export function isLikelyFilterOrNonFluidOilProduct(name: string): boolean {
  const lower = name.toLowerCase();
  if (/\bфильтр\b|\bfilter\b/i.test(lower)) return true;
  if (/маслян(ый|ого|ом)?\s+фильтр|фильтр\s+маслян/i.test(lower)) return true;
  if (/воздушн(ый|ого)?\s+фильтр|салонн(ый|ого)?\s+фильтр|топливн(ый|ого)?\s+фильтр/i.test(lower))
    return true;
  return false;
}

/** Пробки, кольца, прокладки и т.п. — не строка про масло. */
function isLikelySealOrHardwarePart(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    /уплотнител|уплотнительн|сливн\w*\s+пробк|пробк\w*\s+сливн|кольцо\s+сливн|прокладк|хомут|шайб|болт\s|гайк\s|поддон(\s|$)|пробка(\s|$)/i.test(
      lower
    ) || /\(п\d+\)/i.test(lower)
  );
}

/** Явное «моторное масло» в названии номенклатуры. */
const MOTOR_OIL_PHRASE = /моторное\s+масло|масло\s+моторное|engine\s+oil/i;

/**
 * Жидкость / масло по признакам (без голого «liqu» — совпадало с «уплотнительное»).
 */
const MOTOR_FLUID_HINT =
  /моторное\s+масло|масло\s+моторное|engine\s+oil|5w|0w|10w|15w|20w|castrol|mobil|shell|motul|\btotal\b|liquimoly|liqu\s*moly|esp|dexos|syn|energy|литр|вязк|sae|gf-|longlife|turbo|diesel|бочк|канистр|quartz|ineo|helix|neo/i;

function pickFromNames(names: string[]): string {
  if (names.length === 0) return "";

  const byPhrase = names.filter((n) => MOTOR_OIL_PHRASE.test(n));
  if (byPhrase.length > 0) return byPhrase[0]!;

  const eligible = names.filter(
    (n) => !isLikelyFilterOrNonFluidOilProduct(n) && !isLikelySealOrHardwarePart(n)
  );
  const oilHits = eligible.filter((n) => MOTOR_FLUID_HINT.test(n));
  if (oilHits.length > 0) return oilHits[0]!;

  return "";
}

export function pickJournalOilNoteFromRawRows(rows: RawProductRow[]): string {
  const products = rows.filter((r) => assortmentKind(r) === "product");
  const names = products.map((r) => (r.assortment?.name ?? "").trim()).filter(Boolean);
  return pickFromNames(names);
}

export function pickJournalOilNoteFromSyncedPositions(
  positions: { name: string; assortmentType: string }[]
): string | null {
  const products = positions.filter((p) => p.assortmentType === "product");
  const names = products.map((p) => p.name.trim()).filter(Boolean);
  const v = pickFromNames(names);
  return v || null;
}
