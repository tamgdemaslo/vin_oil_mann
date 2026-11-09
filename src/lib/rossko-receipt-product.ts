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

export const receiptBarcodeFields = ["barcodeEan13", "barcodeEan8", "barcodeCode128"] as const;
export type ReceiptBarcodeField = typeof receiptBarcodeFields[number];
export type RosskoReceiptProductInput = Omit<RosskoReceiptProductDetails, ReceiptBarcodeField>
  & Partial<Pick<RosskoReceiptProductDetails, ReceiptBarcodeField>>;

export class ReceiptBarcodeValidationError extends Error {
  constructor(public readonly field: ReceiptBarcodeField, message: string) { super(message); }
}

export function validateReceiptBarcodes(values: Partial<Pick<RosskoReceiptProductDetails, ReceiptBarcodeField>>) {
  for (const [key, length] of [["barcodeEan13", 13], ["barcodeEan8", 8]] as const) {
    const barcode = values[key];
    if (!barcode) continue;
    if (!new RegExp(`^\\d{${length}}$`).test(barcode)) throw new ReceiptBarcodeValidationError(key, `Штрихкод EAN-${length} должен содержать ровно ${length} цифр`);
    const sum = barcode.slice(0, -1).split("").reverse().reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 3 : 1), 0);
    if ((10 - sum % 10) % 10 !== Number(barcode.at(-1))) throw new ReceiptBarcodeValidationError(key, `Неверная контрольная цифра EAN-${length}`);
  }
  if (values.barcodeCode128 && !/^[\x20-\x7e]+$/.test(values.barcodeCode128)) throw new ReceiptBarcodeValidationError("barcodeCode128", "Code 128 должен содержать латинские буквы, цифры или знаки ASCII");
}

export function normalizeReceiptProductDetails(value: unknown): RosskoReceiptProductDetails;
export function normalizeReceiptProductDetails(value: unknown, allowOmittedBarcodes: true): RosskoReceiptProductInput;
export function normalizeReceiptProductDetails(value: unknown, allowOmittedBarcodes = false): RosskoReceiptProductInput {
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
  function barcodeField(key: ReceiptBarcodeField, limit: number) {
    if (allowOmittedBarcodes && row[key] === undefined) return undefined;
    try { return field(key, limit); }
    catch {
      throw new ReceiptBarcodeValidationError(key, key === "barcodeCode128"
        ? "Code 128 должен содержать не больше 120 символов"
        : `Штрихкод ${labels[key]} должен содержать ровно ${limit} цифр`);
    }
  }
  const details = {
    name: field("name", 240, true),
    brand: field("brand", 100, true),
    article: field("article", 120, true),
    category: field("category", 300, true),
    oemParts: field("oemParts", 10000),
    barcodeEan13: barcodeField("barcodeEan13", 13),
    barcodeEan8: barcodeField("barcodeEan8", 8),
    barcodeCode128: barcodeField("barcodeCode128", 120),
    salePrice: row.salePrice as number,
  };
  validateReceiptBarcodes(details);
  if (typeof details.salePrice !== "number" || !Number.isFinite(details.salePrice) || details.salePrice < 0 || details.salePrice > 100000000) throw new Error("Проверьте розничную цену");
  details.salePrice = Math.round(details.salePrice * 100) / 100;
  return details;
}

/** Leave stored barcode values alone; only validate codes the receipt will save. */
export function prepareReceiptProductDetails(
  details: RosskoReceiptProductDetails,
  catalogBarcodes?: Partial<Pick<RosskoReceiptProductDetails, ReceiptBarcodeField>>,
): RosskoReceiptProductInput {
  const edits: RosskoReceiptProductInput = { ...details };
  for (const field of receiptBarcodeFields) {
    if (catalogBarcodes?.[field] && edits[field] === catalogBarcodes[field]) delete edits[field];
  }
  return normalizeReceiptProductDetails(edits, true);
}

/** Preserve filled catalog values while applying user edits and completing empty fields. */
export function receiptProductChanges(
  details: RosskoReceiptProductInput,
  baseline: RosskoReceiptProductDetails,
  stored: { [Key in keyof RosskoReceiptProductDetails]?: RosskoReceiptProductDetails[Key] | null },
): Partial<RosskoReceiptProductDetails> {
  return Object.fromEntries(Object.entries(details).filter(([key, value]) => {
    const field = key as keyof RosskoReceiptProductDetails;
    return value !== undefined && (value !== baseline[field] || (field !== "salePrice" && !stored[field] && Boolean(value)));
  }));
}
