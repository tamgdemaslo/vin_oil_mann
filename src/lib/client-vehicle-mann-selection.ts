import { normalizeVehicleMake } from "./vehicle-normalization";

export function nextVehicleMannSelection(previous: string[], incoming: string[] | undefined, identityChanged: boolean) {
  // Omitted selection preserves a stable car; [] explicitly clears it.
  // A new selection is a replacement, never a history of previous selections.
  return [...new Set(incoming === undefined ? (identityChanged ? [] : previous) : incoming)];
}

export function mannSelectionMatchesMake(make: unknown, keys: string[], rows: { vehicleVariantKey: string; make: string }[]) {
  const canonical = normalizeVehicleMake(make);
  return keys.every(key => {
    const matches = rows.filter(row => row.vehicleVariantKey === key);
    return matches.length > 0 && matches.every(row => !canonical || normalizeVehicleMake(row.make) === canonical);
  });
}
