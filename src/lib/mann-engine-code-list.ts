/** Expand explicit compressed lists, never treat their suffix as an engine. */
export function splitMannEngineCodeList(value?: string | null): string[] {
  return String(value ?? "").split(/[;,|]+/).flatMap(segment => {
    const cleaned = segment.trim();
    const compressed = cleaned.match(/^((?:OM|M)\d{3}\.)\s*(\d{3}(?:\s*\/\s*\d{3})+)$/);
    if (compressed) return compressed[2].split(/\s*\/\s*/).map(suffix => compressed[1] + suffix);
    // The catalogue writes AZ variants as e.g. 1AZ-FE/FSE. Both suffixes
    // belong to the same explicit prefix; FSE alone is not a full code.
    const az = cleaned.match(/^([12]AZ-)\s*(FE\s*\/\s*FSE)$/);
    if (az) return az[2].split(/\s*\/\s*/).map(suffix => az[1] + suffix);
    return cleaned.split(/\/+/).map(part => part.replace(/\b(?:AND ALWAYS|UND IMMER|FOR OUR COMPLETE).*$/i, ""));
  });
}
