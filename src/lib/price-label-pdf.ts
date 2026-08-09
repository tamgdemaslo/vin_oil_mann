import { readFile, stat } from "fs/promises";
import { join } from "path";
import PDFDocument from "pdfkit";
import type { PriceLabel, PriceLabelLegalEntity } from "@/lib/price-labels";

const mm = (value: number) => (value * 72) / 25.4;
const PAGE_WIDTH = mm(50);
const PAGE_HEIGHT = mm(30);
const PADDING_X = mm(1.85);

export type PriceLabelFonts = { regular: Buffer; bold: Buffer };

export const PRICE_LABEL_FONT_ASSET_DIR = "assets/price-label-fonts";

/**
 * HTTP headers accept only byte strings. Receipt numbers may include Cyrillic
 * (for example, "ПР-20260809-001"), so keep the download filename ASCII-only.
 */
export function priceLabelPdfFilename(receiptNumber: string | null | undefined, date: string) {
  const receiptPart = (receiptNumber || "receipt")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "receipt";
  return `price-labels-${receiptPart}-${date}.pdf`;
}

type PriceLabelFontPaths = { regular: string; bold: string };
type PriceLabelFontDiagnostic = {
  cwd: string;
  expectedPath: string[];
  regularPath: string;
  regularExists: boolean;
  boldPath: string;
  boldExists: boolean;
};

let cachedFonts: PriceLabelFonts | null = null;
let fontDiagnosticLogged = false;

function priceLabelFontPaths(): PriceLabelFontPaths {
  const assetsDir = join(process.cwd(), PRICE_LABEL_FONT_ASSET_DIR);
  return {
    regular: join(assetsDir, "Inter-Regular.ttf"),
    bold: join(assetsDir, "Inter-Bold.ttf"),
  };
}

async function fileExists(path: string) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function logFontDiagnosticOnce(diagnostic: PriceLabelFontDiagnostic) {
  if (fontDiagnosticLogged) return;
  fontDiagnosticLogged = true;
  console.info("priceLabelFontDiagnostic", diagnostic);
}

/** Loads the two Inter assets shipped with the application, never system fonts or HTTP. */
export async function getPriceLabelFonts(): Promise<PriceLabelFonts> {
  if (cachedFonts) return cachedFonts;

  const paths = priceLabelFontPaths();
  const diagnostic: PriceLabelFontDiagnostic = {
    cwd: process.cwd(),
    expectedPath: [paths.regular, paths.bold],
    regularPath: paths.regular,
    regularExists: await fileExists(paths.regular),
    boldPath: paths.bold,
    boldExists: await fileExists(paths.bold),
  };
  logFontDiagnosticOnce(diagnostic);
  if (!diagnostic.regularExists || !diagnostic.boldExists) {
    console.error("PRICE_LABEL_FONT_ASSET_MISSING", diagnostic);
    throw new Error("PRICE_LABEL_FONT_ASSET_MISSING");
  }

  let regular: Buffer;
  let bold: Buffer;
  try {
    [regular, bold] = await Promise.all([readFile(paths.regular), readFile(paths.bold)]);
  } catch {
    console.error("PRICE_LABEL_FONT_ASSET_MISSING", diagnostic);
    throw new Error("PRICE_LABEL_FONT_ASSET_MISSING");
  }
  if (!regular.length || !bold.length) {
    console.error("PRICE_LABEL_FONT_ASSET_MISSING", diagnostic);
    throw new Error("PRICE_LABEL_FONT_ASSET_MISSING");
  }
  cachedFonts = { regular, bold };
  return cachedFonts;
}

function formatPrice(cents: number) {
  const value = cents / 100;
  return `${value.toLocaleString("ru-RU", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  })} ₽`;
}

function textSizeToFit(doc: PDFKit.PDFDocument, text: string, width: number, preferred: number, minimum: number) {
  for (let size = preferred; size >= minimum; size -= 0.2) {
    doc.fontSize(size);
    if (doc.widthOfString(text) <= width) return Number(size.toFixed(2));
  }
  return minimum;
}

