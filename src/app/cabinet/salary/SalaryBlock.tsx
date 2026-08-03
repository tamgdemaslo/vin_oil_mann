"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Calculator } from "lucide-react";
import { EcoButton, EcoKpi } from "@/components/platform/EcoUI";
import { getCurrentMonthRange, useOwnerUsers } from "../useOwnerUsers";

type PayrollByLogin = {
  shiftTotalCents: number;
  pieceworkCents: number;
  bonusPenaltyCents: number;
  paidOutCents: number;
  remainingCents: number;
  totalCents: number;
  shiftsCount: number;
};

type Payroll = {
  dateFrom: string;
  dateTo: string;
  byLogin: Record<string, PayrollByLogin>;
  vehicleHistory: unknown[];
};

function money(cents: number) {
  return `${(cents / 100).toLocaleString("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ₽`;
}

export default function SalaryBlock({ role, login, embedded }: { role: string; login: string; embedded?: boolean }) {
  const defaults = getCurrentMonthRange();
  const [data, setData] = useState<Payroll | null>(null);
  const [loading, setLoading] = useState(false);
  const [dateFrom, setDateFrom] = useState(defaults.dateFrom);
  const [dateTo, setDateTo] = useState(defaults.dateTo);
  const [userFilter, setUserFilter] = useState("");
  const autoLoadedRef = useRef(false);

  const isOwner = role === "owner";
  const { users } = useOwnerUsers(isOwner);

  const load = useCallback(() => {
    if (!dateFrom || !dateTo) return;
    setLoading(true);
    const params = new URLSearchParams({ dateFrom, dateTo });
    if (isOwner && userFilter) params.set("user", userFilter);
    fetch(`/api/payroll?${params.toString()}`)
      .then((r) => r.json())
      .then((payload) => setData(payload))
      .finally(() => setLoading(false));
  }, [dateFrom, dateTo, isOwner, userFilter]);

  useEffect(() => {
    if (autoLoadedRef.current || !dateFrom || !dateTo) return;
    autoLoadedRef.current = true;
    const timer = window.setTimeout(() => {
      load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [dateFrom, dateTo, load]);

  const entries = data?.byLogin ? Object.entries(data.byLogin) : [];
  const targetLogin = isOwner && userFilter ? userFilter : login;
  const row = data?.byLogin?.[targetLogin];

  return (
    <>
      <div className="eco-filter-bar eco-cabinet-salary-filter">
        <label className="eco-field">
          <span>С</span>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="eco-input"
          />
        </label>
        <label className="eco-field">
          <span>По</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="eco-input"
          />
        </label>
        {isOwner && (
          <select
            value={userFilter}
            onChange={(e) => setUserFilter(e.target.value)}
            className="eco-input"
          >
            <option value="">Все сотрудники</option>
            {users.map((user) => (
              <option key={user.login} value={user.login}>
                {user.name}
              </option>
            ))}
          </select>
        )}
        <EcoButton
          type="button"
          onClick={load}
          disabled={loading || !dateFrom || !dateTo}
          variant="primary"
        >
          <Calculator size={15} />
          {loading ? "…" : "Рассчитать"}
        </EcoButton>
      </div>
      <p className="eco-page-subtitle">
        По умолчанию показан текущий месяц{isOwner ? " по всем сотрудникам" : ""}.
      </p>

      {data && (
        <div className="eco-cabinet-salary-result">
          {isOwner && entries.length > 1 ? (
            <div className="eco-table-wrap">
              <table className="eco-table">
                <thead>
                  <tr>
                    <th>Сотрудник</th>
                    <th className="num">Смен</th>
                    <th className="num">Ставки смен</th>
                    <th className="num">Сдельная часть</th>
                    <th className="num">Бонусы/штрафы</th>
                    <th className="num">Выплачено</th>
                    <th className="num">К выдаче</th>
                    <th className="num">Итого</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map(([userLogin, r]) => (
                    <tr key={userLogin}>
                      <td className="font-medium">{userLogin}</td>
                      <td className="num">{r.shiftsCount}</td>
                      <td className="num">{money(r.shiftTotalCents)}</td>
                      <td className="num">{money(r.pieceworkCents)}</td>
                      <td className="num">{money(r.bonusPenaltyCents)}</td>
                      <td className="num">{money(r.paidOutCents)}</td>
                      <td className="num">{money(r.remainingCents)}</td>
                      <td className="num strong">{money(r.totalCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : row ? (
            <div className="eco-grid eco-grid--kpi eco-cabinet-salary-kpis">
              <EcoKpi label="Период" value={`${data.dateFrom} — ${data.dateTo}`} tone="neutral" />
              <EcoKpi label="Смен" value={row.shiftsCount} tone="info" />
              <EcoKpi label="К выдаче" value={money(row.remainingCents)} tone="rust" />
              <EcoKpi label="Итого" value={money(row.totalCents)} tone="success" />
            </div>
          ) : null}
        </div>
      )}

      {!embedded && (
        <p className="mt-6">
          <Link href="/cabinet" className="eco-btn eco-btn--sm">
            ← В личный кабинет
          </Link>
        </p>
      )}
    </>
  );
}
