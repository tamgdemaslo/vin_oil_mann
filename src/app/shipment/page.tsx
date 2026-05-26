import Link from "next/link";
import { Download, Filter, Plus, Printer, Search, SlidersHorizontal, X } from "lucide-react";
import { EcoBadge } from "@/components/platform/EcoUI";
import { requireActiveShiftAccess } from "@/lib/app-access";
import { hasLocalInventoryDemands, isLocalInventoryReadsEnabled, loadLocalDemandList } from "@/lib/local-inventory-read";
import { moyskladFetch } from "@/lib/moysklad";
import {
  listRawPhonesFromCounterparty,
  normalizePhoneKey,
  type CounterpartyPhoneSource,
} from "@/lib/phone-normalize";
import { ShipmentRowActions } from "./ShipmentRowActions";

type DemandAgent = {
  name?: string;
  meta?: { href?: string };
} & NonNullable<CounterpartyPhoneSource>;

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

const DEMAND_EXPAND = "agent,agent.contactpersons,organization,store,attributes";

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

function normalizePlate(s: string): string {
  const lookalikes: Record<string, string> = {
    А: "A",
    В: "B",
    Е: "E",
    К: "K",
    М: "M",
    Н: "H",
    О: "O",
    Р: "P",
    С: "C",
    Т: "T",
    У: "Y",
    Х: "X",
  };
  return s
    .toUpperCase()
    .replace(/[АВЕКМНОРСТУХ]/g, (ch) => lookalikes[ch] ?? ch)
    .replace(/[^A-ZА-ЯЁ0-9]/g, "");
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

function counterpartyHaystack(row: DemandRow): string {
  const parts: string[] = [];
  if (row.agent?.name) parts.push(row.agent.name);
  for (const a of row.attributes ?? []) {
    const label = (a.name ?? "").toLowerCase();
    if (/контрагент|клиент|заказчик|покупател|фио|организация\s*заказ/i.test(label)) {
      parts.push(String(a.value ?? ""));
    }
  }
  return parts.join(" ").toLowerCase();
}

/** Только доп. поля госномера — без номера документа и прочих атрибутов, чтобы «735» не ловило чужие значения. */
function plateHaystack(row: DemandRow): string {
  const parts: string[] = [];
  const attrId = process.env.MOYSKLAD_DEMAND_PLATE_ATTRIBUTE_ID?.trim();
  for (const a of row.attributes ?? []) {
    if ((attrId && a.id === attrId) || isPlateAttributeName(a.name)) {
      parts.push(String(a.value ?? ""));
    }
  }
  return normalizePlate(parts.join(" "));
}

function matchesPlate(row: DemandRow, plateNorm: string): boolean {
  if (!plateNorm) return true;
  const display = getPlateDisplay(row);
  if (display !== "—" && normalizePlate(display).includes(plateNorm)) return true;
  return plateHaystack(row).includes(plateNorm);
}

function matchesCounterparty(row: DemandRow, q: string): boolean {
  if (!q.trim()) return true;
  return counterpartyHaystack(row).includes(q.trim().toLowerCase());
}

function matchesDocSearch(row: DemandRow, q: string): boolean {
  if (!q.trim()) return true;
  const s = q.trim().toLowerCase();
  const name = (row.name ?? "").toLowerCase();
  const desc = (row.description ?? "").toLowerCase();
  return name.includes(s) || desc.includes(s);
}

function phoneKeyVariants(phoneKey: string): string[] {
  const variants = new Set([phoneKey]);
  if (/^7\d{10}$/.test(phoneKey)) variants.add(`8${phoneKey.slice(1)}`);
  if (/^8\d{10}$/.test(phoneKey)) variants.add(`7${phoneKey.slice(1)}`);
  if (phoneKey.length >= 10) variants.add(phoneKey.slice(-10));
  return [...variants];
}

function rawTextMatchesPhone(value: unknown, phoneKey: string): boolean {
  const raw = String(value ?? "").trim();
  if (!raw) return false;
  if (normalizePhoneKey(raw) === phoneKey) return true;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return false;
  return phoneKeyVariants(phoneKey).some((variant) => digits.includes(variant));
}

function matchesPhone(row: DemandRow, phoneKey: string): boolean {
  if (!phoneKey) return true;
  const candidates: unknown[] = [...listRawPhonesFromCounterparty(row.agent)];
  if (row.description) candidates.push(row.description);
  for (const a of row.attributes ?? []) {
    const label = (a.name ?? "").toLowerCase();
    if (/телефон|phone|контакт/i.test(label)) candidates.push(a.value);
  }
  return candidates.some((value) => rawTextMatchesPhone(value, phoneKey));
}

function dedupeDemands(rows: DemandRow[]): DemandRow[] {
  const map = new Map<string, DemandRow>();
  for (const r of rows) {
    if (!map.has(r.id)) map.set(r.id, r);
  }
  return [...map.values()].sort((a, b) => String(b.moment).localeCompare(String(a.moment)));
}

async function collectRecentDemands(maxRows: number): Promise<{ ok: true; rows: DemandRow[] } | { ok: false; error: string }> {
  const out: DemandRow[] = [];
  const pageSize = 100;

  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const limit = Math.min(pageSize, maxRows - offset);
    const res = await moyskladFetch<ListOk>(
      `/entity/demand?limit=${limit}&offset=${offset}&order=moment,desc&expand=${DEMAND_EXPAND}`,
      { cache: "no-store" }
    );
    if (!res.ok) return res;
    out.push(...(res.data.rows ?? []));
    if ((res.data.rows?.length ?? 0) < limit || offset + limit >= res.data.meta.size) break;
  }

  return { ok: true, rows: dedupeDemands(out) };
}

