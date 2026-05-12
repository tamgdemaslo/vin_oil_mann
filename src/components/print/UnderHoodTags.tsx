/**
 * Подкапотная бирка — макет tgm eco-7 / under-hood-tags.jsx (TagClassic «гаражный пропуск»).
 * 50×80 мм @ 96 dpi (≈189×302 px).
 */
import type { CSSProperties } from "react";
import type { JobOrderPosterModel } from "@/lib/job-order-poster-types";

const INK = "#000";
const BG = "#fff";

const TAG_W = "50mm";
const TAG_H = "80mm";

function fmtKm(n: number): string {
  return Math.round(n)
    .toLocaleString("ru-RU", { maximumFractionDigits: 0 })
    .replace(/\u00a0|\u202f/g, " ");
}

/** Как в eco-7: «Залито» — до первой запятой; «Объём» — последний сегмент после запятых */
function splitOilLine(raw: string): { oil: string; qty: string } {
  const t = (raw || "").trim();
  if (!t) return { oil: "—", qty: "—" };
  const parts = t.split(",").map((s) => s.trim());
  const oil = (parts[0] || "").trim() || "—";
  const qty = (parts[parts.length - 1] || "").trim() || "—";
  return { oil, qty };
}

const cardBase: CSSProperties = {
  width: "100%",
  maxWidth: TAG_W,
  height: TAG_H,
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
  const rawOil = o.oilTagLine || "";
  const { oil, qty } = splitOilLine(rawOil);

  return (
    <div className="under-hood-tag-wrap" style={{ width: "100%", boxSizing: "border-box" }}>
      <div className="under-hood-tag-card" style={cardBase}>
        <div
          style={{
            background: INK,
            color: BG,
            padding: "6px 8px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderBottom: `1px solid ${INK}`,
          }}
        >
          <Wordmark size={6.5} color={BG} />
          <span style={{ fontSize: 7.5, fontWeight: 700, letterSpacing: "0.12em" }}>PASS №{o.number}</span>
        </div>

        <div style={{ padding: "10px 8px 8px", textAlign: "center", borderBottom: `1px solid ${INK}` }}>
          <div style={{ fontSize: 7.5, letterSpacing: "0.18em", fontWeight: 800 }}>СЛЕДУЮЩИЙ ПИТ-СТОП</div>
          <div
            style={{
              fontSize: 38,
              fontWeight: 800,
              letterSpacing: "-0.035em",
              lineHeight: 1,
              margin: "5px 0 1px",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {fmtKm(o.next.mileage)}
          </div>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.18em" }}>КМ</div>
          <div
            style={{
              marginTop: 7,
              paddingTop: 6,
              borderTop: `1px dotted ${INK}`,
              fontSize: 9,
              fontWeight: 600,
              display: "flex",
              justifyContent: "center",
              gap: 5,
            }}
          >
            <span style={{ letterSpacing: "0.1em" }}>ИЛИ ДО</span>
            <b style={{ fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{o.next.date}</b>
          </div>
        </div>

        <div
          style={{
            padding: "8px 10px 8px",
            flex: 1,
            fontSize: 9.5,
            lineHeight: 1.45,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            minHeight: 0,
          }}
        >
          <Row k="Въезд" v={o.date} />
          <Row k="При пробеге" v={`${fmtKm(o.car.mileage)} км`} />
          <Row k="Залито" v={oil} />
          <Row k="Объём" v={qty} />
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
          }}
        >
          <Monogram size={9} color={BG} />
          <span style={{ fontWeight: 500, letterSpacing: "0.04em" }}>{o.ip.phone}</span>
        </div>
      </div>
    </div>
  );
}
