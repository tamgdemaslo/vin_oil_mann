import type { PriceLabelLegalEntity } from "@/lib/price-labels";
import type { CSSProperties } from "react";

export type PriceLabelArtworkData = {
  name: string;
  article: string;
  priceCents: number;
  legalEntity: PriceLabelLegalEntity;
};

function formatPrice(cents: number) {
  const value = cents / 100;
  return `${value.toLocaleString("ru-RU", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  })} ₽`;
}

function productNameFontSize(name: string) {
  // The printable name area holds roughly 9,000 character-points at the
  // minimum readable leading. The ceiling preserves the normal 10.4pt label.
  const calculated = Math.sqrt(9_000 / Math.max(name.length, 1));
  return `${Math.max(5.5, Math.min(10.4, calculated)).toFixed(2)}pt`;
}

export function PriceLabelArtwork({ label }: { label: PriceLabelArtworkData }) {
  return (
    <section
      className="price-label-artwork"
      style={{ "--price-label-name-size": productNameFontSize(label.name) } as CSSProperties}
      aria-label={`Ценник ${label.name}`}
    >
      <header className="price-label-artwork__brand">ТАМ, ГДЕ МАСЛО<span>.</span></header>
      <div className="price-label-artwork__rule" aria-hidden />
      <div className="price-label-artwork__main">
        <strong className="price-label-artwork__name">{label.name}</strong>
        <div className="price-label-artwork__price-row">
          {label.article ? <span className="price-label-artwork__article">Арт. {label.article}</span> : <span />}
          <strong className="price-label-artwork__price">{formatPrice(label.priceCents)}</strong>
        </div>
      </div>
      <footer className="price-label-artwork__legal">
        <span>{label.legalEntity.name}</span>
        <span>ИНН {label.legalEntity.inn}</span>
      </footer>
    </section>
  );
}

export const PRICE_LABEL_ARTWORK_CSS = `
    .price-label-artwork {
      width: 50mm;
      height: 30mm;
      box-sizing: border-box;
      display: grid;
      grid-template-rows: auto 1px minmax(0, 1fr) auto;
      gap: 1.1mm;
      padding: 1.65mm 1.85mm 1.5mm;
      overflow: hidden;
      color: #000;
      background: #fff;
      font-family: Inter, Arial, Helvetica, sans-serif;
      font-variant-numeric: tabular-nums;
      text-rendering: geometricPrecision;
    }
    .price-label-artwork * { box-sizing: border-box; }
    .price-label-artwork__brand {
      font-size: 6.1pt;
      font-weight: 800;
      line-height: 1;
      letter-spacing: .075em;
      white-space: nowrap;
    }
    .price-label-artwork__brand span { letter-spacing: 0; }
    .price-label-artwork__rule { height: 1px; background: #000; }
    .price-label-artwork__main {
      min-height: 0;
      display: grid;
      align-content: space-between;
      gap: 1.15mm;
    }
    .price-label-artwork__name {
      display: block;
      overflow: hidden;
      font-size: var(--price-label-name-size, 10.4pt);
      font-weight: 800;
      line-height: 1.03;
      letter-spacing: -.018em;
      overflow-wrap: anywhere;
      word-break: normal;
    }
    .price-label-artwork__price-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 1.2mm;
      align-items: end;
    }
    .price-label-artwork__article {
      overflow: hidden;
      font-size: 6.35pt;
      font-weight: 650;
      line-height: 1.08;
      overflow-wrap: anywhere;
    }
    .price-label-artwork__price {
      font-size: 13pt;
      font-weight: 850;
      line-height: .9;
      letter-spacing: -.035em;
      white-space: nowrap;
    }
    .price-label-artwork__legal {
      display: grid;
      gap: .35mm;
      min-height: 0;
      padding-top: .75mm;
      border-top: 1px solid #000;
      font-size: 5.1pt;
      font-weight: 500;
      line-height: 1.08;
      overflow-wrap: anywhere;
    }
    .price-label-artwork__legal span:last-child { font-weight: 700; }
    @media print {
      .price-label-artwork { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
`;

export function PriceLabelArtworkStyles() {
  return <style>{PRICE_LABEL_ARTWORK_CSS}</style>;
}
