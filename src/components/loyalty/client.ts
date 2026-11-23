export async function loyaltyRequest<T>(url: string, body?: unknown, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    ...options,
    ...(body === undefined ? {} : { method: options.method ?? "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Не удалось завершить бонусную операцию");
  return result;
}

export const loyaltyMoney = (cents: number) => new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB" }).format(cents / 100);
export const loyaltyNumber = (points: number) => points.toLocaleString("ru-RU");
export const loyaltyDate = (value: string) => new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Kaliningrad", dateStyle: "medium" }).format(new Date(value));
export const expiryLabel = (value: string) => loyaltyDate(new Date(Date.parse(value) - 1).toISOString());

export function requiresPostingForLoyaltyPrecheck(status?: string) {
  return status !== undefined && ["linked", "new", "confirm", "review", "incomplete", "excluded", "skip"].includes(status);
}
