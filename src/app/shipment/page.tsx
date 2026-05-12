import Link from "next/link";
import { requireActiveShiftAccess } from "@/lib/app-access";
import { moyskladFetch } from "@/lib/moysklad";
import { ShipmentRowActions } from "./ShipmentRowActions";

type DemandRow = {
  id: string;
  name: string;
  moment: string;
  applicable: boolean;
  sum: number;
  description?: string;
  agent?: { name?: string };
  organization?: { name?: string };
  store?: { name?: string };
  meta?: { href?: string };
  attributes?: { id?: string; name?: string; value?: unknown }[];
};

type ListOk = {
  meta: { size: number; limit: number; offset: number };
  rows: DemandRow[];
};

const DEMAND_EXPAND = "agent,organization,store,attributes";

function rubles(sumKopecks: number): string {
  const v = (sumKopecks || 0) / 100;
  return v.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function normalizePlate(s: string): string {
  return s.replace(/\s/g, "").toUpperCase();
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

function getPlateDisplay(row: DemandRow): string {
  const attrs = row.attributes ?? [];
  const attrId = process.env.MOYSKLAD_DEMAND_PLATE_ATTRIBUTE_ID?.trim();
  if (attrId) {
    const hit = attrs.find((a) => a.id === attrId);
    const v = hit?.value;
    if (v !== undefined && v !== null && v !== "") return String(v);
  }
  for (const a of attrs) {
    const n = (a.name ?? "").toLowerCase();
    if (/гос|г\/н|госномер|г\.\s*н|номер\s*(тс|а\/м|авто)|state\s*reg|plate/i.test(n)) {
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

/** Только комментарий и доп. поля — без номера документа, чтобы «332» в гос. номере не ловило «00332». */
function plateHaystackStrict(row: DemandRow): string {
  const parts: string[] = [];
  if (row.description) parts.push(row.description);
  for (const a of row.attributes ?? []) {
    parts.push(String(a.value ?? ""));
  }
  return parts.join(" ").replace(/\s/g, "").toUpperCase();
}

function matchesPlate(row: DemandRow, plateNorm: string): boolean {
  if (!plateNorm) return true;
  const display = getPlateDisplay(row);
  if (display !== "—" && normalizePlate(display).includes(plateNorm)) return true;
  return plateHaystackStrict(row).includes(plateNorm);
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

function dedupeDemands(rows: DemandRow[]): DemandRow[] {
  const map = new Map<string, DemandRow>();
  for (const r of rows) {
    if (!map.has(r.id)) map.set(r.id, r);
  }
  return [...map.values()].sort((a, b) => String(b.moment).localeCompare(String(a.moment)));
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

async function loadShipmentList(opts: {
  search: string;
  counterparty: string;
  plate: string;
  offset: number;
  limit: number;
}): Promise<{ ok: true; data: ListOk } | { ok: false; error: string }> {
  const { search, counterparty, plate, offset, limit } = opts;
  const hasCp = counterparty.length > 0;
  const hasPlate = plate.length > 0;
  const hasDoc = search.length > 0;
  const plateNorm = hasPlate ? normalizePlate(plate) : "";

  if (!hasCp && !hasPlate) {
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
  if (hasCp) {
    pool = await collectDemandsByCounterparty(counterparty);
  } else {
    const res = await moyskladFetch<{ rows: DemandRow[] }>(
      `/entity/demand?search=${encodeURIComponent(plate)}&limit=450&order=moment,desc&expand=${DEMAND_EXPAND}`
    );
    if (!res.ok) return res;
    pool = res.data.rows ?? [];
  }

  if (hasPlate) {
    pool = pool.filter((r) => matchesPlate(r, plateNorm));
  }
  if (hasCp) {
    pool = pool.filter((r) => matchesCounterparty(r, counterparty));
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

function listQuery(search: string, counterparty: string, plate: string, offset: number): string {
  const p = new URLSearchParams();
  if (search) p.set("search", search);
  if (counterparty) p.set("counterparty", counterparty);
  if (plate) p.set("plate", plate);
  if (offset > 0) p.set("offset", String(offset));
  const s = p.toString();
  return s ? `?${s}` : "";
}

export default async function ShipmentListPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; counterparty?: string; plate?: string; offset?: string }>;
}) {
  await requireActiveShiftAccess("/shipment");

  const sp = await searchParams;
  const search = (sp.search ?? "").trim();
  const counterparty = (sp.counterparty ?? "").trim();
  const plate = (sp.plate ?? "").trim();
  const offset = Math.max(0, parseInt(sp.offset ?? "0", 10) || 0);
  const limit = 50;

  const result = await loadShipmentList({ search, counterparty, plate, offset, limit });

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
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
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
        </div>
        <div className="flex gap-2">
          <button
            type="submit"
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-700"
          >
            Найти
          </button>
          {(search || counterparty || plate || offset > 0) && (
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
                href={`/shipment${listQuery(search, counterparty, plate, Math.max(0, offset - limit))}`}
                className={`rounded-lg border px-3 py-1.5 ${
                  offset <= 0
                    ? "pointer-events-none border-zinc-200 text-zinc-300 dark:border-zinc-700 dark:text-zinc-600"
                    : "border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-700"
                }`}
              >
                ← Назад
              </Link>
              <Link
                href={`/shipment${listQuery(search, counterparty, plate, offset + limit)}`}
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
