export type QuickCommand = {
  kind: "booking" | "task";
  customerName: string;
  phone: string;
  datetime: string;
  service: string;
  master: string;
  title: string;
  notes: string;
};

export type QuickBookingOptions = {
  services: { id: string; name: string; masterIds: number[] }[];
  masters: { id: number; name: string }[];
};

export function uniqueQuickOption<T extends { name: string }>(hint: string, options: T[]): T | undefined {
  const normalize = (value: string) => value.trim().toLocaleLowerCase("ru").replaceAll("ё", "е");
  const name = normalize(hint);
  if (!name) return;
  const matches = options.filter(option => normalize(option.name) === name);
  if (matches.length === 1) return matches[0];
}

export function uniqueQuickBookingService(hint: string, services: QuickBookingOptions["services"]) {
  const exact = uniqueQuickOption(hint, services);
  if (exact) return exact;
  const normalize = (value: string) => value.toLocaleLowerCase("ru").replaceAll("ё", "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim()
    .replace(/^диагностика автомобиля$/u, "диагностика")
    .replace(/(^| )в двигателе(?= |$)/gu, "$1").replace(/ +/g, " ").trim();
  const name = normalize(hint);
  if (!name) return;
  const matches = services.filter(service => normalize(service.name) === name);
  if (matches.length === 1) return matches[0];
}

export type QuickSourceLink = { label: string; href: string };
export type QuickAnswer = { text: string; sources: QuickSourceLink[] };

export type QuickShipmentPreview = {
  sourceId: string;
  sourceName: string;
  customer: string;
  warehouse: string;
  organization: string;
  description: string;
  totalCents: number;
  positions: {
    name: string;
    quantity: number;
    priceCents: number;
    discount: number;
    vat: number | null;
    comment?: string;
    available: number | null;
    shortage: boolean;
  }[];
  fingerprint: string;
  nonce: string;
};
