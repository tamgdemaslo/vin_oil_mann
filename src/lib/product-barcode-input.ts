export function normalizeBindableBarcode(value: unknown): string {
  const barcode = typeof value === "string" ? value.trim() : "";
  if (!barcode || barcode.length > 120 || !/^[\x20-\x7e]+$/.test(barcode)) {
    throw new Error("Отсканируйте обычный штрихкод товара длиной до 120 символов");
  }
  return barcode;
}

export function isProductBarcodeSearch(value: string): boolean {
  return /^[!-~]{3,120}$/.test(value.trim());
}

export function productBarcodeWhere(barcode: string) {
  return { OR: [{ barcodeEan13: barcode }, { barcodeEan8: barcode }, { barcodeCode128: barcode }, { code: barcode }] };
}

export function productBarcodePatch(product: {
  barcodeEan13?: string | null; barcodeEan8?: string | null; barcodeCode128?: string | null; code?: string | null;
}, barcode: string): { barcodeEan13?: string; barcodeEan8?: string; barcodeCode128?: string } {
  if ([product.barcodeEan13, product.barcodeEan8, product.barcodeCode128, product.code].includes(barcode)) return {};
  if (/^\d{13}$/.test(barcode) && !product.barcodeEan13) return { barcodeEan13: barcode };
  if (/^\d{8}$/.test(barcode) && !product.barcodeEan8) return { barcodeEan8: barcode };
  if (!product.barcodeCode128) return { barcodeCode128: barcode };
  throw new Error("У товара уже заполнены доступные поля штрихкодов. Измените их в карточке товара.");
}
