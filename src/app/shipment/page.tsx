import Link from "next/link";
import { Download, Filter, Plus, Printer, Search, SlidersHorizontal, X } from "lucide-react";
import { EcoBadge } from "@/components/platform/EcoUI";
import { requireActiveShiftAccess } from "@/lib/app-access";
import { loadLocalDemandList } from "@/lib/local-inventory-read";
import { ShipmentRowActions } from "./ShipmentRowActions";

type DemandAgent = {
  name?: string;
  meta?: { href?: string };
};

type DemandRow = {
  id: string;
  name: string;
  moment: string;
  applicable: boolean;
  sum: number;
  description?: string;
  agent?: DemandAgent;
  organization?: { name?: string };
  store?: { name?: string };
  meta?: { href?: string };
  attributes?: { id?: string; name?: string; value?: unknown }[];
};

type ListOk = {
  meta: { size: number; limit: number; offset: number };
  rows: DemandRow[];
};

function rubles(sumKopecks: number): string {
  const v = (sumKopecks || 0) / 100;
  return v.toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function formatMoment(value: string): { date: string; time: string } {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: value, time: "—" };
  return {
    date: date.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" }),
    time: date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }),
  };
}

function getEcoUserName(row: DemandRow): string | undefined {
  const attrs = row.attributes ?? [];
  const attr = attrs.find(
    (a) => typeof a?.name === "string" && a.name.trim().toLowerCase() === "эко пользователь"
  );
  const v = attr?.value;
  if (typeof v === "string") return v;
  if (v == null) return undefined;
  return String(v);
}

function isPlateAttributeName(name: string | undefined): boolean {
  const n = (name ?? "").toLowerCase();
  return /гос|г\/н|госномер|г\.\s*н|номер\s*(тс|а\/м|авто)|state\s*reg|plate/i.test(n);
}

function getPlateDisplay(row: DemandRow): string {
  const attrs = row.attributes ?? [];
  const attrId = process.env.MOYSKLAD_DEMAND_PLATE_ATTRIBUTE_ID?.trim();
  if (attrId) {
    const hit = attrs.find((a) => a.id === attrId);
    const v = hit?.value;
    if (v !== undefined && v !== null && v !== "") return String(v);
  }
  for (const a of attrs) {
    if (isPlateAttributeName(a.name)) {
      const v = a.value;
      if (v !== undefined && v !== null && v !== "") return String(v);
    }
  }
  return "—";
}

/** Контрагент в колонке: стандартный agent или типичные доп. поля, если agent пустой. */
function getCounterpartyDisplay(row: DemandRow): string {
  const n = row.agent?.name?.trim();
  if (n) return n;
  for (const a of row.attributes ?? []) {
    const label = (a.name ?? "").trim().toLowerCase();
    if (/^(контрагент|клиент|заказчик|покупатель)(\s|$)/.test(label)) {
      const v = a.value;
      if (v != null && String(v).trim()) return String(v).trim();
    }
  }
  return "—";
}

function counterpartyCatalogHref(row: DemandRow): string | null {
  const name = getCounterpartyDisplay(row);
  if (!name || name === "—") return null;
  return `/clients/counterparties?search=${encodeURIComponent(name)}`;
}

async function loadShipmentList(opts: {
  search: string;
  counterparty: string;
  plate: string;
  phone: string;
  offset: number;
  limit: number;
}): Promise<{ ok: true; data: ListOk } | { ok: false; error: string }> {
  try {
    const data = await loadLocalDemandList(opts);
    return { ok: true, data };
  } catch (e) {
    console.error("[shipment] local inventory read failed:", e);
    return { ok: false, error: "Не удалось загрузить локальные отгрузки" };
  }
}

function listQuery(search: string, counterparty: string, plate: string, phone: string, offset: number): string {
  const p = new URLSearchParams();
  if (search) p.set("search", search);
  if (counterparty) p.set("counterparty", counterparty);
  if (plate) p.set("plate", plate);
  if (phone) p.set("phone", phone);
  if (offset > 0) p.set("offset", String(offset));
  const s = p.toString();
  return s ? `?${s}` : "";
}