async function collectDemandsByPlate(plate: string): Promise<{ ok: true; rows: DemandRow[] } | { ok: false; error: string }> {
  const out: DemandRow[] = [];

  const bySearch = await moyskladFetch<{ rows: DemandRow[] }>(
    `/entity/demand?search=${encodeURIComponent(plate)}&limit=450&order=moment,desc&expand=${DEMAND_EXPAND}`,
    { cache: "no-store" }
  );
  if (bySearch.ok) out.push(...(bySearch.data.rows ?? []));

  const scanLimit = Math.max(100, parseInt(process.env.MOYSKLAD_PLATE_SEARCH_SCAN_LIMIT ?? "1200", 10) || 1200);
  const recent = await collectRecentDemands(scanLimit);
  if (!recent.ok && !bySearch.ok) return recent;
  if (recent.ok) out.push(...recent.rows);

  return { ok: true, rows: dedupeDemands(out) };
}

async function collectDemandsByCounterparty(counterparty: string): Promise<DemandRow[]> {
  const out: DemandRow[] = [];
  const push = (rows: DemandRow[]) => out.push(...rows);

  const bySearch = await moyskladFetch<{ rows: DemandRow[] }>(
    `/entity/demand?search=${encodeURIComponent(counterparty)}&limit=300&order=moment,desc&expand=${DEMAND_EXPAND}`
  );
  if (bySearch.ok) push(bySearch.data.rows ?? []);

  const cpList = await moyskladFetch<{ rows: { meta?: { href?: string } }[] }>(
    `/entity/counterparty?search=${encodeURIComponent(counterparty)}&limit=15`
  );
  if (cpList.ok) {
    for (const row of cpList.data.rows ?? []) {
      const href = row.meta?.href;
      if (!href) continue;
      const res = await moyskladFetch<{ rows: DemandRow[] }>(
        `/entity/demand?filter=${encodeURIComponent(`agent=${href}`)}&limit=80&order=moment,desc&expand=${DEMAND_EXPAND}`
      );
      if (res.ok) push(res.data.rows ?? []);
    }
  }

  const orgList = await moyskladFetch<{ rows: { meta?: { href?: string } }[] }>(
    `/entity/organization?search=${encodeURIComponent(counterparty)}&limit=8`
  );
  if (orgList.ok) {
    for (const row of orgList.data.rows ?? []) {
      const href = row.meta?.href;
      if (!href) continue;
      const res = await moyskladFetch<{ rows: DemandRow[] }>(
        `/entity/demand?filter=${encodeURIComponent(`agent=${href}`)}&limit=80&order=moment,desc&expand=${DEMAND_EXPAND}`
      );
      if (res.ok) push(res.data.rows ?? []);
    }
  }

  return dedupeDemands(out).filter((r) => matchesCounterparty(r, counterparty));
}

