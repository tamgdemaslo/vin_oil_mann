export const AQSI_MARKING_TYPE_AUTO_FLUIDS = 34;
export const AQSI_PAYMENT_SUBJECT_MARKED_WITHOUT_CODE = 32;
export const AQSI_PAYMENT_SUBJECT_MARKED = 33;
export const AQSI_UNIT_CODE_PIECE = 0;
export const AQSI_UNIT_CODE_LITER = 41;
export const GS = "\u001d";

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function isLikelyFilterOrHardware(name: string): boolean {
  const lower = normalizeName(name);
  return (
    /\bфильтр\b|\bfilter\b/i.test(lower) ||
    /маслян(ый|ого|ом)?\s+фильтр|фильтр\s+маслян/i.test(lower) ||
    /уплотнител|сливн\w*\s+пробк|пробк\w*\s+сливн|кольцо\s+сливн|прокладк|хомут|шайб|болт\s|гайк\s|поддон(\s|$)|пробка(\s|$)/i.test(lower)
  );
}

export function isLikelyMarkedMotorOilProductName(name: string): boolean {
  const lower = normalizeName(name);
  if (!lower || isLikelyFilterOrHardware(lower)) return false;
  return /моторное\s+масло|масло\s+моторное|трансмиссионн\w*\s+масл|масл\w*\s+трансмиссионн|трансмиссионн\w*\s+жидк|engine\s+oil|transmission\s+(oil|fluid)|gear\s+oil|auto\s*fluids?|atf|cvt|dct|dsg|dexron|mercon|gl-?\s*[45]|5w|0w|10w|15w|20w|sae|dexos|longlife|gf-|acea|api\s+[a-z]{1,2}/i.test(
    lower
  );
}

export function isLikelyMeasuredMotorOilPourProductName(name: string): boolean {
  const lower = normalizeName(name);
  if (!isLikelyMarkedMotorOilProductName(lower)) return false;
  return /розлив|разлив|бочк|налив|bulk/i.test(lower);
}

export function isMeasuredMotorOilQuantity(name: string, quantity: number): boolean {
  if (!isLikelyMarkedMotorOilProductName(name)) return false;
  if (isLikelyMeasuredMotorOilPourProductName(name)) return true;
  return Number.isFinite(quantity) && quantity > 0 && !Number.isInteger(quantity);
}

export function requiredMarkingCodeCount(
  quantity: number,
  options?: { measuredPour?: boolean }
): number {
  if (options?.measuredPour) return 1;
  if (!Number.isFinite(quantity) || quantity <= 0) return 1;
  if (Number.isInteger(quantity) && quantity > 1) return quantity;
  return 1;
}

function restoreMotorOilSeparators(value: string): string {
  if (value.includes(GS)) return value;

  const long = value.match(/^(01\d{14}21.{13})91(.{4})92(.{44})$/u);
  if (long) return `${long[1]}${GS}91${long[2]}${GS}92${long[3]}`;

  const short = value.match(/^(01\d{14}21.{13})93(.{4})$/u);
  if (short) return `${short[1]}${GS}93${short[2]}`;

  return value;
}

export function normalizeMarkingCodeInput(value: string): string {
  const normalized = value
    .trim()
    .replace(/^\]d2/i, "")
    .replace(/\u00e8/g, "")
    .replace(/\\u001d|\\x1d|\[gs\]|\(gs\)|\{gs\}|<gs>|<fnc1>|\[fnc1\]/gi, GS)
    .replace(/␝/g, GS)
    .replace(/[\u001e\u001f]/g, GS)
    .replace(/[ \t\r\n]+/g, "");

  return restoreMotorOilSeparators(normalized);
}

export function isRecognizedMotorOilMarkingCode(value: string): boolean {
  const normalized = normalizeMarkingCodeInput(value);
  return (
    /^01\d{14}21.{13}\u001d91.{4}\u001d92.{44}$/u.test(normalized) ||
    /^01\d{14}21.{13}\u001d93.{4}$/u.test(normalized)
  );
}

export function parseMarkingCodesInput(value: string): string[] {
  const lines = value
    .split(/\r?\n/g)
    .map((line) => normalizeMarkingCodeInput(line))
    .filter(Boolean);

  if (lines.length <= 1) return lines;
  if (lines.every(isRecognizedMotorOilMarkingCode)) return lines;

  const joined = normalizeMarkingCodeInput(value);
  if (isRecognizedMotorOilMarkingCode(joined)) return [joined];

  return lines;
}
