// An entered inventory price may reconstruct an unknown cost, but must never
// replace a known warehouse average when valuing a shortage or existing stock.
export function resolveInventoryAverageCost(
  warehouseCost: number | null | undefined,
  lineCost: number | null | undefined,
  enteredCost: number | null | undefined,
) {
  if (warehouseCost != null && warehouseCost > 0) return warehouseCost;
  if (lineCost != null && lineCost > 0 && enteredCost === lineCost) return lineCost;
  return warehouseCost;
}
