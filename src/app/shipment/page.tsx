import Link from "next/link";
import { Plus } from "lucide-react";
import { requireOpenCashShiftAccess } from "@/lib/app-access";
import { requireBranchContext } from "@/lib/branch-context";
import { formatServiceDate, formatServiceTime, toServiceDateInput } from "@/lib/date-time";
import { loadLocalDemandList } from "@/lib/local-inventory-read";
import { ShipmentListFilters, type ShipmentFilterValues } from "./ShipmentListFilters";
import { ShipmentListWorkspace, type ShipmentListItem } from "./ShipmentListWorkspace";

type DemandAgent = {
  id?: string;
  name?: string;
  phone?: string;
  meta?: { href?: string };
};

type DemandRow = {
  id: string;
  name: string;
  moment: string;
  applicable: boolean;
  paymentStatus?: "paid" | "unpaid" | "unknown";
  sum: number;
  description?: string;
  agent?: DemandAgent;
  organization?: { name?: string };
  store?: { name?: string };
  meta?: { href?: string };
  attributes?: { id?: string; name?: string; value?: unknown }[];
  positionCount?: number;
};

type ListOk = {
  meta: { size: number; limit: number; offset: number };
  rows: DemandRow[];
};

type SearchParams = {
  search?: string;
  counterparty?: string;
  plate?: string;
  phone?: string;
  vin?: string;
  store?: string;
  createdBy?: string;
  status?: string;
  payment?: string;
  minSum?: string;
  maxSum?: string;
  period?: string;
  dateFrom?: string;
  dateTo?: string;
  offset?: string;
};

function rubles(sumKopecks: number): string {
  return ((sumKopecks || 0) / 100).toLocaleString("ru-RU", { maximumFractionDigits: 0 });
}

function formatMoment(value: string): { date: string; time: string } {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: value, time: "—" };
  return { date: formatServiceDate(date), time: formatServiceTime(date) };
}

function getEcoUserName(row: DemandRow): string | undefined {
  const attr = (row.attributes ?? []).find(
    (item) => typeof item?.name === "string" && item.name.trim().toLowerCase() === "эко пользователь"
  );
  if (typeof attr?.value === "string") return attr.value;
  return attr?.value == null ? undefined : String(attr.value);
}

function isPlateAttributeName(name: string | undefined): boolean {
  const normalized = (name ?? "").toLowerCase();
  return /гос|г\/н|госномер|г\.\s*н|номер\s*(тс|а\/м|авто)|state\s*reg|plate/i.test(normalized);
}

function attributeText(row: DemandRow, matches: (name: string) => boolean): string {
  for (const attr of row.attributes ?? []) {
    const name = (attr.name ?? "").trim().toLowerCase();
    if (!matches(name)) continue;
    if (attr.value !== undefined && attr.value !== null && String(attr.value).trim()) return String(attr.value).trim();
  }
  return "";
}

function getPlateDisplay(row: DemandRow): string {
  const attrId = process.env.LEGACY_DEMAND_PLATE_ATTRIBUTE_ID?.trim();
  if (attrId) {
    const value = (row.attributes ?? []).find((attr) => attr.id === attrId)?.value;
    if (value !== undefined && value !== null && value !== "") return String(value);
  }
  for (const attr of row.attributes ?? []) {
    if (!isPlateAttributeName(attr.name)) continue;
    if (attr.value !== undefined && attr.value !== null && attr.value !== "") return String(attr.value);
  }
  return "";
}

function getVehicleDisplay(row: DemandRow): { primary: string; secondary: string; title: string; plate: string; vin: string } {
  const model = attributeText(row, (name) => /модель|марка|vehicle|car|авто/i.test(name) && !/гос|номер|vin|вин|масло/i.test(name));
  const plate = getPlateDisplay(row);
  const vin = attributeText(row, (name) => /vin|вин/i.test(name)).replace(/\s/g, "").toUpperCase();
  const primary = model || plate || (vin ? `VIN …${vin.slice(-6)}` : "—");
  const secondary = model ? plate || (vin ? `VIN …${vin.slice(-6)}` : "") : "";
  const title = [model, plate, vin ? `VIN ${vin}` : ""].filter(Boolean).join(" · ") || "Автомобиль не указан";
  return { primary, secondary, title, plate, vin };
}

function getCounterpartyDisplay(row: DemandRow): string {
  if (row.agent?.name?.trim()) return row.agent.name.trim();
  for (const attr of row.attributes ?? []) {
    const label = (attr.name ?? "").trim().toLowerCase();
    if (!/^(контрагент|клиент|заказчик|покупатель)(\s|$)/.test(label)) continue;
    if (attr.value != null && String(attr.value).trim()) return String(attr.value).trim();
  }
  return "—";
}

