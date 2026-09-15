/** Recover an exact code only when the same phrase states its matching prefix.
 * Family-only labels such as M 113 E 50 must not acquire a guessed suffix.
 */
export function explicitMercedesSourceEngineCodes(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return [...value.toUpperCase().matchAll(/\b(\d{3}\.\d{3})\s*\((OM|M)\s+(\d{3})\b[^)]*\)/g)]
    .filter(match => match[1].slice(0, 3) === match[3])
    .map(match => `${match[2]}${match[1]}`);
}
