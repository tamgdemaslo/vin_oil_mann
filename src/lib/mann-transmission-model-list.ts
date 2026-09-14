/** Explicit source alternatives only; never an installed-gearbox inference. */
export function explicitMannTransmissionModelYears(value: unknown): {model:string; yearFrom:number; yearTo:number} | null {
  if(typeof value!=='string')return null;
  const match=value.trim().match(/^([A-Z0-9][A-Z0-9-]{1,15})\s*\/\s*((?:19|20)\d{2})-((?:19|20)\d{2})$/i);
  if(!match)return null;
  const model=match[1].toUpperCase(),yearFrom=Number(match[2]),yearTo=Number(match[3]);
  if(!/[A-Z]/.test(model)||!/\d/.test(model)||/^\d+(?:AT|MT|DCT|DSG)$/.test(model)||yearFrom>yearTo)return null;
  return {model,yearFrom,yearTo};
}

export function explicitMannAlphanumericModels(value: unknown): string[] | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  // One or more source bullets, full-string grammar. Hyphens within a code
  // are not separators; parentheses, years, slash aliases and prose fail.
  const entry = '(?:(?:JATCO|AISIN|ZF)\\s+)?[A-Z0-9][A-Z0-9-]{1,15}';
  if (!new RegExp(`^[-—]\\s+${entry}(?:\\s+[-—]\\s+${entry})*$`, 'i').test(raw)) return null;
  const models = raw.split(/\s+[-—]\s+/).map(s => s.replace(/^[-—]\s+/, '').toUpperCase().replace(/\s+/g, ' '));
  if (models.some(s => !/[A-Z]/.test(s) || !/\d/.test(s) || /^\d+(?:AT|MT|DCT|DSG)$/.test(s))) return null;
  return new Set(models).size === models.length ? models : null;
}

export function explicitMannTransmissionModels(value: unknown): string[] | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!/^(?:[-—]\s+7\d{2}\.\d{3})(?:\s+[-—]\s+7\d{2}\.\d{3})+$/.test(raw)) return null;
  const models = raw.match(/7\d{2}\.\d{3}/g)!;
  return new Set(models).size === models.length ? models : null;
}

/** Literal CVT source choices, not an alias map between manufacturer names. */
export function explicitMannCvtModels(value: unknown): string[] | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  const entry = "(?:RE0F[0-9]{2}[A-Z]|JATCO\\s+JF[0-9]{3}[A-Z])";
  if (!new RegExp(`^(?:[-—]\\s+${entry})(?:\\s+[-—]\\s+${entry})+$`, "i").test(raw)) return null;
  const models = raw.split(/\s+[-—]\s+/).map(part => part.replace(/^[-—]\s+/, "").toUpperCase().replace(/\s+/g, " "));
  return new Set(models).size === models.length ? models : null;
}