function localCounterpartyIdFromMeta(meta?: { href?: string }): string {
  const href = meta?.href?.trim() ?? "";
  const localMatch = href.match(/^local:\/\/[^/]+\/([^/?#]+)/i);
  if (localMatch?.[1]) return decodeURIComponent(localMatch[1]);
  const entityMatch = href.match(/\/entity\/counterparty\/([^/?#]+)/i);
  return entityMatch?.[1] ? decodeURIComponent(entityMatch[1]) : "";
}

function counterpartyIdFromDemand(row: DemandRow): string | null {
  return row.agent?.id?.trim() || localCounterpartyIdFromMeta(row.agent?.meta) || null;
}

function counterpartyCatalogHref(row: DemandRow): string | null {
  const id = counterpartyIdFromDemand(row);
  if (id) return `/clients/counterparties?counterparty=${encodeURIComponent(id)}`;
  const name = getCounterpartyDisplay(row);
  return name === "—" ? null : `/clients/counterparties?search=${encodeURIComponent(name)}`;
}

function normalizeDateParam(value?: string): string {
  const raw = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

function normalizeMoneyParam(value?: string): string {
  const normalized = String(value ?? "").replace(/\s/g, "").replace(",", ".");
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount >= 0 ? String(amount) : "";
}

function addDays(date: string, days: number): string {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function resolvePeriod(rawPeriod: string, customFrom: string, customTo: string, currentYear: number) {
  const today = toServiceDateInput();
  const allowed = new Set(["all", "today", "yesterday", "week", "month", "custom", `year-${currentYear}`, `year-${currentYear - 1}`, `year-${currentYear - 2}`]);
  const period = allowed.has(rawPeriod) ? rawPeriod : customFrom || customTo ? "custom" : "all";
  if (period === "custom") return { period, dateFrom: customFrom, dateTo: customTo };
  if (period === "today") return { period, dateFrom: today, dateTo: today };
  if (period === "yesterday") {
    const yesterday = addDays(today, -1);
    return { period, dateFrom: yesterday, dateTo: yesterday };
  }
  if (period === "week") {
    const weekday = new Date(`${today}T00:00:00.000Z`).getUTCDay() || 7;
    return { period, dateFrom: addDays(today, 1 - weekday), dateTo: today };
  }
  if (period === "month") return { period, dateFrom: `${today.slice(0, 7)}-01`, dateTo: today };
  const year = period.match(/^year-(\d{4})$/)?.[1];
  if (year) return { period, dateFrom: `${year}-01-01`, dateTo: `${year}-12-31` };
  return { period: "all", dateFrom: "", dateTo: "" };
}

function shipmentNumberLabel(name: string): string {
  const clean = name.trim();
  const numeric = clean.match(/^\d+$/)?.[0] ?? clean.match(/-(\d+)$/)?.[1] ?? "";
  return numeric ? numeric.padStart(4, "0") : clean;
}

function buildListHref(values: ShipmentFilterValues, offset: number, override: Partial<ShipmentFilterValues> = {}): string {
  const next = { ...values, ...override };
  const params = new URLSearchParams();
  const keys: Array<keyof ShipmentFilterValues> = ["search", "counterparty", "plate", "phone", "vin", "store", "createdBy", "status", "payment", "minSum", "maxSum", "period"];
  for (const key of keys) if (next[key]) params.set(key, next[key]);
  if (next.period === "custom") {
    if (next.dateFrom) params.set("dateFrom", next.dateFrom);
    if (next.dateTo) params.set("dateTo", next.dateTo);
  }
  if (offset > 0) params.set("offset", String(offset));
  const query = params.toString();
  return query ? `/shipment?${query}` : "/shipment";
}

async function loadShipmentList(options: Parameters<typeof loadLocalDemandList>[0]): Promise<{ ok: true; data: ListOk } | { ok: false; error: string }> {
  try {
    return { ok: true, data: await loadLocalDemandList(options) };
  } catch (error) {
    console.error("[shipment] list read failed:", error);
    return { ok: false, error: "Не удалось загрузить отгрузки" };
  }
}

export default async function ShipmentListPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireOpenCashShiftAccess("/shipment");
  const branch = await requireBranchContext({ allowAll: false, requireActive: true });
  if (!branch.branchId) throw new Error("Активный филиал не выбран");

  const params = await searchParams;
  const currentYear = Number(toServiceDateInput().slice(0, 4));
  const years = [currentYear, currentYear - 1, currentYear - 2];
  const customDateFrom = normalizeDateParam(params.dateFrom);
  const customDateTo = normalizeDateParam(params.dateTo);
  const resolvedPeriod = resolvePeriod(String(params.period ?? ""), customDateFrom, customDateTo, currentYear);
  const status = params.status === "draft" || params.status === "posted" ? params.status : "";
  const payment = params.payment === "paid" || params.payment === "unpaid" ? params.payment : "";
  const minSum = normalizeMoneyParam(params.minSum);
  const maxSum = normalizeMoneyParam(params.maxSum);
  const offset = Math.max(0, Number.parseInt(params.offset ?? "0", 10) || 0);
  const limit = 50;

  const filters: ShipmentFilterValues = {
    search: (params.search ?? "").trim(),
    counterparty: (params.counterparty ?? "").trim(),
    plate: (params.plate ?? "").trim(),
    phone: (params.phone ?? "").trim(),
    vin: (params.vin ?? "").trim(),
    store: (params.store ?? "").trim(),
    createdBy: (params.createdBy ?? "").trim(),
    status,
    payment,
    minSum,
    maxSum,
    period: resolvedPeriod.period,
    dateFrom: resolvedPeriod.period === "custom" ? resolvedPeriod.dateFrom : "",
    dateTo: resolvedPeriod.period === "custom" ? resolvedPeriod.dateTo : "",
  };

  const result = await loadShipmentList({
    branchId: branch.branchId,
    search: filters.search,
    counterparty: filters.counterparty,
    plate: filters.plate,
    phone: filters.phone,
    vin: filters.vin,
    store: filters.store,
    createdBy: filters.createdBy,
    status: status || undefined,
    payment: payment || undefined,
    minSumCents: minSum ? Math.round(Number(minSum) * 100) : undefined,
    maxSumCents: maxSum ? Math.round(Number(maxSum) * 100) : undefined,
    dateFrom: resolvedPeriod.dateFrom,
    dateTo: resolvedPeriod.dateTo,
    offset,
    limit,
  });

  const rows = result.ok ? result.data.rows ?? [] : [];
  const totalSum = rows.reduce((sum, row) => sum + (row.sum || 0), 0);
  const items: ShipmentListItem[] = rows.map((row) => {
    const vehicle = getVehicleDisplay(row);
    return {
      id: row.id,
      name: shipmentNumberLabel(row.name),
      applicable: row.applicable,
      paymentStatus: row.paymentStatus ?? "unknown",
      sum: row.sum,
      sumLabel: `${rubles(row.sum)} ₽`,
      moment: formatMoment(row.moment),
      counterpartyName: getCounterpartyDisplay(row),
      counterpartyHref: counterpartyCatalogHref(row),
      counterpartyId: counterpartyIdFromDemand(row),
      phone: row.agent?.phone?.trim() ?? "",
      vehiclePrimary: vehicle.primary,
      vehicleSecondary: vehicle.secondary,
      vehicleTitle: vehicle.title,
      plate: vehicle.plate,
      vin: vehicle.vin,
      storeName: row.store?.name ?? "—",
      ecoUserName: getEcoUserName(row) ?? "—",
      positionCount: row.positionCount ?? 0,
    };
  });
  const emptyMessage = resolvedPeriod.dateFrom || resolvedPeriod.dateTo ? "За выбранный период отгрузки не найдены." : "По заданным фильтрам отгрузки не найдены.";

  return (
    <main className="eco-page eco-shipment-page">
      <div className="eco-page-head">
        <div>
          <div className="eco-page-kicker"><Link href="/">Главная</Link><span className="mx-2 text-[var(--eco-faint)]">/</span><span>Операции / Отгрузки</span></div>
          <h1 className="eco-page-title">Отгрузки</h1>
        </div>
        <Link href="/shipment/new" className="eco-btn eco-btn--primary"><Plus aria-hidden className="eco-icon" />Новая отгрузка</Link>
      </div>

      <div className="eco-tabs" aria-label="Статус отгрузок">
        <Link href={buildListHref(filters, 0, { status: "" })} className={`eco-tab ${!status ? "is-active" : ""}`}>Все{!status && result.ok ? <span className="eco-tab__count">{result.data.meta.size}</span> : null}</Link>
        <Link href={buildListHref(filters, 0, { status: "draft" })} className={`eco-tab ${status === "draft" ? "is-active" : ""}`}>Черновики{status === "draft" && result.ok ? <span className="eco-tab__count">{result.data.meta.size}</span> : null}</Link>
        <Link href={buildListHref(filters, 0, { status: "posted" })} className={`eco-tab ${status === "posted" ? "is-active" : ""}`}>Проведено{status === "posted" && result.ok ? <span className="eco-tab__count">{result.data.meta.size}</span> : null}</Link>
      </div>

      <ShipmentListFilters values={filters} years={years} />

      {!result.ok ? (
        <div className="eco-card eco-card--padded text-sm text-[var(--eco-danger)]">{result.error}</div>
      ) : (
        <>
          <ShipmentListWorkspace rows={items} totalCount={result.data.meta.size} totalSumLabel={`${rubles(totalSum)} ₽`} emptyMessage={emptyMessage} />
          <div className="eco-shipment-pagination">
            <span>Страница {Math.floor(offset / limit) + 1} · по {limit}</span>
            <div>
              <Link href={buildListHref(filters, Math.max(0, offset - limit))} className={`eco-btn eco-btn--sm ${offset <= 0 ? "pointer-events-none opacity-50" : ""}`}>← Назад</Link>
              <Link href={buildListHref(filters, offset + limit)} className={`eco-btn eco-btn--sm ${offset + limit >= result.data.meta.size ? "pointer-events-none opacity-50" : ""}`}>Вперёд →</Link>
            </div>
          </div>
        </>
      )}
    </main>
  );
}
