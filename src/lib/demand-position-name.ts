/** Recover a service label without exposing internal references on documents. */
export function resolveServicePositionName(...candidates: unknown[]): string {
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const name = candidate.trim();
    if (!name || /^local:\/\//i.test(name)) continue;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(name)) continue;
    if (/^c[a-z0-9]{24}$/i.test(name)) continue;
    return name;
  }
  return "Разовая услуга";
}
