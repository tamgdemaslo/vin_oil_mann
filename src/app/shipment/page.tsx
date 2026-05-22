import Link from "next/link";
import { requireActiveShiftAccess } from "@/lib/app-access";
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
  return v.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">Отгрузки</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Все отгрузки (demand) из МойСклад
          </p>
        </div>
        <Link
          href="/shipment/new"
          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 dark:bg-amber-600 dark:hover:bg-amber-700"
        >
          + Создать отгрузку
        </Link>
      </div>

      <form action="/shipment" method="GET" className="mb-4 space-y-3">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <input
            name="search"
            defaultValue={search}
            placeholder="Номер / название документа…"
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 dark:border-zinc-600 dark:bg-zinc-800"
          />
          <input
            name="counterparty"
            defaultValue={counterparty}
            placeholder="Контрагент (имя, часть названия)…"
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 dark:border-zinc-600 dark:bg-zinc-800"
          />
          <input
            name="plate"
            defaultValue={plate}
            placeholder="Гос. номер ТС (не номер отгрузки)…"
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm uppercase outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 dark:border-zinc-600 dark:bg-zinc-800"
          />
          <input
            name="phone"
            defaultValue={phone}
            placeholder="Телефон клиента…"
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 dark:border-zinc-600 dark:bg-zinc-800"
          />
        </div>
        <div className="flex gap-2">
          <button
            type="submit"
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-700"
          >
            Найти
          </button>
          {(search || counterparty || plate || phone || offset > 0) && (
            <Link
              href="/shipment"
              className="rounded-lg border border-zinc-200 px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-400 dark:hover:bg-zinc-700"
            >
              Сбросить
            </Link>
          )}
        </div>
      </form>

      {!result.ok ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
          Ошибка МойСклад: {result.error}
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left dark:border-zinc-700">
                  <th className="px-4 py-3 font-medium text-zinc-500">Дата</th>
                  <th className="px-4 py-3 font-medium text-zinc-500">Номер</th>
                  <th className="px-4 py-3 font-medium text-zinc-500">Контрагент</th>
                  <th className="px-4 py-3 font-medium text-zinc-500">Гос. номер</th>
                  <th className="px-4 py-3 font-medium text-zinc-500">Организация</th>
                  <th className="px-4 py-3 font-medium text-zinc-500">Склад</th>
                  <th className="px-4 py-3 font-medium text-zinc-500">Создал (эко)</th>
                  <th className="px-4 py-3 text-right font-medium text-zinc-500">Сумма</th>
                  <th className="px-4 py-3 text-right font-medium text-zinc-500">Статус</th>
                  <th className="px-4 py-3 text-right font-medium text-zinc-500">Действия</th>
                </tr>
              </thead>
              <tbody>
                {(result.data.rows ?? []).map((r) => (
                  <tr key={r.id} className="border-b border-zinc-100 dark:border-zinc-700">
                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{r.moment}</td>
                    <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-50">
                      <Link href={`/shipment/${r.id}`} className="hover:underline">
                        {r.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{getCounterpartyDisplay(r)}</td>
                    <td className="px-4 py-3 font-mono text-zinc-800 dark:text-zinc-200">{getPlateDisplay(r)}</td>
                    <td className="px-4 py-3">{r.organization?.name ?? "—"}</td>
                    <td className="px-4 py-3">{r.store?.name ?? "—"}</td>
                    <td className="px-4 py-3">{getEcoUserName(r) ?? "Не указано"}</td>
                    <td className="px-4 py-3 text-right">{rubles(r.sum)} ₽</td>
                    <td className="px-4 py-3 text-right">
                      <span
                        className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
                          r.applicable
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                            : "bg-zinc-100 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300"
                        }`}
                      >
                        {r.applicable ? "Проведён" : "Черновик"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right align-middle">
                      <ShipmentRowActions shipmentId={r.id} />
                    </td>
                  </tr>
                ))}
                {result.data.rows?.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-4 py-8 text-center text-zinc-500">
                      Ничего не найдено
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center justify-between text-sm">
            <div className="text-zinc-500 dark:text-zinc-400">
              Показано: {Math.min(limit, result.data.rows?.length ?? 0)} / {result.data.meta.size}
            </div>
            <div className="flex gap-2">
              <Link
                href={`/shipment${listQuery(search, counterparty, plate, phone, Math.max(0, offset - limit))}`}
                className={`rounded-lg border px-3 py-1.5 ${
                  offset <= 0
                    ? "pointer-events-none border-zinc-200 text-zinc-300 dark:border-zinc-700 dark:text-zinc-600"
                    : "border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-700"
                }`}
              >
                ← Назад
              </Link>
              <Link
                href={`/shipment${listQuery(search, counterparty, plate, phone, offset + limit)}`}
                className={`rounded-lg border px-3 py-1.5 ${
                  offset + limit >= result.data.meta.size
                    ? "pointer-events-none border-zinc-200 text-zinc-300 dark:border-zinc-700 dark:text-zinc-600"
                    : "border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-700"
                }`}
              >
                Вперёд →
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
