"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatServiceDate, toServiceDateInput } from "@/lib/date-time";

type Statement = {
  accountMasked: string; currency: string; dateFrom: string; dateTo: string;
  openingCents: number; closingCents: number; incomeCents: number; expenseCents: number;
  operations: Array<{ id: string; date: string; direction: string; amountCents: number; counterparty: string; inn: string; purpose: string }>;
};
type Connection = { id: string; name: string; accounts: Account[] };
type Account = { id: string; accountNumberMasked: string; currency: string };

export default function BankPage() {
  const [dateFrom, setDateFrom] = useState(() => toServiceDateInput(new Date()).slice(0, 8) + "01");
  const [dateTo, setDateTo] = useState(() => toServiceDateInput(new Date()));
  const [connections, setConnections] = useState<Connection[]>([]);
  const [connectionId, setConnectionId] = useState("");
  const accounts = connections.find((item) => item.id === connectionId)?.accounts ?? [];
  const [accountId, setAccountId] = useState("");
  const [data, setData] = useState<Statement | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/integrations/tbank/status", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить настройки Т-Банка.");
        const status = await response.json();
        setConnections(status.connections ?? []);
        setConnectionId(status.id ?? "");
      }).catch((error: Error) => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, []);
  async function load() {
    setLoading(true); setError(""); setData(null);
    try {
      const query = new URLSearchParams({ dateFrom, dateTo, accountId, connectionId });
      const response = await fetch(`/api/integrations/tbank/statement?${query}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Не удалось загрузить выписку.");
      setData(result);
    } catch (error) { setError(error instanceof Error ? error.message : "Ошибка загрузки выписки."); }
    finally { setLoading(false); }
  }
  const currency = ({ "643": "₽", "810": "₽", "RUB": "₽", "840": "USD", "978": "EUR" } as Record<string, string>)[data?.currency ?? "RUB"] ?? data?.currency ?? "₽";
  const money = (cents: number) => `${(cents / 100).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
  return <main className="eco-page eco-page--wide"><div className="eco-fc">
    <header className="eco-fc-head"><div>
      <Link href="/finance">← Финансы</Link>
      <h1 className="eco-page-title">Операции по счёту</h1>
      <p className="eco-page-subtitle">Банковская выписка Т-Банка: поступления, списания и остатки за период.</p>
    </div><Link className="eco-btn" href="/cabinet/integrations">Настройки Т-Банка</Link></header>
    <form className="eco-fc-filters" onSubmit={(event) => { event.preventDefault(); void load(); }}>
      <label><span>Подключение</span><select value={connectionId} disabled={loading} onChange={(event) => { setConnectionId(event.target.value); setAccountId(""); setData(null); setError(""); }}>
        {connections.length === 0 && <option value="">Нет подключений</option>}
        {connections.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <label><span>Счёт</span><select value={accountId} disabled={loading} onChange={(event) => { setAccountId(event.target.value); setData(null); }}>
        <option value="">Основной счёт</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.accountNumberMasked} · {account.currency}</option>)}
      </select></label>
      <label><span>Период с</span><input type="date" required value={dateFrom} disabled={loading} onChange={(event) => { setDateFrom(event.target.value); setData(null); }} /></label>
      <label><span>Период по</span><input type="date" required min={dateFrom} value={dateTo} disabled={loading} onChange={(event) => { setDateTo(event.target.value); setData(null); }} /></label>
      <button className="eco-btn eco-btn--primary" disabled={loading || !connectionId}>{loading ? "Загружаем выписку…" : "Получить выписку"}</button>
    </form>
    {error && <p role="alert">{error}</p>}
    {loading && <p role="status">Получаем все операции за выбранный период…</p>}
    {!data && !loading && !error && <p>Выберите период и получите выписку. Токен и номер расчётного счёта задаются в настройках интеграции.</p>}
    {data && <section aria-label="Выписка">
      <h2>Счёт {data.accountMasked}</h2>
      <p>{formatServiceDate(data.dateFrom)} — {formatServiceDate(data.dateTo)}</p>
      <dl><dt>Остаток на начало периода</dt><dd>{money(data.openingCents)}</dd>
        <dt>Поступило</dt><dd>{money(data.incomeCents)}</dd><dt>Списано</dt><dd>{money(data.expenseCents)}</dd>
        <dt>Остаток на конец периода</dt><dd>{money(data.closingCents)}</dd></dl>
      <h2>Транзакции · {data.operations.length}</h2>
      {data.operations.length === 0 ? <p>За этот период операций нет.</p> : <div style={{ overflowX: "auto" }}><table className="eco-table">
        <thead><tr><th scope="col">Дата / операция</th><th scope="col">Контрагент</th><th scope="col">Назначение</th><th scope="col">Поступление</th><th scope="col">Списание</th></tr></thead>
        <tbody>{data.operations.map((row, index) => <tr key={`${row.id}-${index}`}>
          <td>{formatServiceDate(row.date)}<br /><small>{row.id}</small></td>
          <td>{row.counterparty || "—"}{row.inn && <><br /><small>ИНН {row.inn}</small></>}{row.direction === "internal" && <p>Перевод внутри счёта</p>}</td>
          <td style={{ minWidth: 200, overflowWrap: "anywhere" }}>{row.purpose || "—"}</td>
          <td>{row.direction !== "expense" ? money(row.amountCents) : "—"}</td>
          <td>{row.direction !== "income" ? money(row.amountCents) : "—"}</td>
        </tr>)}</tbody>
      </table></div>}
      <p>Данные банка показаны отдельно от кассы и управленческого учёта.</p>
    </section>}
  </div></main>;
}
