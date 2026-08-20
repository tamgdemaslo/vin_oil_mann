"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, Filter, Search, X } from "lucide-react";
import { useMemo, useState } from "react";

export type ShipmentFilterValues = {
  search: string;
  counterparty: string;
  plate: string;
  phone: string;
  vin: string;
  store: string;
  createdBy: string;
  status: string;
  payment: string;
  minSum: string;
  maxSum: string;
  period: string;
  dateFrom: string;
  dateTo: string;
};

type ShipmentListFiltersProps = {
  values: ShipmentFilterValues;
  years: number[];
};

const advancedKeys: Array<keyof ShipmentFilterValues> = [
  "counterparty",
  "phone",
  "plate",
  "vin",
  "store",
  "createdBy",
  "status",
  "payment",
  "minSum",
  "maxSum",
];

const chipLabels: Partial<Record<keyof ShipmentFilterValues, string>> = {
  counterparty: "Клиент",
  phone: "Телефон",
  plate: "Гос. номер",
  vin: "VIN",
  store: "Склад",
  createdBy: "Создал",
  status: "Статус",
  payment: "Оплата",
  minSum: "Сумма от",
  maxSum: "Сумма до",
};

function displayValue(key: keyof ShipmentFilterValues, value: string): string {
  if (key === "status") return value === "posted" ? "Проведено" : "Черновик";
  if (key === "payment") return value === "paid" ? "Оплачено" : "Не оплачено";
  if (key === "minSum" || key === "maxSum") return `${value} ₽`;
  return value;
}

export function ShipmentListFilters({ values, years }: ShipmentListFiltersProps) {
  const router = useRouter();
  const initialAdvancedCount = advancedKeys.filter((key) => Boolean(values[key])).length;
  const [filtersOpen, setFiltersOpen] = useState(initialAdvancedCount > 0);
  const [period, setPeriod] = useState(values.period || "all");
  const activeAdvanced = useMemo(
    () => advancedKeys.filter((key) => Boolean(values[key])),
    [values]
  );

  function clearFilter(key: keyof ShipmentFilterValues) {
    const url = new URL(window.location.href);
    url.searchParams.delete(key);
    url.searchParams.delete("offset");
    router.push(`${url.pathname}${url.search}`);
  }

  return (
    <form action="/shipment" method="GET" className="eco-shipment-filters">
      <div className="eco-shipment-filters__main">
        <label className="eco-search-wrap eco-shipment-filters__search">
          <Search aria-hidden className="eco-icon" />
          <input
            name="search"
            defaultValue={values.search}
            placeholder="№, клиент, телефон, VIN, гос. номер…"
            className="eco-input"
          />
        </label>

        <label className="eco-shipment-period-control">
          <CalendarDays aria-hidden className="eco-icon" />
          <span>Период:</span>
          <select name="period" value={period} onChange={(event) => setPeriod(event.target.value)}>
            <option value="all">Всё время</option>
            <option value="today">Сегодня</option>
            <option value="yesterday">Вчера</option>
            <option value="week">Эта неделя</option>
            <option value="month">Этот месяц</option>
            {years.map((year) => <option key={year} value={`year-${year}`}>{year}</option>)}
            <option value="custom">Произвольный период</option>
          </select>
        </label>

        <button
          type="button"
          className={`eco-btn eco-btn--sm eco-shipment-filter-toggle ${filtersOpen ? "is-active" : ""}`}
          onClick={() => setFiltersOpen((open) => !open)}
          aria-expanded={filtersOpen}
          aria-controls="shipment-advanced-filters"
        >
          <Filter aria-hidden className="eco-icon" />
          Фильтры
          {initialAdvancedCount > 0 ? <span>{initialAdvancedCount}</span> : null}
        </button>

        <button type="submit" className="eco-btn eco-btn--primary eco-btn--sm">Показать</button>
        {(values.search || initialAdvancedCount > 0 || values.period !== "all") ? (
          <Link href="/shipment" className="eco-btn eco-btn--ghost eco-btn--sm">Сбросить</Link>
        ) : null}
      </div>

      <div className={`eco-shipment-custom-period ${period === "custom" ? "is-visible" : ""}`}>
        <label>
          <span>Дата от</span>
          <input name="dateFrom" type="date" defaultValue={values.dateFrom} disabled={period !== "custom"} className="eco-input" />
        </label>
        <label>
          <span>Дата до</span>
          <input name="dateTo" type="date" defaultValue={values.dateTo} disabled={period !== "custom"} className="eco-input" />
        </label>
      </div>

      <div id="shipment-advanced-filters" className={`eco-shipment-advanced-filters ${filtersOpen ? "is-open" : ""}`}>
        <input name="counterparty" defaultValue={values.counterparty} placeholder="Клиент" className="eco-input" />
        <input name="phone" defaultValue={values.phone} placeholder="Телефон" inputMode="tel" className="eco-input" />
        <input name="plate" defaultValue={values.plate} placeholder="Гос. номер" className="eco-input eco-shipment-plate-input" />
        <input name="vin" defaultValue={values.vin} placeholder="VIN" className="eco-input eco-shipment-vin-input" />
        <input name="store" defaultValue={values.store} placeholder="Склад" className="eco-input" />
        <input name="createdBy" defaultValue={values.createdBy} placeholder="Создал" className="eco-input" />
        <select name="status" defaultValue={values.status} className="eco-input" aria-label="Статус">
          <option value="">Все статусы</option>
          <option value="draft">Черновик</option>
          <option value="posted">Проведено</option>
        </select>
        <select name="payment" defaultValue={values.payment} className="eco-input" aria-label="Оплата">
          <option value="">Любая оплата</option>
          <option value="paid">Оплачено</option>
          <option value="unpaid">Не оплачено</option>
        </select>
        <input name="minSum" defaultValue={values.minSum} placeholder="Сумма от, ₽" inputMode="numeric" className="eco-input" />
        <input name="maxSum" defaultValue={values.maxSum} placeholder="Сумма до, ₽" inputMode="numeric" className="eco-input" />
      </div>

      {activeAdvanced.length > 0 ? (
        <div className="eco-shipment-filter-chips" aria-label="Активные фильтры">
          {activeAdvanced.map((key) => (
            <button key={key} type="button" onClick={() => clearFilter(key)}>
              <span>{chipLabels[key]}: {displayValue(key, values[key])}</span>
              <X aria-hidden />
            </button>
          ))}
        </div>
      ) : null}
    </form>
  );
}
