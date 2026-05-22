import type { JobOrderPosterModel } from "@/lib/job-order-poster-types";

const B_W = 794;
const B_H = 1123;

const Bink = "#0A0A0A";
const Bpaper = "#F5F2ED";
const Brust = "#C2410C";
const Bmuted = "#3D3D3D";

/** Рубли для постера: тысячи через пробел, копейки после запятой (не затирать запятую как раньше). */
const bfmt = (n: number) =>
  Number(n)
    .toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 })
    .replace(/\u00a0|\u202f/g, " ");

/** Склонение: «1 заезд», «2 заезда», «5 заездов». */
function ruTripsIntroLine(count: number, since: string): string {
  const n = Math.max(0, Math.floor(count));
  const mod100 = n % 100;
  const mod10 = n % 10;
  let word: string;
  if (mod100 >= 11 && mod100 <= 14) word = "заездов";
  else if (mod10 === 1) word = "заезд";
  else if (mod10 >= 2 && mod10 <= 4) word = "заезда";
  else word = "заездов";
  return `${n} ${word} на этом авто с ${since}`;
}

function fmtCountRu(n: number): string {
  return Math.max(0, Math.floor(n))
    .toLocaleString("ru-RU", { maximumFractionDigits: 0 })
    .replace(/\u00a0|\u202f/g, " ");
}

function ruVisitsWord(n: number): string {
  const k = Math.max(0, Math.floor(n));
  const mod100 = k % 100;
  const mod10 = k % 10;
  if (mod100 >= 11 && mod100 <= 14) return "заездов";
  if (mod10 === 1) return "заезд";
  if (mod10 >= 2 && mod10 <= 4) return "заезда";
  return "заездов";
}

function posterFooterLifetimeLine(c: JobOrderPosterModel["client"]): string {
  const n = Math.max(0, Math.floor(c.lifetimeVisits));
  return `${fmtCountRu(n)} ${ruVisitsWord(n)} · с ${c.lifetimeSinceYear}`;
}

function posterFooterPilotTripLine(c: JobOrderPosterModel["client"]): string {
  const v = Math.max(1, Math.floor(c.visits));
  return `${v}-й заезд с ${c.sinceVisit}`;
}

function HexBg({ w, h, opacity = 0.06 }: { w: number; h: number; opacity?: number }) {
  const r = 22;
  const dx = r * Math.sqrt(3);
  const dy = r * 1.5;
  const cols = Math.ceil(w / dx) + 2;
  const rows = Math.ceil(h / dy) + 2;
  const pts = (cx: number, cy: number) =>
    Array.from({ length: 6 }, (_, i) => {
      const a = (Math.PI / 3) * i + Math.PI / 6;
      return [cx + r * Math.cos(a), cy + r * Math.sin(a)].join(",");
    }).join(" ");
  const cells = [];
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < cols; col++) {
      const cx = col * dx + (row % 2 ? dx / 2 : 0);
      const cy = row * dy;
      cells.push(
        <polygon
          key={`${row}-${col}`}
          points={pts(cx, cy)}
          fill="none"
          stroke={Bink}
          strokeWidth="0.7"
          opacity={opacity}
        />
      );
    }
  return (
    <svg width={w} height={h} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {cells}
    </svg>
  );
}

function PosterChess({ w, h = 14, n = 44 }: { w: number; h?: number; n?: number }) {
  const sq = w / n;
  const cells = [];
  for (let i = 0; i < n; i++)
    for (let r = 0; r < 2; r++)
      if ((i + r) % 2 === 0)
        cells.push(<rect key={`${i}-${r}`} x={i * sq} y={r * (h / 2)} width={sq} height={h / 2} fill={Bink} />);
  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      {cells}
    </svg>
  );
}

