/** Accept complete, unambiguous production dates only; never generation ranges. */
export function exactVehicleProductionMonth(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^(\d{4})-(0[1-9]|1[0-2])(?:-(0[1-9]|[12]\d|3[01]))?$/.exec(value.trim());
  if (!match) return undefined;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  if (year < 1886 || year > 2100) return undefined;
  if (match[3] && new Date(Date.UTC(year, month - 1, day)).getUTCMonth() !== month - 1) return undefined;
  return `${match[1]}-${match[2]}`;
}

export function consistentVehicleProductionMonth(values: unknown[], year?: number): string | undefined {
  const present = values.filter(value => value !== undefined && value !== null && value !== "");
  if (!present.length) return undefined;
  const months = present.map(exactVehicleProductionMonth);
  if (months.some(value => !value) || new Set(months).size !== 1) return undefined;
  const month = months[0]!;
  return year === undefined || Number(month.slice(0, 4)) === year ? month : undefined;
}
