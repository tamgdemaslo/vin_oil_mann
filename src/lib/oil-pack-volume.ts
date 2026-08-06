/**
 * Объём фасовки из наименования товара, если не заполнено поле «Объём».
 * Избегаем ложных срабатываний на «30» из 5W-30 (перед цифрой не должно быть W-).
 */

export function parsePackVolumeLitersFromOilName(name: string): number | undefined {
  if (!name || typeof name !== "string") return undefined;
  const cleaned = name.replace(/\s+/g, " ").trim();
  const re = /(?:^|[\s,;])(\d+(?:[.,]\d+)?)\s*(?:л|l)(?:\s|[.,]|$)/gi;
  let m: RegExpExecArray | null;
  let lastGood: number | undefined;
  while ((m = re.exec(cleaned)) !== null) {
    const raw = m[1].replace(",", ".");
    const v = parseFloat(raw);
    if (!Number.isFinite(v) || v <= 0 || v > 60) continue;
    const idx = m.index ?? 0;
    const before = cleaned.slice(Math.max(0, idx - 6), idx);
    if (/w[-\s]?$/i.test(before)) continue;
    lastGood = v;
  }
  return lastGood;
}

/** Ведущий штрихкод/EAN в названии разводит одну линейку масла по разным группам в UI. */
export function stripLeadingNumericSkuFromName(name: string): string {
  return name
    .replace(/^\d{8,}\s*(?:[–—-]\s*[A-ZА-Я0-9]+)?\s*/iu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Базовое имя линейки масла без фасовки, штрихкода, артикульного префикса и служебных описаний. */
export function getOilLineBaseName(name: string, volumeLiters?: number): string {
  let base = stripLeadingNumericSkuFromName(name.replace(/\s+/g, " ").trim());

  if (typeof volumeLiters === "number" && Number.isFinite(volumeLiters) && volumeLiters > 0) {
    const volumeValue = Number.isInteger(volumeLiters) ? String(volumeLiters) : String(volumeLiters).replace(".", "[.,]");
    const volumeRe = new RegExp(`(^|[\\s,./()-])${volumeValue}\\s*(л|l|литр(?:а|ов)?|литра|литров|ml|мл)\\.?`, "i");
    base = base.replace(volumeRe, "");
  }

  base = base.replace(/(^|[\s,./()-])\d+(?:[.,]\d+)?\s*(л|l|литр(?:а|ов)?|литра|литров|ml|мл)\.?/gi, " ");
  base = base.replace(/\b(фасовк[а-я]*|объем|объ[её]м|pack|volume)\b[:\s-]*/gi, "");
  base = base.replace(/моторное\s+масло/gi, "");
  base = base.replace(/engine\s+oil/gi, "");
  base = base.replace(/\([^)]*\)/g, "");
  base = base.replace(/\b(\d{1,2})W[\s-]?(\d{2})\b/gi, (_m, w, hot) => `${w}W-${hot}`);

  base = base
    .replace(/[.,/]+/g, " ")
    .replace(/[,\s]+$/g, "")
    .replace(/[()]*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return base || name.trim();
}