export default async function ShipmentListPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; counterparty?: string; plate?: string; phone?: string; offset?: string }>;
}) {
  await requireActiveShiftAccess("/shipment");

  const sp = await searchParams;
  const search = (sp.search ?? "").trim();
  const counterparty = (sp.counterparty ?? "").trim();
  const plate = (sp.plate ?? "").trim();
  const phone = (sp.phone ?? "").trim();
  const offset = Math.max(0, parseInt(sp.offset ?? "0", 10) || 0);
  const limit = 50;

  const result = await loadShipmentList({ search, counterparty, plate, phone, offset, limit });
  const sourceLabel = "Отгрузки из локальной БД";
  const rows = result.ok ? result.data.rows ?? [] : [];
  const postedCount = rows.filter((row) => row.applicable).length;
  const draftCount = rows.length - postedCount;
  const totalSum = rows.reduce((sum, row) => sum + (row.sum || 0), 0);

  return (
    <main className="eco-page">
      <div className="eco-page-head">
        <div>
          <div className="eco-page-kicker">
            <Link href="/">Главная</Link>
            <span className="mx-2 text-[var(--eco-faint)]">/</span>
            <span>Операции / Отгрузки</span>
          </div>
          <h1 className="eco-page-title">Отгрузки</h1>
        </div>
        <div className="eco-actions">
          <button type="button" className="eco-btn">
            <Download aria-hidden className="eco-icon" />
            Выгрузить
          </button>
          <Link href="/shipment/new" className="eco-btn eco-btn--primary">
            <Plus aria-hidden className="eco-icon" />
            Новая отгрузка
          </Link>
        </div>
      </div>

      <div className="eco-tabs">
        {[
          ["Все", result.ok ? result.data.meta.size : 0, true],
          ["Черновики", draftCount, false],
          ["Проведено", postedCount, false],
          ["Возвраты", 0, false],
        ].map(([label, count, active]) => (
          <span key={String(label)} className={`eco-tab ${active ? "is-active" : ""}`}>
            {label}
            <span className="eco-tab__count">{count}</span>
          </span>
        ))}
      </div>

      <form action="/shipment" method="GET" className="eco-filter-bar">
        <div className="eco-search-wrap">
          <Search aria-hidden className="eco-icon" />
          <input
            name="search"
            defaultValue={search}
            placeholder="№, клиент, телефон, VIN…"
            className="eco-input"
          />
        </div>
        <input name="counterparty" defaultValue={counterparty} placeholder="Клиент" className="eco-input max-w-[170px]" />
        <input name="plate" defaultValue={plate} placeholder="Гос. номер" className="eco-input max-w-[140px] font-mono uppercase" />
        <input name="phone" defaultValue={phone} placeholder="Телефон" className="eco-input max-w-[150px]" />
        <button type="submit" className="eco-pill">
          <Filter aria-hidden className="eco-icon" />
          Найти
        </button>
        {(search || counterparty || plate || phone || offset > 0) && (
          <Link href="/shipment" className="eco-pill is-active">
            Сбросить <X aria-hidden className="eco-icon" />
          </Link>
        )}
        <span className="eco-pill">Период · сегодня</span>
        <span className="eco-pill is-dashed">
          <Plus aria-hidden className="eco-icon" />
          Ещё фильтр
        </span>
        <div className="grow" />
        <div className="eco-seg">
          <span className="eco-seg-btn is-active">Comfortable</span>
          <span className="eco-seg-btn">Compact</span>
        </div>
      </form>

      {!result.ok ? (
        <div className="eco-card eco-card--padded text-sm text-[var(--eco-danger)]">
          Ошибка локальной БД: {result.error}
        </div>
      ) : (
        <>
          <div className="eco-table-wrap">
            <div className="eco-table-toolbar">
              <span className="l-meta">
                {rows.length} строк · сумма {rubles(totalSum)} ₽ · {sourceLabel}
              </span>
              <div className="grow" />
              <button type="button" className="eco-btn eco-btn--ghost eco-btn--sm">
                <Printer aria-hidden className="eco-icon" />
                Печать списка
              </button>
              <button type="button" className="eco-btn eco-btn--ghost eco-btn--sm">
                <SlidersHorizontal aria-hidden className="eco-icon" />
                Колонки
              </button>
            </div>
            <table className="eco-table">
              <thead>
                <tr>
                  <th style={{ width: 36 }}><span className="eco-check" /></th>
                  <th>№ / дата</th>
                  <th>Клиент</th>
                  <th>Авто / гос. номер</th>
                  <th>Организация / склад</th>
                  <th>Создал</th>
                  <th>Статус</th>
                  <th>Оплата</th>
                  <th style={{ textAlign: "right" }}>Сумма</th>
                  <th style={{ width: 96 }} />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const moment = formatMoment(r.moment);
                  const counterpartyName = getCounterpartyDisplay(r);
                  const counterpartyHref = counterpartyCatalogHref(r);
                  return (
                  <tr key={r.id}>
                    <td><span className="eco-check" /></td>
                    <td>
                      <Link href={`/shipment/${r.id}`} className="l-mono" style={{ color: "var(--eco-ink)", fontWeight: 600 }}>
                        {r.name}
                      </Link>
                      <div className="l-mono" style={{ color: "var(--eco-muted)", fontSize: 11, marginTop: 2 }}>
                        {moment.date} · {moment.time}
                      </div>
                    </td>
                    <td>
                      {counterpartyHref ? (
                        <Link
                          href={counterpartyHref}
                          className="eco-shipment-list-counterparty-link"
                          title="Открыть контрагента"
                        >
                          {counterpartyName}
                        </Link>
                      ) : (
                        <div style={{ color: "var(--eco-ink)", fontWeight: 500 }}>{counterpartyName}</div>
                      )}
                      <div className="l-mono" style={{ color: "var(--eco-muted)", fontSize: 11, marginTop: 2 }}>телефон в карточке клиента</div>
                    </td>
                    <td>
                      <div style={{ color: "var(--eco-ink-2)" }}>—</div>
                      <div className="l-mono" style={{ color: "var(--eco-muted)", fontSize: 11, marginTop: 2 }}>{getPlateDisplay(r)}</div>
                    </td>
                    <td>
                      <div>{r.organization?.name ?? "—"}</div>
                      <div style={{ color: "var(--eco-muted)", fontSize: 11, marginTop: 2 }}>{r.store?.name ?? "—"}</div>
                    </td>
                    <td>{getEcoUserName(r) ?? "—"}</td>
                    <td>
                      <EcoBadge tone={r.applicable ? "success" : "neutral"} dot>
                        {r.applicable ? "Проведено" : "Черновик"}
                      </EcoBadge>
                    </td>
                    <td>
                      <EcoBadge tone={r.sum > 0 ? "success" : "warning"} dot>
                        {r.sum > 0 ? "Оплачено" : "Не оплачено"}
                      </EcoBadge>
                    </td>
                    <td className="l-money" style={{ color: "var(--eco-ink)", fontWeight: 600, textAlign: "right" }}>
                      {rubles(r.sum)} ₽
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <div className="eco-row-actions">
                        <ShipmentRowActions shipmentId={r.id} />
                      </div>
                    </td>
                  </tr>
                );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={10} style={{ color: "var(--eco-muted)", padding: 32, textAlign: "center" }}>
                      Ничего не найдено
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3 text-sm text-[var(--eco-muted)]">
            <div>
              Показано: {Math.min(limit, result.data.rows?.length ?? 0)} / {result.data.meta.size}
            </div>
            <div className="flex gap-2">
              <Link
                href={`/shipment${listQuery(search, counterparty, plate, phone, Math.max(0, offset - limit))}`}
                className={`eco-btn eco-btn--sm ${
                  offset <= 0
                    ? "pointer-events-none opacity-50"
                    : ""
                }`}
              >
                ← Назад
              </Link>
              <Link
                href={`/shipment${listQuery(search, counterparty, plate, phone, offset + limit)}`}
                className={`eco-btn eco-btn--sm ${
                  offset + limit >= result.data.meta.size
                    ? "pointer-events-none opacity-50"
                    : ""
                }`}
              >
                Вперёд →
              </Link>
            </div>
          </div>
        </>
      )}
    </main>
  );
}
