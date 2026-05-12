/**
 * Подкапотная бирка A · «Сервисный талон» — 50×70 мм @ 96dpi (189×265 px), макет tgm eco-5.
 */
import type { CSSProperties } from "react";
import type { JobOrderPosterModel } from "@/lib/job-order-poster-types";

const INK = "#000";
const BG = "#fff";

const chessStrip: CSSProperties = {
  backgroundImage: "repeating-linear-gradient(45deg, #000 0 6px, #fff 6px 12px)",
};

function fmtKm(n: number): string {
  return Math.round(n)
    .toLocaleString("ru-RU", { maximumFractionDigits: 0 })
    .replace(/\u00a0|\u202f/g, " ");
}

function fmtPlate(p: string): string {
  const m = /^([А-ЯA-Z])\s*(\d{3})\s*([А-ЯA-Z]{2})\s*(\d{2,3})$/i.exec(p || "");
  return m ? `${m[1]} ${m[2]} ${m[3]} · ${m[4]}` : p;
}

function vinTail(vin: string): string {
  return (vin || "").slice(-6);
}

const cardBase: CSSProperties = {
  width: 189,
  height: 265,
  boxSizing: "border-box",
  background: BG,
  color: INK,
  border: `2px solid ${INK}`,
  fontFamily: '"Inter", system-ui, sans-serif',
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  breakInside: "avoid",
};

function Wordmark({ size = 8, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <span
      style={{
        fontSize: size,
        fontWeight: 700,
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        color,
        display: "inline-flex",
        alignItems: "center",
        whiteSpace: "nowrap",
      }}
    >
      Там где масло
      <span
        style={{
          display: "inline-block",
          width: size * 0.55,
          height: size * 0.55,
          background: "currentColor",
          marginLeft: 2,
        }}
      />
    </span>
  );
}

function Monogram({ size = 9, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <span
      style={{
        fontSize: size,
        fontWeight: 800,
        letterSpacing: "0.06em",
        color,
        display: "inline-flex",
        alignItems: "center",
      }}
    >
      TGM
      <span
        style={{
          display: "inline-block",
          width: size * 0.55,
          height: size * 0.55,
          background: "currentColor",
          marginLeft: 1,
        }}
      />
    </span>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 6,
        borderBottom: `1px dotted ${INK}`,
        padding: "2px 0",
      }}
    >
      <span style={{ fontWeight: 500 }}>{k}</span>
      <span style={{ fontWeight: 700, textAlign: "right" }}>{v}</span>
    </div>
  );
}

export default function UnderHoodTags({ data: o }: { data: JobOrderPosterModel }) {
  const oil = o.oilTagLine;
  const plate = fmtPlate(o.car.plate);
  return (
    <div style={{ display: "flex", justifyContent: "center" }}>
      <div className="under-hood-tag-card" style={cardBase}>
        <div style={{ ...chessStrip, height: 8, flexShrink: 0, borderBottom: `2px solid ${INK}` }} />

        <div
          style={{
            background: INK,
            color: BG,
            padding: "5px 8px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 8.5,
          }}
        >
          <Wordmark size={7} color={BG} />
          <span style={{ fontWeight: 700, letterSpacing: "0.04em" }}>№{o.number}</span>
        </div>

        <div style={{ padding: "8px 8px 6px", textAlign: "center", borderBottom: `1px solid ${INK}` }}>
          <div style={{ fontSize: 8, letterSpacing: "0.14em", fontWeight: 700 }}>СЛЕД. ЗАМЕНА · ПРОБЕГ</div>
          <div
            style={{
              fontSize: 34,
              fontWeight: 800,
              letterSpacing: "-0.03em",
              lineHeight: 1,
              margin: "3px 0 2px",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {fmtKm(o.next.mileage)}
          </div>
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.06em" }}>КМ</div>
          <div style={{ marginTop: 5, fontSize: 9, fontWeight: 500 }}>
            или до <b style={{ fontWeight: 800 }}>{o.next.date}</b>
          </div>
        </div>

        <div style={{ padding: "5px 8px", flex: 1, fontSize: 8.5, lineHeight: 1.35, minHeight: 0 }}>
          <Row k="Заменено" v={o.date} />
          <Row k="При пробеге" v={`${fmtKm(o.car.mileage)} км`} />
          <Row k="Масло" v={oil} />
          <Row k="Госномер" v={plate || "—"} />
          <Row k="Авто" v={`${o.car.model} ${o.car.year} · ${vinTail(o.car.vin)}`} />
        </div>

        <div
          style={{
            background: INK,
            color: BG,
            padding: "5px 8px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 8,
            flexShrink: 0,
          }}
        >
          <Monogram size={9} color={BG} />
          <span style={{ fontWeight: 500 }}>{o.ip.phone}</span>
        </div>
      </div>
    </div>
  );
}
