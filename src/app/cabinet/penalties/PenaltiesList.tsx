"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getCurrentMonthRange, useOwnerUsers } from "../useOwnerUsers";

type BonusPenalty = {
  id: string;
  userLogin: string;
  date: string;
  amountCents: number;
  type: string;
  comment: string | null;
  createdByLogin: string;
  createdAt: string;
};

const typeLabel: Record<string, string> = {
  bonus: "Бонус",
  penalty_late: "Опоздание",
  penalty_unclosed: "Незакрытая смена",
  penalty_manual: "Штраф (владелец)",
};

export default function PenaltiesList({ role, embedded }: { role: string; embedded?: boolean }) {
  const defaults = getCurrentMonthRange();
  const [list, setList] = useState<BonusPenalty[]>([]);
  const [loading, setLoading] = useState(true);
  const [userFilter, setUserFilter] = useState("");
  const [dateFrom, setDateFrom] = useState(defaults.dateFrom);
  const [dateTo, setDateTo] = useState(defaults.dateTo);
  const [addLogin, setAddLogin] = useState("");
  const [addDate, setAddDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [addAmount, setAddAmount] = useState("");
  const [addType, setAddType] = useState<"bonus" | "penalty_manual">("bonus");
  const [addComment, setAddComment] = useState("");
  const [addLoading, setAddLoading] = useState(false);
  const autoLoadedRef = useRef(false);

  const isOwner = role === "owner";
  const { users } = useOwnerUsers(isOwner);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (isOwner && userFilter) params.set("user", userFilter);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    fetch(`/api/bonus-penalties?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => setList(Array.isArray(data) ? data : []))
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

  useEffect(() => {
    if (isOwner && users.length > 0 && !addLogin) {
      setAddLogin(users[0].login);
    }
  }, [addLogin, isOwner, users]);

  async function remove(id: string) {
    if (!confirm("Удалить запись?")) return;
    const r = await fetch(`/api/bonus-penalties/${id}`, { method: "DELETE" });
    if (r.ok) setList((prev) => prev.filter((x) => x.id !== id));
  }

  async function addBonusPenalty(e: React.FormEvent) {
    e.preventDefault();
    if (!addLogin.trim() || !addDate || !addAmount) return;
    setAddLoading(true);
    try {
      const r = await fetch("/api/bonus-penalties", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userLogin: addLogin.trim(),
          date: addDate,
          amountCents: Math.round(parseFloat(addAmount) * 100),
          type: addType,
          comment: addComment.trim() || null,
        }),
      });
      if (r.ok) {
        const created = await r.json();
        setList((prev) => [created, ...prev]);
        setAddLogin("");
        setAddDate("");
        setAddAmount("");
        setAddComment("");
      }
    } finally {
      setAddLoading(false);
    }
  }

  if (loading) return <p className="mt-4 text-zinc-500">Загрузка…</p>;

  return (
    <>
      {isOwner && (
        <form onSubmit={addBonusPenalty} className="mt-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-800">
          <p className="mb-3 font-medium text-zinc-900 dark:text-zinc-50">Добавить бонус или штраф</p>
          <div className="flex flex-wrap items-end gap-3">
            <select
              required
              value={addLogin}
              onChange={(e) => setAddLogin(e.target.value)}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800"
            >
              <option value="">Выбрать сотрудника</option>
              {users.map((user) => (
                <option key={user.login} value={user.login}>
                  {user.name}
                </option>
              ))}
            </select>
            <input type="date" required value={addDate} onChange={(e) => setAddDate(e.target.value)} className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800" />
            <input type="number" step="0.01" required placeholder="Сумма (₽)" value={addAmount} onChange={(e) => setAddAmount(e.target.value)} className="w-24 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800" />
            <select value={addType} onChange={(e) => setAddType(e.target.value as "bonus" | "penalty_manual")} className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800">
              <option value="bonus">Бонус</option>
              <option value="penalty_manual">Штраф</option>
            </select>
            <input placeholder="Комментарий" value={addComment} onChange={(e) => setAddComment(e.target.value)} className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800" />
            <button type="submit" disabled={addLoading} className="rounded-lg bg-amber-500 px-3 py-1.5 text-sm text-white hover:bg-amber-600 disabled:opacity-50">Добавить</button>
          </div>
        </form>
      )}
      <div className="mt-4 flex flex-wrap items-end gap-3">
        {isOwner && (
          <select
            value={userFilter}
            onChange={(e) => setUserFilter(e.target.value)}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800"
          >
            <option value="">Все сотрудники</option>
            {users.map((user) => (
              <option key={user.login} value={user.login}>
                {user.name}
              </option>
            ))}
          </select>
        )}
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800"
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800"
        />
        <button
          type="button"
          onClick={load}
          disabled={loading || !dateFrom || !dateTo}
          className="rounded-lg bg-amber-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50"
        >
          {loading ? "…" : "Обновить"}
        </button>
      </div>
      <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
        По умолчанию показан текущий месяц{isOwner ? " по всем сотрудникам" : ""}.
      </p>
      <div className="mt-4 overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left dark:border-zinc-700">
              {isOwner && <th className="px-4 py-3 font-medium text-zinc-500">Сотрудник</th>}
              <th className="px-4 py-3 font-medium text-zinc-500">Дата</th>
              <th className="px-4 py-3 font-medium text-zinc-500">Сумма</th>
              <th className="px-4 py-3 font-medium text-zinc-500">Тип</th>
              <th className="px-4 py-3 font-medium text-zinc-500">Причина</th>
              {isOwner && <th className="px-4 py-3 font-medium text-zinc-500" />}
            </tr>
          </thead>
          <tbody>
            {list.map((x) => (
              <tr key={x.id} className="border-b border-zinc-100 dark:border-zinc-700">
                {isOwner && <td className="px-4 py-3">{x.userLogin}</td>}
                <td className="px-4 py-3">{x.date}</td>
                <td className="px-4 py-3">
                  <span className={x.amountCents >= 0 ? "text-emerald-600" : "text-red-600"}>
                    {(x.amountCents / 100).toFixed(2)} ₽
                  </span>
                </td>
                <td className="px-4 py-3">{typeLabel[x.type] ?? x.type}</td>
                <td className="px-4 py-3">{x.comment ?? "—"}</td>
                {isOwner && (
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => remove(x.id)}
                      className="text-red-600 hover:underline"
                    >
                      Удалить
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {list.length === 0 && <p className="px-4 py-8 text-center text-zinc-500">Нет записей.</p>}
      </div>
      {!embedded && (
        <p className="mt-6">
          <Link href="/cabinet" className="text-sm text-amber-600 hover:underline dark:text-amber-400">
            ← В личный кабинет
          </Link>
        </p>
      )}
    </>
  );
}
