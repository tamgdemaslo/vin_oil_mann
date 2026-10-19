/** Quantities use warehouse precision (0.001). Integer arithmetic avoids 0.3/0.1 drift. */
export const kitUnits = (quantity: number) => Math.round(quantity * 1000);
export const kitQuantity = (units: number) => units / 1000;

export type KitComponent = {
  productId: string;
  quantity: number;
  available: number;
  priceCents: number;
  blocked?: boolean;
};

export function calculateKit(components: KitComponent[], target: number) {
  const ready = components.length ? Math.min(...components.map((item) =>
    item.blocked || kitUnits(item.quantity) <= 0 ? 0 : Math.floor(Math.max(0, kitUnits(item.available)) / kitUnits(item.quantity)),
  )) : 0;
  const anyStock = components.some((item) => !item.blocked && item.available > 0);
  return {
    ready,
    status: ready > 0 ? "ready" as const : anyStock ? "partial" as const : "empty" as const,
    priceCents: components.reduce((sum, item) => sum + Math.round(item.priceCents * item.quantity), 0),
    target,
    missingKits: Math.max(0, target - ready),
    items: components.map((item) => ({
      ...item,
      missingNext: kitQuantity(Math.max(0, kitUnits(item.quantity) * (ready + 1) - (item.blocked ? 0 : Math.max(0, kitUnits(item.available))))),
      missingTarget: kitQuantity(Math.max(0, kitUnits(item.quantity) * target - (item.blocked ? 0 : Math.max(0, kitUnits(item.available))))),
    })),
  };
}

export function validateKitInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Неверные данные комплекта");
  const body = value as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 200) throw new Error("Укажите название комплекта до 200 символов");
  if (!Array.isArray(body.items) || !body.items.length || body.items.length > 100) throw new Error("Добавьте от 1 до 100 товаров");
  const ids = new Set<string>();
  const items = body.items.map((raw: unknown) => {
    if (!raw || typeof raw !== "object") throw new Error("Неверная строка состава");
    const item = raw as Record<string, unknown>;
    if (typeof item.productId !== "string" || !item.productId || ids.has(item.productId)) throw new Error("Товары в составе не должны повторяться");
    const quantity = item.quantity;
    if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000 || Math.abs(kitUnits(quantity) / 1000 - quantity) > 1e-8) {
      throw new Error("Количество должно быть положительным числом с точностью до 0,001 (не более 1 000 000)");
    }
    ids.add(item.productId);
    return { productId: item.productId, quantity };
  });
  return { name, items };
}

/** Expand into ordinary shipment lines; existing prices, discounts and metadata stay intact. */
export function mergeKitPositions<T extends { quantity: number; assortmentMeta?: { href: string } }>(current: T[], incoming: T[]) {
  const result = current.map((item) => ({ ...item }));
  for (const line of incoming) {
    const index = result.findIndex((item) => line.assortmentMeta?.href && item.assortmentMeta?.href === line.assortmentMeta.href);
    if (index >= 0) result[index].quantity = kitQuantity(kitUnits(result[index].quantity) + kitUnits(line.quantity));
    else result.push({ ...line });
  }
  return result;
}