async function collectDemandsByPhone(phone: string): Promise<DemandRow[]> {
  const phoneKey = normalizePhoneKey(phone);
  if (!phoneKey) return [];

  const out: DemandRow[] = [];
  const searchTerms = [...new Set([phone.trim(), phoneKey, phoneKey.slice(-10)].filter(Boolean))];
  for (const term of searchTerms) {
    const bySearch = await moyskladFetch<{ rows: DemandRow[] }>(
      `/entity/demand?search=${encodeURIComponent(term)}&limit=300&order=moment,desc&expand=${DEMAND_EXPAND}`,
      { cache: "no-store" }
    );
    if (bySearch.ok) out.push(...(bySearch.data.rows ?? []));
  }

  const scanLimit = Math.max(100, parseInt(process.env.MOYSKLAD_PHONE_SEARCH_SCAN_LIMIT ?? "1200", 10) || 1200);
  const recent = await collectRecentDemands(scanLimit);
  if (recent.ok) out.push(...recent.rows);

  return dedupeDemands(out).filter((r) => matchesPhone(r, phoneKey));
}

async function loadShipmentList(opts: {
  search: string;
  counterparty: string;
  plate: string;
  phone: string;
  offset: number;
  limit: number;
}): Promise<{ ok: true; data: ListOk } | { ok: false; error: string }> {
  if (isLocalInventoryReadsEnabled()) {
    try {
      if (await hasLocalInventoryDemands()) {
        const data = await loadLocalDemandList(opts);
        return { ok: true, data };
      }
    } catch (e) {
      console.warn("[shipment] local inventory read failed, falling back to MoySklad:", e);
    }
  }

  const { search, counterparty, plate, phone, offset, limit } = opts;
  const hasCp = counterparty.length > 0;
  const hasPlate = plate.length > 0;
  const hasPhone = phone.length > 0;
  const hasDoc = search.length > 0;
  const plateNorm = hasPlate ? normalizePlate(plate) : "";
  const phoneKey = hasPhone ? normalizePhoneKey(phone) : null;

  if (!hasCp && !hasPlate && !hasPhone) {
    const qs = new URLSearchParams();
    qs.set("limit", String(limit));
    qs.set("offset", String(offset));
    qs.set("order", "moment,desc");
    qs.set("expand", DEMAND_EXPAND);
    if (hasDoc) qs.set("search", search);
    const result = await moyskladFetch<ListOk>(`/entity/demand?${qs.toString()}`, { cache: "no-store" });
    return result;
  }

  let pool: DemandRow[] = [];
  if (hasPhone) {
    pool = phoneKey ? await collectDemandsByPhone(phone) : [];
  } else if (hasCp) {
    pool = await collectDemandsByCounterparty(counterparty);
  } else {
    const res = await collectDemandsByPlate(plate);
    if (!res.ok) return res;
    pool = res.rows;
  }

  if (hasPlate) {
    pool = pool.filter((r) => matchesPlate(r, plateNorm));
  }
  if (hasCp) {
    pool = pool.filter((r) => matchesCounterparty(r, counterparty));
  }
  if (hasPhone && phoneKey) {
    pool = pool.filter((r) => matchesPhone(r, phoneKey));
  }
  if (hasDoc) {
    pool = pool.filter((r) => matchesDocSearch(r, search));
  }

  const total = pool.length;
  const rows = pool.slice(offset, offset + limit);
  return {
    ok: true,
    data: {
      meta: { size: total, limit, offset },
      rows,
    },
  };
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
  const sourceLabel = isLocalInventoryReadsEnabled()
    ? "Отгрузки из локальной БД, с fallback на МойСклад"
    : "Все отгрузки (demand) из МойСклад";
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
          Ошибка МойСклад: {result.error}
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
                      <div style={{ color: "var(--eco-ink)", fontWeight: 500 }}>{getCounterpartyDisplay(r)}</div>
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