function Stat({
  label,
  big,
  sub,
  accent,
}: {
  label: string;
  big: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 8.5,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: Bmuted,
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 28,
          fontWeight: 800,
          letterSpacing: "-0.025em",
          lineHeight: 1,
          fontVariantNumeric: "tabular-nums",
          color: accent ? Brust : Bink,
        }}
      >
        {big}
      </div>
      {sub ? (
        <div style={{ fontSize: 9, color: Bmuted, marginTop: 4 }}>{sub}</div>
      ) : null}
    </div>
  );
}

function posterRowWeight(text: string, charsPerLine: number): number {
  return Math.max(1, Math.ceil(text.length / charsPerLine));
}

function shouldShowTurnoverNotice(o: JobOrderPosterModel): boolean {
  const worksWeight = o.works.reduce((sum, w) => sum + posterRowWeight(w.name, 42), 0);
  const partsWeight = o.parts.reduce((sum, p) => sum + posterRowWeight(p.name, 38), 0);
  const historyWeight = o.client.history.reduce((sum, h) => sum + posterRowWeight(h.note, 54), 0);
  return worksWeight + partsWeight + historyWeight > 8;
}

function splitWeighted<T>(
  items: T[],
  capacity: number,
  weight: (item: T) => number
): { head: T[]; tail: T[]; used: number } {
  const head: T[] = [];
  const tail: T[] = [];
  let used = 0;
  let overflow = false;

  for (const item of items) {
    const itemWeight = weight(item);
    if (!overflow && (head.length === 0 || used + itemWeight <= capacity)) {
      head.push(item);
      used += itemWeight;
    } else {
      overflow = true;
      tail.push(item);
    }
  }

  return { head, tail, used };
}

function splitPosterContent(o: JobOrderPosterModel) {
  const works = splitWeighted(o.works, 9, (w) => posterRowWeight(w.name, 42));
  const parts = works.tail.length
    ? { head: [] as JobOrderPosterModel["parts"], tail: o.parts, used: 0 }
    : splitWeighted(o.parts, Math.max(0, 9 - works.used), (p) => posterRowWeight(p.name, 38));

  return {
    firstWorks: works.head,
    restWorks: works.tail,
    firstParts: parts.head,
    restParts: parts.tail,
    hasOverflow: works.tail.length > 0 || parts.tail.length > 0,
  };
}

