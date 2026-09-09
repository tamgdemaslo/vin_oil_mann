/** Older orders may store the full vehicle summary in the model attribute. */
export function cleanJobOrderVehicleName(value: string, vin: string, plate: string): string {
  let name = value;
  for (const identifier of [vin, plate]) {
    const compact = identifier.replace(/[\s-]/g, "");
    if (!compact || compact === "—") continue;
    const pattern = Array.from(compact, (char) =>
      char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    ).join("[\\s-]*");
    name = name.replace(new RegExp(`(?<![\\p{L}\\p{N}])${pattern}(?![\\p{L}\\p{N}])`, "giu"), "");
  }
  return name
    .replace(/(?:^|[\s·•,;|])(?:VIN|ВИН|гос\.?\s*номер|гос\.?\s*знак)\s*[:№]?\s*(?=$|[·•,;|])/giu, " ")
    .replace(/\s*[·•,;|]\s*(?=$|[·•,;|])/g, " ")
    .replace(/^[\s·•,;|]+|[\s·•,;|]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
