import Link from "next/link";
import { Download, Filter, Plus, Printer, Search, SlidersHorizontal, X } from "lucide-react";
import { EcoBadge } from "@/components/platform/EcoUI";
import { requireActiveShiftAccess } from "@/lib/app-access";
import { formatServiceDate, formatServiceTime } from "@/lib/date-time";
import { loadLocalDemandList } from "@/lib/local-inventory-read";
import { ShipmentListRow } from "./ShipmentListRow";
import { ShipmentRowActions } from "./ShipmentRowActions";

type DemandAgent = {
  id?: string;
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
    date: formatServiceDate(date),
    time: formatServiceTime(date),
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

function attributeText(row: DemandRow, matches: (name: string) => boolean): string {
  for (const attr of row.attributes ?? []) {
    const name = (attr.name ?? "").trim().toLowerCase();
    if (!matches(name)) continue;
    const value = attr.value;
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
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
  return "";
}

function getVehicleDisplay(row: DemandRow): { primary: string; secondary: string; title: string } {
  const model = attributeText(row, (name) => /модель|марка|vehicle|car|авто/i.test(name) && !/гос|номер|vin|вин|масло/i.test(name));
  const plate = getPlateDisplay(row);
  const vin = attributeText(row, (name) => /vin|вин/i.test(name)).replace(/\s/g, "").toUpperCase();
  const secondary = plate || (vin ? `VIN ${vin}` : "");
  const primary = model || secondary || "автомобиль не указан";
  const title = model
    ? [model, plate, !plate && vin ? `VIN ${vin}` : plate && vin ? vin : ""].filter(Boolean).join(" · ")
    : primary;
  return {
    primary,
    secondary: model ? secondary : "",
    title,
  };
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

function localCounterpartyIdFromMeta(meta?: { href?: string }): string {
  const href = meta?.href?.trim() ?? "";
  if (!href) return "";
  const localMatch = href.match(/^local:\/\/[^/]+\/([^/?#]+)/i);
  if (localMatch?.[1]) return decodeURIComponent(localMatch[1]);
  const entityMatch = href.match(/\/entity\/counterparty\/([^/?#]+)/i);
  return entityMatch?.[1] ? decodeURIComponent(entityMatch[1]) : "";
}

function counterpartyCatalogHref(row: DemandRow): string | null {
  const id = row.agent?.id?.trim() || localCounterpartyIdFromMeta(row.agent?.meta);
  if (id) return `/clients/counterparties?counterparty=${encodeURIComponent(id)}`;
  const name = getCounterpartyDisplay(row);
  if (!name || name === "—") return null;
  return `/clients/counterparties?search=${encodeURIComponent(name)}`;
}

async function loadShipmentList(opts: {
  search: string;
  counterparty: string;
  plate: string;
  phone: string;
  dateFrom: string;
  dateTo: string;
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

function normalizeDateParam(value?: string): string {
  const raw = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

function yearRange(year: number): { dateFrom: string; dateTo: string } {
  return { dateFrom: `${year}-01-01`, dateTo: `${year}-12-31` };
}

function periodLabel(dateFrom: string, dateTo: string): string {
  if (!dateFrom && !dateTo) return "все годы";
  const yearFrom = dateFrom.match(/^(\d{4})-01-01$/)?.[1];
  const yearTo = dateTo.match(/^(\d{4})-12-31$/)?.[1];
  if (yearFrom && yearFrom === yearTo) return `${yearFrom} год`;
  if (dateFrom && dateTo) return `${dateFrom} — ${dateTo}`;
  if (dateFrom) return `с ${dateFrom}`;
  return `до ${dateTo}`;
}

function shipmentNumberLabel(name: string): string {
  const clean = name.trim();
  const numeric = clean.match(/^\d+$/)?.[0] ?? clean.match(/-(\d+)$/)?.[1] ?? "";
  return numeric ? numeric.padStart(4, "0") : clean;
}

function listQuery(
  search: string,
  counterparty: string,
  plate: string,
  phone: string,
  dateFrom: string,
  dateTo: string,
  offset: number
): string {
  const p = new URLSearchParams();
  if (search) p.set("search", search);
  if (counterparty) p.set("counterparty", counterparty);
  if (plate) p.set("plate", plate);
  if (phone) p.set("phone", phone);
  if (dateFrom) p.set("dateFrom", dateFrom);
  if (dateTo) p.set("dateTo", dateTo);
  if (offset > 0) p.set("offset", String(offset));
  const s = p.toString();
  return s ? `?${s}` : "";
}

function ShipmentMobileCard({
  row,
  moment,
  counterpartyName,
  counterpartyHref,
  vehiclePrimary,
  vehicleSecondary,
  vehicleTitle,
  ecoUserName,
  sumLabel,
}: {
  row: DemandRow;
  moment: { date: string; time: string };
  counterpartyName: string;
  counterpartyHref: string | null;
  vehiclePrimary: string;
  vehicleSecondary: string;
  vehicleTitle: string;
  ecoUserName: string;
  sumLabel: string;
}) {
  const href = `/shipment/${row.id}`;
  const numberLabel = shipmentNumberLabel(row.name);

  return (
    <article className="eco-shipment-mobile-card">
      <div className="eco-shipment-mobile-card__top">
        <div>
          <Link href={href} className="l-mono eco-shipment-list-number-link">
            {numberLabel}
          </Link>
          <div className="l-mono eco-shipment-list-subtext">
            {moment.date} · {moment.time}
          </div>
        </div>
        <div className="l-money eco-shipment-mobile-card__sum">{sumLabel}</div>
      </div>

      <div className="eco-shipment-mobile-card__grid">
        <div className="eco-shipment-mobile-field">
          <span>Клиент</span>
          {counterpartyHref ? (
            <Link
              href={counterpartyHref}
              className="eco-shipment-list-counterparty-link"
              title="Открыть контрагента"
            >
              {counterpartyName}
            </Link>
          ) : (
            <strong>{counterpartyName}</strong>
          )}
        </div>
        <div className="eco-shipment-mobile-field" title={vehicleTitle}>
          <span>Авто</span>
          <strong>{vehiclePrimary}</strong>
          {vehicleSecondary && <em>{vehicleSecondary}</em>}
        </div>
        <div className="eco-shipment-mobile-field">
          <span>Склад</span>
          <strong>{row.store?.name ?? "—"}</strong>
        </div>
        <div className="eco-shipment-mobile-field">
          <span>Создал</span>
          <strong>{ecoUserName}</strong>
        </div>
      </div>

      <div className="eco-shipment-mobile-card__foot">
        <div className="eco-shipment-mobile-card__badges">
          <EcoBadge tone={row.applicable ? "success" : "neutral"} dot>
            {row.applicable ? "Проведено" : "Черновик"}
          </EcoBadge>
          <EcoBadge tone={row.sum > 0 ? "success" : "warning"} dot>
            {row.sum > 0 ? "Оплачено" : "Не оплачено"}
          </EcoBadge>
        </div>
        <div className="eco-shipment-mobile-card__actions" data-row-action>
          <ShipmentRowActions shipmentId={row.id} />
        </div>
      </div>
    </article>
  );
}

export default async function ShipmentListPage({
  searchParams,
}: {
  searchParams: Promise<{
    search?: string;
    counterparty?: string;
    plate?: string;
    phone?: string;
    dateFrom?: string;
    dateTo?: string;
    offset?: string;
  }>;
}) {
  await requireActiveShiftAccess("/shipment");

  const sp = await searchParams;
  const search = (sp.search ?? "").trim();
  const counterparty = (sp.counterparty ?? "").trim();
  const plate = (sp.plate ?? "").trim();
  const phone = (sp.phone ?? "").trim();
  const dateFrom = normalizeDateParam(sp.dateFrom);
  const dateTo = normalizeDateParam(sp.dateTo);
  const offset = Math.max(0, parseInt(sp.offset ?? "0", 10) || 0);
  const limit = 50;
  const currentYear = new Date().getFullYear();
  const quickYears = [currentYear, currentYear - 1, currentYear - 2];
  const hasFilters = Boolean(search || counterparty || plate || phone || dateFrom || dateTo || offset > 0);

  const result = await loadShipmentList({ search, counterparty, plate, phone, dateFrom, dateTo, offset, limit });
  const sourceLabel = "Отгрузки из локальной БД";
  const rows = result.ok ? result.data.rows ?? [] : [];
  const postedCount = rows.filter((row) => row.applicable).length;
  const draftCount = rows.length - postedCount;
  const totalSum = rows.reduce((sum, row) => sum + (row.sum || 0), 0);
  const emptyMessage = dateFrom || dateTo
    ? `За период ${periodLabel(dateFrom, dateTo)} отгрузки не найдены. Если это старые документы 2025/2024 года, возможно, нужен полный импорт отгрузок из МойСклад.`
    : "Ничего не найдено";

  return (
    <main className="eco-page eco-shipment-page">
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
        <input name="dateFrom" type="date" defaultValue={dateFrom} className="eco-input max-w-[150px]" aria-label="Дата с" />
        <input name="dateTo" type="date" defaultValue={dateTo} className="eco-input max-w-[150px]" aria-label="Дата по" />
        <button type="submit" className="eco-pill">
          <Filter aria-hidden className="eco-icon" />
          Найти
        </button>
        {hasFilters && (
          <Link href="/shipment" className="eco-pill is-active">
            Сбросить <X aria-hidden className="eco-icon" />
          </Link>
        )}
        <span className="eco-pill">Период · {periodLabel(dateFrom, dateTo)}</span>
        {quickYears.map((year) => {
          const range = yearRange(year);
          const active = dateFrom === range.dateFrom && dateTo === range.dateTo;
          return (
            <Link
              key={year}
              href={`/shipment${listQuery(search, counterparty, plate, phone, range.dateFrom, range.dateTo, 0)}`}
              className={`eco-pill ${active ? "is-active" : ""}`}
            >
              {year}
            </Link>
          );
        })}
        {(dateFrom || dateTo) && (
          <Link href={`/shipment${listQuery(search, counterparty, plate, phone, "", "", 0)}`} className="eco-pill">
            Все годы
          </Link>
        )}
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
            <div className="eco-shipment-mobile-list" aria-label="Список отгрузок">
              {rows.map((r) => {
                const moment = formatMoment(r.moment);
                const counterpartyName = getCounterpartyDisplay(r);
                const counterpartyHref = counterpartyCatalogHref(r);
                const vehicle = getVehicleDisplay(r);
                return (
                  <ShipmentMobileCard
                    key={r.id}
                    row={r}
                    moment={moment}
                    counterpartyName={counterpartyName}
                    counterpartyHref={counterpartyHref}
                    vehiclePrimary={vehicle.primary}
                    vehicleSecondary={vehicle.secondary}
                    vehicleTitle={vehicle.title}
                    ecoUserName={getEcoUserName(r) ?? "—"}
                    sumLabel={`${rubles(r.sum)} ₽`}
                  />
                );
              })}
              {rows.length === 0 && (
                <div className="eco-shipment-mobile-empty">
                  {emptyMessage}
                </div>
              )}
            </div>
            <table className="eco-table eco-shipment-list-table">
              <thead>
                <tr>
                  <th style={{ width: 36 }}><span className="eco-check" /></th>
                  <th>№</th>
                  <th>Клиент</th>
                  <th>Авто / гос. номер</th>
                  <th>Склад</th>
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
                  const vehicle = getVehicleDisplay(r);
                  return (
                    <ShipmentListRow
                      key={r.id}
                      row={r}
                      moment={moment}
                      counterpartyName={counterpartyName}
                      counterpartyHref={counterpartyHref}
                      vehiclePrimary={vehicle.primary}
                      vehicleSecondary={vehicle.secondary}
                      vehicleTitle={vehicle.title}
                      ecoUserName={getEcoUserName(r) ?? "—"}
                      sumLabel={`${rubles(r.sum)} ₽`}
                    />
                  );
                })}
                {rows.length === 0 && (
                  <tr className="eco-shipment-list-empty-row">
                    <td colSpan={10} style={{ color: "var(--eco-muted)", padding: 32, textAlign: "center" }}>
                      {emptyMessage}
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
                href={`/shipment${listQuery(search, counterparty, plate, phone, dateFrom, dateTo, Math.max(0, offset - limit))}`}
                className={`eco-btn eco-btn--sm ${
                  offset <= 0
                    ? "pointer-events-none opacity-50"
                    : ""
                }`}
              >
                ← Назад
              </Link>
              <Link
                href={`/shipment${listQuery(search, counterparty, plate, phone, dateFrom, dateTo, offset + limit)}`}
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
