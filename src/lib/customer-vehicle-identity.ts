/** Explicit attribute names prevent «VIN номер» from being read as a registration plate. */
export function vehicleAttribute(attributes: unknown, field: "vin" | "plate" | "model" | "mileage"): string | null {
  if (!Array.isArray(attributes)) return null;
  const names = {
    vin: /^(?:vin(?:\s*(?:номер|number))?|вин(?:\s*номер)?)$/i,
    plate: /^(?:гос\.?\s*(?:номер|знак)|г\/н|госномер|регистрационный\s*номер|plate|license\s*plate)$/i,
    model: /^(?:модель(?:\s*авто)?|модель\s*автомобиля|vehicle|car|vehicle\s*model)$/i,
    mileage: /^(?:пробег|mileage|odometer)$/i,
  };
  for (const attribute of attributes) {
    if (!attribute || typeof attribute !== "object") continue;
    const { name, value } = attribute as { name?: unknown; value?: unknown };
    if (typeof name !== "string" || !names[field].test(name.trim())) continue;
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

export function normalizeVehicleIdentifier(value: string | null): string {
  const aliases: Record<string, string> = { А: "A", В: "B", Е: "E", К: "K", М: "M", Н: "H", О: "O", Р: "P", С: "C", Т: "T", У: "Y", Х: "X" };
  return (value ?? "").toUpperCase().replace(/[АВЕКМНОРСТУХ]/g, char => aliases[char]).replace(/[^A-ZА-Я0-9]/g, "");
}

export function customerVehicleIdentity(attributes: unknown) {
  const vin = normalizeVehicleIdentifier(vehicleAttribute(attributes, "vin"));
  const plate = normalizeVehicleIdentifier(vehicleAttribute(attributes, "plate"));
  return {
    vin: /^[A-HJ-NPR-Z0-9]{17}$/.test(vin) ? vin : null,
    plate: /^[ABEKMHOPCTYX]\d{3}[ABEKMHOPCTYX]{2}\d{2,3}$/.test(plate) ? plate : null,
    label: [vehicleAttribute(attributes, "model"), vehicleAttribute(attributes, "plate")].filter(Boolean).join(" · ") || "Автомобиль не указан",
  };
}
