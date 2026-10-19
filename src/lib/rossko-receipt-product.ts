/** Editable catalog data carried by a receipt decision. No provider calls here. */
export type RosskoReceiptProductDetails = {
  name: string;
  brand: string;
  article: string;
  category: string;
  oemParts: string;
  barcodeEan13: string;
  barcodeEan8: string;
  barcodeCode128: string;
  salePrice: number;
};

export function normalizeReceiptProductDetails(value: unknown): RosskoReceiptProductDetails {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Некорректные данные карточки товара");
  const row = value as Record<string, unknown>;
  const labels: Record<string, string> = { name: "название", brand: "бренд", article: "артикул", category: "категория", oemParts: "OEM Parts", barcodeEan13: "EAN-13", barcodeEan8: "EAN-8", barcodeCode128: "Code 128" };
  const field = (key: string, limit: number, required = false) => {
    if (typeof row[key] !== "string") throw new Error(`Некорректное поле: ${labels[key] || key}`);
    const source = (row[key] as string).normalize("NFKC").trim();
    const result = (key === "oemParts" ? source.replace(/[\r\n]+/g, "; ") : source).replace(/\s+/g, " ");
    if (result.length > limit || (required && !result)) throw new Error(`Проверьте поле: ${labels[key] || key}`);
    return result;
  };
  const details = {
    name: field("name", 240, true),
    brand: field("brand", 100, true),
    article: field("article", 120, true),
    category: field("category", 300, true),
    oemParts: field("oemParts", 10000),
    barcodeEan13: field("barcodeEan13", 13),
    barcodeEan8: field("barcodeEan8", 8),
    barcodeCode128: field("barcodeCode128", 120),
    salePrice: row.salePrice as number,
  };
  for (const [barcode, length] of [[details.barcodeEan13, 13], [details.barcodeEan8, 8]] as const) {
    if (!barcode) continue;
    if (!new RegExp(`^\\d{${length}}$`).test(barcode)) throw new Error(`Штрихкод EAN-${length} должен содержать ${length} цифр`);
    const sum = barcode.slice(0, -1).split("").reverse().reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 3 : 1), 0);
    if ((10 - sum % 10) % 10 !== Number(barcode.at(-1))) throw new Error(`Неверная контрольная цифра EAN-${length}`);
  }
  if (details.barcodeCode128 && !/^[\x20-\x7e]+$/.test(details.barcodeCode128)) throw new Error("Code 128 должен содержать латинские буквы, цифры или знаки ASCII");
  if (typeof details.salePrice !== "number" || !Number.isFinite(details.salePrice) || details.salePrice < 0 || details.salePrice > 100000000) throw new Error("Проверьте розничную цену");
  details.salePrice = Math.round(details.salePrice * 100) / 100;
  return details;
}

/** Preserve filled catalog values while applying user edits and completing empty fields. */
export function receiptProductChanges(
  details: RosskoReceiptProductDetails,
  baseline: RosskoReceiptProductDetails,
  stored: { [Key in keyof RosskoReceiptProductDetails]?: RosskoReceiptProductDetails[Key] | null },
): Partial<RosskoReceiptProductDetails> {
  return Object.fromEntries(Object.entries(details).filter(([key, value]) => {
    const field = key as keyof RosskoReceiptProductDetails;
    return value !== baseline[field] || (field !== "salePrice" && !stored[field] && Boolean(value));
  }));
}