function titleSizeToFit(doc: PDFKit.PDFDocument, text: string, width: number) {
  for (let size = 10.4; size >= 5.5; size -= 0.2) {
    doc.fontSize(size);
    if (doc.heightOfString(text, { width, lineGap: -0.8 }) <= 26) return Number(size.toFixed(2));
  }
  return 5.5;
}

function drawPriceLabel(doc: PDFKit.PDFDocument, label: PriceLabel, legalEntity: PriceLabelLegalEntity) {
  const x = PADDING_X;
  const contentWidth = PAGE_WIDTH - PADDING_X * 2;

  doc.font("PriceLabelBold").fillColor("#000").fontSize(6.1).text("ТАМ, ГДЕ МАСЛО.", x, mm(1.65), {
    lineBreak: false,
    characterSpacing: 0.45,
  });
  doc.moveTo(x, mm(4.75)).lineTo(PAGE_WIDTH - x, mm(4.75)).lineWidth(0.7).stroke("#000");

  doc.font("PriceLabelBold");
  const titleSize = titleSizeToFit(doc, label.name, contentWidth);
  doc.fontSize(titleSize).text(label.name, x, mm(6.15), {
    width: contentWidth,
    lineGap: -0.8,
  });

  const price = formatPrice(label.priceCents);
  doc.font("PriceLabelBold");
  const priceSize = textSizeToFit(doc, price, contentWidth * 0.58, 13, 8.5);
  doc.fontSize(priceSize);
  const priceWidth = doc.widthOfString(price);
  const priceX = PAGE_WIDTH - x - priceWidth;
  const priceY = mm(17.65);
  doc.text(price, priceX, priceY, { lineBreak: false });

  const article = label.article ? `Арт. ${label.article}` : "";
  if (article) {
    const articleWidth = Math.max(mm(12), priceX - x - mm(1.2));
    doc.font("PriceLabelRegular").fontSize(6.15).text(article, x, priceY + 4.1, {
      width: articleWidth,
      height: 11,
      lineGap: -0.5,
    });
  }

  const legalRuleY = mm(23.75);
  doc.moveTo(x, legalRuleY).lineTo(PAGE_WIDTH - x, legalRuleY).lineWidth(0.7).stroke("#000");
  doc.font("PriceLabelRegular");
  const legalNameSize = textSizeToFit(doc, legalEntity.name, contentWidth, 5.05, 3.6);
  doc.fontSize(legalNameSize).text(legalEntity.name, x, legalRuleY + mm(0.8), { lineBreak: false });
  const inn = `ИНН ${legalEntity.inn}`;
  const innSize = textSizeToFit(doc, inn, contentWidth, 5.05, 3.8);
  doc.font("PriceLabelBold").fontSize(innSize).text(inn, x, legalRuleY + mm(2.65), { lineBreak: false });
}

/** Generates a printer-ready 50 x 30 mm PDF without an external browser process. */
export async function renderPriceLabelsPdf(labels: PriceLabel[], legalEntity: PriceLabelLegalEntity): Promise<Buffer> {
  if (!labels.length) throw new Error("Для печати не выбраны ценники.");

  const fonts = await getPriceLabelFonts();
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const documentOptions = {
      autoFirstPage: false,
      compress: true,
      // PDFKit otherwise initializes its built-in Helvetica before the Inter
      // fonts below are registered. The standalone bundle intentionally ships
      // only the bundled Inter assets, not PDFKit's AFM data directory.
      font: fonts.regular,
      info: { Title: "Ценники" },
    };
    // @types/pdfkit currently narrows `font` to a path, while PDFKit itself
    // supports an in-memory Buffer (which is required for standalone builds).
    const document = new PDFDocument(documentOptions as unknown as PDFKit.PDFDocumentOptions);
    document.registerFont("PriceLabelRegular", fonts.regular);
    document.registerFont("PriceLabelBold", fonts.bold);
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.once("error", reject);
    document.once("end", () => resolve(Buffer.concat(chunks)));

    for (const label of labels) {
      for (let copy = 0; copy < label.copies; copy += 1) {
        document.addPage({ size: [PAGE_WIDTH, PAGE_HEIGHT], margin: 0 });
        drawPriceLabel(document, label, legalEntity);
      }
    }
    document.end();
  });
}
