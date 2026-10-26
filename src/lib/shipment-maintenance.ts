/** Persisted in the existing position JSON; no separate basket or database schema. */
export type ShipmentMaintenanceSelection = {
  version: 1;
  key: string;
  label: string;
  source: "stock" | "rossko";
  referenceArticle?: string;
  offerId?: string;
  deliveryLabel?: string;
  selectedAt: string;
  specification?: string;
  viscosity?: string;
  volume?: string;
  vehicle?: { make: string; model: string; variantId: string; year?: string };
};
export function readShipmentMaintenance(value: unknown): ShipmentMaintenanceSelection | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  if (row.version !== 1 || typeof row.key !== "string" || !row.key || row.key.length > 200 || !["stock", "rossko"].includes(String(row.source))) return undefined;
  const text = (key: string, length = 2000) => typeof row[key] === "string" ? (row[key] as string).slice(0, length) : undefined;
  const vehicle = row.vehicle && typeof row.vehicle === "object" ? row.vehicle as Record<string, unknown> : null;
  return {version: 1, key: row.key, label: text("label", 200) ?? "Подбор ТО", source: row.source as "stock" | "rossko", referenceArticle: text("referenceArticle", 80), offerId: text("offerId", 300), deliveryLabel: text("deliveryLabel", 500), selectedAt: text("selectedAt", 80) ?? "", specification: text("specification"), viscosity: text("viscosity", 80), volume: text("volume", 30), ...(vehicle && typeof vehicle.make === "string" && typeof vehicle.model === "string" && typeof vehicle.variantId === "string" ? {vehicle: {make: vehicle.make.slice(0,200), model: vehicle.model.slice(0,200), variantId: vehicle.variantId.slice(0,200), year: typeof vehicle.year === "string" ? vehicle.year.slice(0,4) : undefined}} : {})};
}
export type ShipmentQuoteLine = {name: string; quantity: number; price: number; discount?: number; maintenance?: ShipmentMaintenanceSelection};
export function shipmentCompositionQuote(vehicle: string, positions: ShipmentQuoteLine[], priceIsCents = false) {
  const money = (cents: number) => new Intl.NumberFormat("ru-RU", {style:"currency", currency:"RUB", maximumFractionDigits:2}).format(cents / 100);
  const lines = positions.map(row => {
    const unitCents = priceIsCents ? Math.round(row.price) : Math.round(row.price * 100);
    const cents = Math.round(row.quantity * unitCents * (1 - (row.discount ?? 0) / 100));
    return {row, cents, unitCents};
  });
  return [`Расчёт ТО: ${vehicle || "Автомобиль не указан"}`, ...lines.map(({row,cents,unitCents}) => `${row.name}: ${row.quantity} × ${money(unitCents)}${row.discount ? ` · скидка ${row.discount}%` : ""} = ${money(cents)}${row.maintenance?.source === "rossko" ? ` · Роско: ${row.maintenance.deliveryLabel || "срок уточняется"}` : ""}`), `Итого: ${money(lines.reduce((sum,line)=>sum+line.cents,0))}`, "", "Предварительный расчёт. Позиции Роско требуют отдельного заказа; наличие, цена и срок подтверждаются перед заказом."].join("\n");
}