export default function OrderPoster({ data: o }: { data: JobOrderPosterModel }) {
  const split = splitPosterContent(o);
  const hasTurnover = split.hasOverflow || shouldShowTurnoverNotice(o);
  const signatures = (
    <>
      <div
        className="poster-avoid-break"
        style={{
          marginTop: 18,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 28,
          alignItems: "start",
        }}
      >
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.15 }}>
            {o.master.name}
          </div>
          <div
            style={{
              fontSize: 8,
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              color: Bmuted,
              marginTop: 8,
              fontWeight: 600,
            }}
          >
            ИСПОЛНИТЕЛЬ · МАСТЕР
          </div>
          <div style={{ fontSize: 10, color: Bmuted, marginTop: 10, lineHeight: 1.35 }}>
            {posterFooterLifetimeLine(o.client)}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.15 }}>
            {o.client.name}
          </div>
          <div
            style={{
              fontSize: 8,
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              color: Bmuted,
              marginTop: 8,
              fontWeight: 600,
            }}
          >
            ЗАКАЗЧИК · ПИЛОТ
          </div>
          <div style={{ fontSize: 10, color: Bmuted, marginTop: 10, lineHeight: 1.35 }}>
            {o.client.phone} · {posterFooterPilotTripLine(o.client)}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <PosterChess w={B_W - 88} />
      </div>
      <div
        style={{
          marginTop: 6,
          display: "flex",
          justifyContent: "space-between",
          fontSize: 8,
          color: Bmuted,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
        }}
      >
        <span>
          {o.ip.site} · {o.ip.tg}
        </span>
        <span>оформил: {o.ecoUser}</span>
        <span>
          TGM<span style={{ color: Brust }}>.</span>
        </span>
      </div>
    </>
  );

  return (
    <>
      <div
        className="poster-order"
        style={{
          width: B_W,
          height: B_H,
          background: Bpaper,
          color: Bink,
          fontFamily: '"Inter", system-ui, sans-serif',
          position: "relative",
          padding: "44px 44px 28px",
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
      <HexBg w={B_W} h={420} />

      <div style={{ position: "relative" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div
            style={{
              fontSize: 10,
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              color: Bmuted,
              lineHeight: 1.5,
            }}
          >
            <div>наряд</div>
            <div style={{ color: Brust, fontWeight: 700, fontSize: 13, marginTop: 2 }}>№ {o.number}</div>
            <div style={{ marginTop: 6 }}>{o.date.replace(/\./g, " · ")}</div>
          </div>
          <div style={{ textAlign: "right", fontSize: 9.5, color: Bmuted, lineHeight: 1.5 }}>
            <div style={{ color: Bink, fontWeight: 600 }}>{o.ip.name}</div>
            <div>
              ИНН {o.ip.inn} · ОГРН {o.ip.ogrn}
            </div>
            <div>
              {o.ip.phone} · {o.ip.site}
            </div>
          </div>
        </div>

        <div
          style={{
            fontFamily: '"Inter", system-ui, sans-serif',
            fontWeight: 800,
            fontSize: 92,
            lineHeight: 0.86,
            letterSpacing: "-0.045em",
            marginTop: 14,
            color: Bink,
          }}
        >
          {o.car.make.toUpperCase()}
          <br />
          {o.car.model}
        </div>
        <div
          style={{
            marginTop: 8,
            fontSize: 11,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: Bmuted,
            display: "flex",
            gap: 14,
          }}
        >
          <span>{o.car.year}</span>
          <span style={{ color: "rgba(10,10,10,0.25)" }}>·</span>
          <span style={{ fontFamily: 'ui-monospace, "SF Mono", monospace', letterSpacing: "0.04em" }}>
            VIN {o.car.vin}
          </span>
        </div>

        <div style={{ position: "absolute", right: 0, bottom: 6, textAlign: "right" }}>
          <div style={{ fontSize: 9, letterSpacing: "0.2em", textTransform: "uppercase", color: Bmuted }}>
            гос. номер
          </div>
          <div
            style={{
              border: `2px solid ${Bink}`,
              padding: "2px 10px",
              fontSize: 20,
              fontWeight: 700,
              fontVariantNumeric: "tabular-nums",
              marginTop: 4,
              display: "inline-block",
              letterSpacing: "0.04em",
            }}
          >
            {o.car.plate}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 22 }}>
        <PosterChess w={B_W - 88} />
      </div>

      <div
        style={{
          marginTop: 14,
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "8px 12px",
          border: `1px solid ${Brust}`,
          background: "rgba(194,65,12,0.06)",
        }}
      >
        <span
          style={{
            fontSize: 9,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            color: Brust,
            fontWeight: 700,
          }}
        >
          следующий рубеж
        </span>
        <span style={{ fontSize: 12, fontWeight: 700, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.01em" }}>
          {bfmt(o.milestone.value)} км
        </span>
        <span style={{ flex: 1, borderBottom: `1px dotted ${Brust}`, opacity: 0.6 }} />
        <span style={{ fontSize: 10, color: Bmuted }}>осталось</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: Brust, fontVariantNumeric: "tabular-nums" }}>
          {bfmt(o.milestone.leftKm)} км
        </span>
        <span style={{ fontSize: 9, color: Bmuted, marginLeft: 4 }}>· поможем дотянуть</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 18, marginTop: 22 }}>
        <Stat label="Пробег" big={bfmt(o.car.mileage)} sub="км на одометре" />
        <Stat
          label="Сумма"
          big={`${bfmt(o.grandTotal)} ₽`}
          sub={`оплачено · гарантия до ${o.warrantyUntil} (${o.warrantyDays} дней)`}
        />
        <Stat
          label="Следующая замена"
          big={`${bfmt(o.next.mileage)} км`}
          accent
          sub={`или до ${o.next.date} · +${bfmt(o.next.intervalKm)} км / ${o.next.intervalMonths} мес`}
        />
      </div>

      {hasTurnover ? (
        <div
          className="poster-avoid-break"
          style={{
            marginTop: 14,
            padding: "7px 10px",
            border: `1px solid ${Brust}`,
            color: Brust,
            fontSize: 8.5,
            fontWeight: 800,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            textAlign: "center",
            background: "rgba(194,65,12,0.06)",
          }}
        >
          Часть заказ-наряда на оборотной стороне
        </div>
      ) : null}

      <div style={{ height: 1, background: Bink, marginTop: 22 }} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32, marginTop: 18, flex: 1 }}>
        <div>
          <div
            style={{
              fontSize: 9.5,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: Bmuted,
              marginBottom: 10,
            }}
          >
            что сделали — пит-стоп
          </div>
          {o.works.length === 0 ? (
            <div style={{ fontSize: 11, color: Bmuted }}>—</div>
          ) : (
            split.firstWorks.map((w, i) => (
              <div
                key={i}
                className="poster-avoid-break"
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  borderBottom: "1px solid rgba(10,10,10,.12)",
                  padding: "8px 0",
                  fontSize: 11,
                }}
              >
                <div style={{ display: "flex", gap: 10, paddingRight: 10 }}>
                  <span style={{ color: Brust, fontWeight: 700, width: 14 }}>·</span>
                  <span style={{ fontWeight: 500 }}>{w.name}</span>
                </div>
                <span style={{ fontVariantNumeric: "tabular-nums", color: Bmuted, whiteSpace: "nowrap" }}>
                  {w.discount ? <s style={{ marginRight: 6 }}>{bfmt(w.price)}</s> : null}
                  <b style={{ color: w.sum === 0 ? Brust : Bink }}>
                    {w.sum === 0 ? "в подарок" : `${bfmt(w.sum)} ₽`}
                  </b>
                </span>
              </div>
            ))
          )}

          <div
            style={{
              fontSize: 9.5,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: Bmuted,
              marginTop: 18,
              marginBottom: 8,
            }}
          >
            что залили / поставили
          </div>
          {o.parts.length === 0 ? (
            <div style={{ fontSize: 11, color: Bmuted }}>—</div>
          ) : split.firstParts.length > 0 ? (
            split.firstParts.map((p, i) => (
              <div
                key={i}
                className="poster-avoid-break"
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  borderBottom: "1px solid rgba(10,10,10,.12)",
                  padding: "8px 0",
                  fontSize: 11,
                }}
              >
                <div style={{ display: "flex", gap: 10, paddingRight: 10 }}>
                  <span style={{ color: Bmuted, width: 22, fontVariantNumeric: "tabular-nums" }}>×{p.qty}</span>
                  <span style={{ fontWeight: 500 }}>{p.name}</span>
                </div>
                <b style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{bfmt(p.sum)} ₽</b>
              </div>
            ))
          ) : (
            <div style={{ fontSize: 10, color: Bmuted, padding: "8px 0" }}>см. оборотную сторону</div>
          )}

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              marginTop: 14,
              paddingTop: 12,
              borderTop: `2px solid ${Bink}`,
            }}
          >
            <span style={{ fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase", color: Bmuted }}>
              итого
            </span>
            <span
              style={{
                fontSize: 28,
                fontWeight: 800,
                fontVariantNumeric: "tabular-nums",
                letterSpacing: "-0.02em",
              }}
            >
              {bfmt(o.grandTotal)} <span style={{ fontSize: 16 }}>₽</span>
            </span>
          </div>
        </div>

        <div>
          <div
            style={{
              fontSize: 9.5,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: Bmuted,
              marginBottom: 4,
            }}
          >
            бортжурнал
          </div>
          <div style={{ fontSize: 9, color: Bmuted, lineHeight: 1.45, marginBottom: 14 }}>
            {ruTripsIntroLine(o.client.visits, o.client.sinceVisit)}
          </div>
          <div style={{ position: "relative" }}>
            <div
              style={{
                position: "absolute",
                left: 6,
                top: 6,
                bottom: 6,
                width: 1,
                background: "rgba(10,10,10,0.18)",
              }}
            />
            {o.client.history.map((h, i, arr) => {
              const last = i === arr.length - 1;
              const prev = arr[i - 1];
              const deltaKm =
                i > 0 && h.km != null && prev?.km != null ? h.km - (prev.km ?? 0) : null;
              return (
                <div
                  key={i}
                  className="poster-avoid-break"
                  style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "7px 0", position: "relative" }}
                >
                  <span
                    style={{
                      width: 13,
                      height: 13,
                      borderRadius: "50%",
                      background: last ? Brust : Bpaper,
                      border: `2px solid ${last ? Brust : Bink}`,
                      flexShrink: 0,
                      marginTop: 2,
                      position: "relative",
                      zIndex: 1,
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                      <span
                        style={{
                          fontSize: 10.5,
                          fontWeight: 600,
                          fontVariantNumeric: "tabular-nums",
                          letterSpacing: "0.02em",
                        }}
                      >
                        {h.date}
                      </span>
                      <span
                        style={{
                          fontSize: 10,
                          fontVariantNumeric: "tabular-nums",
                          color: last ? Brust : Bink,
                          fontWeight: 500,
                        }}
                      >
                        {h.km != null ? `${bfmt(h.km)} км` : "—"}
                      </span>
                    </div>
                    <div style={{ fontSize: 9, color: Bmuted, marginTop: 1 }}>
                      {deltaKm != null && deltaKm >= 0 ? `+${bfmt(deltaKm)} км · ` : ""}
                      {h.note}
                    </div>
                  </div>
                </div>
              );
            })}
            <div
              className="poster-avoid-break"
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                padding: "7px 0",
                position: "relative",
                opacity: 0.6,
              }}
            >
              <span
                style={{
                  width: 13,
                  height: 13,
                  borderRadius: "50%",
                  background: "transparent",
                  border: `2px dashed ${Bmuted}`,
                  flexShrink: 0,
                  marginTop: 2,
                  position: "relative",
                  zIndex: 1,
                }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontSize: 10.5, fontVariantNumeric: "tabular-nums", letterSpacing: "0.02em", color: Bmuted }}>
                    ждём {o.next.date}
                  </span>
                  <span style={{ fontSize: 10, fontVariantNumeric: "tabular-nums", color: Bmuted }}>
                    {bfmt(o.next.mileage)} км
                  </span>
                </div>
                <div style={{ fontSize: 9, color: Bmuted, marginTop: 1 }}>
                  следующая замена — +{bfmt(o.next.intervalKm)} км / {o.next.intervalMonths} мес
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        className="poster-avoid-break"
        style={{
          marginTop: 14,
          padding: "10px 14px",
          border: `1px solid ${Bink}`,
          background: "rgba(10,10,10,0.04)",
          display: "grid",
          gridTemplateColumns: "110px 1fr",
          gap: 14,
          alignItems: "start",
        }}
      >
        <div>
          <div style={{ fontSize: 8.5, letterSpacing: "0.2em", textTransform: "uppercase", color: Bmuted }}>
            гарантия
          </div>
          <div
            style={{
              fontSize: 22,
              fontWeight: 800,
              color: Brust,
              lineHeight: 1,
              marginTop: 4,
              letterSpacing: "-0.02em",
            }}
          >
            {o.warrantyDays} дней
          </div>
          <div style={{ fontSize: 9, color: Bmuted, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>
            до {o.warrantyUntil}
          </div>
        </div>
        <div style={{ fontSize: 7.5, lineHeight: 1.45, color: Bink }}>
          Исполнитель гарантирует корректное выполнение работ. Замена масла и технических жидкостей является
          обслуживанием, а не ремонтом агрегатов. Гарантия не распространяется на техническое состояние автомобиля, износ,
          скрытые неисправности, материалы Заказчика и последствия отказа от рекомендованных работ. Полные условия гарантии
          размещены в гарантийном регламенте и являются частью настоящего заказ-наряда. С условиями ознакомлен, работы
          принял, претензий не имею.
        </div>
      </div>

        {!hasTurnover ? signatures : null}
      </div>

      {hasTurnover ? (
        <div
          className="poster-order"
          style={{
            width: B_W,
            height: B_H,
            background: Bpaper,
            color: Bink,
            fontFamily: '"Inter", system-ui, sans-serif',
            position: "relative",
            padding: "44px 44px 28px",
            boxSizing: "border-box",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <HexBg w={B_W} h={260} />
          <div
            style={{
              position: "relative",
              fontSize: 8.5,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: Brust,
              fontWeight: 800,
              marginBottom: 24,
            }}
          >
            оборотная сторона заказ-наряда № {o.number}
          </div>
          {split.restWorks.length > 0 ? (
            <div className="poster-avoid-break" style={{ position: "relative", marginBottom: 18 }}>
              <div
                style={{
                  fontSize: 9.5,
                  letterSpacing: "0.2em",
                  textTransform: "uppercase",
                  color: Bmuted,
                  marginBottom: 10,
                }}
              >
                продолжение работ
              </div>
              {split.restWorks.map((w, i) => (
                <div
                  key={i}
                  className="poster-avoid-break"
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    borderBottom: "1px solid rgba(10,10,10,.12)",
                    padding: "8px 0",
                    fontSize: 11,
                  }}
                >
                  <div style={{ display: "flex", gap: 10, paddingRight: 10 }}>
                    <span style={{ color: Brust, fontWeight: 700, width: 14 }}>·</span>
                    <span style={{ fontWeight: 500 }}>{w.name}</span>
                  </div>
                  <span style={{ fontVariantNumeric: "tabular-nums", color: Bmuted, whiteSpace: "nowrap" }}>
                    {w.discount ? <s style={{ marginRight: 6 }}>{bfmt(w.price)}</s> : null}
                    <b style={{ color: w.sum === 0 ? Brust : Bink }}>
                      {w.sum === 0 ? "в подарок" : `${bfmt(w.sum)} ₽`}
                    </b>
                  </span>
                </div>
              ))}
            </div>
          ) : null}
          {split.restParts.length > 0 ? (
            <div className="poster-avoid-break" style={{ position: "relative", marginBottom: 18 }}>
              <div
                style={{
                  fontSize: 9.5,
                  letterSpacing: "0.2em",
                  textTransform: "uppercase",
                  color: Bmuted,
                  marginBottom: 10,
                }}
              >
                продолжение товаров
              </div>
              {split.restParts.map((p, i) => (
                <div
                  key={i}
                  className="poster-avoid-break"
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    borderBottom: "1px solid rgba(10,10,10,.12)",
                    padding: "8px 0",
                    fontSize: 11,
                  }}
                >
                  <div style={{ display: "flex", gap: 10, paddingRight: 10 }}>
                    <span style={{ color: Bmuted, width: 22, fontVariantNumeric: "tabular-nums" }}>×{p.qty}</span>
                    <span style={{ fontWeight: 500 }}>{p.name}</span>
                  </div>
                  <b style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{bfmt(p.sum)} ₽</b>
                </div>
              ))}
            </div>
          ) : null}
          {signatures}
        </div>
      ) : null}
    </>
  );
}
