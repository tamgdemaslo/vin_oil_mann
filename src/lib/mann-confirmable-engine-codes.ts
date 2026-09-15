import { splitMannEngineCodeList } from "@/lib/mann-engine-code-list";
import { normalizeEngineCode } from "@/lib/vehicle-normalization";

/** Whole catalogue code lists, not free-text engine descriptions. */
export function mannConfirmableEngineCodes(value: string | null | undefined): string[] {
  const raw = (value ?? "").trim().toUpperCase();
  if (!raw || !/^[A-Z0-9 .,/;|\-]+$/.test(raw)) return [];
  const parts = splitMannEngineCodeList(raw).map(part => part.trim());
  // Do not allow the legacy list parser's annotation stripping to create proof.
  if (/\b(?:AND|ALWAYS|UND|IMMER|FOR|OUR|COMPLETE)\b/.test(raw)) return [];
  if (/\b(?:DOHC|SOHC|MPI|GDI|TDI|TSI|FSI)\b/.test(raw)) return [];
  if (parts.length > 20 || parts.some(part => !part)) return [];
  const codes = parts.map(normalizeEngineCode);
  if (codes.some((code, index) => !code || /^\d\.\d+[A-Z]*$/.test(code) || /^(?:ALL|NONE|DOHC|SOHC|AWD|FWD|RWD|2WD|4WD|4X4|4X2)$/.test(code)
    || !(/^[A-Z]{2,4}$/.test(code) || (/^[A-Z]{1,4}(?:-[A-Z]{1,4})+$/.test(parts[index]) && code.length <= 20)
      || (/^[A-Z0-9]+(?:\.[A-Z0-9]+)*$/.test(code) && /[A-Z]/.test(code) && /\d/.test(code) && code.length <= 20)))) return [];
  return [...new Set(codes as string[])];
}
