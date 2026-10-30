type QuoteKit = {
  name: string;
  items: { name: string; article: string; quantity: number; unit: string; priceCents: number }[];
};

const money = (cents: number) => `${(cents / 100).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₽`;
const quantity = (value: number) => value.toLocaleString("ru-RU", { maximumFractionDigits: 3 });

/** Empty means the work has not been priced; zero explicitly means free work. */
export function parseKitLaborCents(value: string): number | null {
  const normalized = value.trim().replace(/,/g, ".");
  if (!normalized) return null;
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) throw new Error("Укажите стоимость работы от 0 с точностью до копеек");
  const cents = Math.round(Number(normalized) * 100);
  if (!Number.isSafeInteger(cents) || cents > 100_000_000) throw new Error("Стоимость работы не должна превышать 1 000 000 ₽");
  return cents;
}

export function buildKitClientQuote(kit: QuoteKit, laborCents: number | null): string {
  if (laborCents !== null && (!Number.isSafeInteger(laborCents) || laborCents < 0)) throw new Error("Неверная стоимость работы");
  const partsCents = kit.items.reduce((sum, item) => sum + Math.round(item.priceCents * item.quantity), 0);
  return [
    `Здравствуйте! Расчёт: ${kit.name}.`,
    "",
    "Запчасти:",
    ...kit.items.map((item) => `• ${item.name}${item.article ? ` (${item.article})` : ""} — ${quantity(item.quantity)} ${item.unit} × ${money(item.priceCents)} = ${money(Math.round(item.priceCents * item.quantity))}`),
    "",
    `Запчасти: ${money(partsCents)}`,
    laborCents === null ? "Стоимость работы уточняется." : `Работа: ${money(laborCents)}`,
    laborCents === null ? `Итого за запчасти: ${money(partsCents)}` : `Итого с работой: ${money(partsCents + laborCents)}`,
  ].join("\n");
}
