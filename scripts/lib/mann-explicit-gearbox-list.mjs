// Offline proposal parser only. Never identifies the gearbox installed on a VIN.
// Every character must belong to a bullet and a complete decimal model code.
export function explicitGearboxList(value) {
  if (typeof value !== 'string') return null;
  const raw=value.trim();
  if (!/^(?:[-—]\s+7\d{2}\.\d{3})(?:\s+[-—]\s+7\d{2}\.\d{3})+$/.test(raw)) return null;
  const models=raw.match(/7\d{2}\.\d{3}/g);
  if (new Set(models).size!==models.length) return null;
  return models;
}
