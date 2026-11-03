"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { formatServiceDate, toServiceDateInput } from "@/lib/date-time";
import { BANK_CATEGORY_KINDS, summarizeBankCategories, type BankCategory, type BankCategoryKind } from "@/lib/bank-operation-category-domain";
import styles from "./bank.module.css";

type Operation = { id: string; date: string; direction: string; amountCents: number; counterparty: string; inn: string; purpose: string; categoryId: string | null };
type Statement = {
  connectionId: string; accountId: string | null; categories: BankCategory[];
  accountMasked: string; currency: string; dateFrom: string; dateTo: string;
  openingCents: number; closingCents: number; incomeCents: number; expenseCents: number;
  operations: Operation[];
};
type Connection = { id: string; name: string; accounts: Account[] };
type Account = { id: string; accountNumberMasked: string; currency: string };
const emptyCategoryForm = { id: "", name: "", kind: "operating" as BankCategoryKind, archived: false };

export default function BankPage() {
  const [dateFrom, setDateFrom] = useState(() => toServiceDateInput(new Date()).slice(0, 8) + "01");
  const [dateTo, setDateTo] = useState(() => toServiceDateInput(new Date()));
  const [connections, setConnections] = useState<Connection[]>([]);
  const [connectionId, setConnectionId] = useState("");
  const accounts = connections.find(item => item.id === connectionId)?.accounts ?? [];
  const [accountId, setAccountId] = useState("");
  const [data, setData] = useState<Statement | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [savingRows, setSavingRows] = useState<Record<string, boolean>>({});
  const [rowMessages, setRowMessages] = useState<Record<string, { error: boolean; text: string }>>({});
  const [categoryForm, setCategoryForm] = useState(emptyCategoryForm);
  const [savingCategory, setSavingCategory] = useState(false);
  const [categoryMessage, setCategoryMessage] = useState<{ error: boolean; text: string } | null>(null);
  const busy = loading || savingCategory || Object.values(savingRows).some(Boolean);
  const summaries = useMemo(() => summarizeBankCategories(data?.operations ?? [], data?.categories ?? []), [data]);
  const uncategorizedCount = data?.operations.filter(row => !row.categoryId).length ?? 0;
  const visibleOperations = data?.operations.filter(row => !categoryFilter || (categoryFilter === "uncategorized" ? !row.categoryId : row.categoryId === categoryFilter)) ?? [];
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/integrations/tbank/status", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("Не удалось загрузить настройки Т-Банка.");
        const status = await response.json();
        setConnections(status.connections ?? []);
        setConnectionId(status.id ?? "");
      }).catch((error: Error) => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, []);
  function clearStatement() {
    setData(null); setError(""); setCategoryFilter(""); setRowMessages({}); setCategoryMessage(null); setCategoryForm(emptyCategoryForm);
  }
  async function load() {
    setLoading(true); setError(""); setData(null); setRowMessages({}); setCategoryFilter(""); setCategoryMessage(null); setCategoryForm(emptyCategoryForm);
    try {
      const query = new URLSearchParams({ dateFrom, dateTo, accountId, connectionId });
      const response = await fetch(`/api/integrations/tbank/statement?${query}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Не удалось загрузить выписку.");
      setData(result);
    } catch (error) { setError(error instanceof Error ? error.message : "Ошибка загрузки выписки."); }
    finally { setLoading(false); }
  }
  async function assign(row: Operation, categoryId: string) {
    if (!data?.accountId) return;
    setSavingRows(current => ({ ...current, [row.id]: true }));
    setRowMessages(current => ({ ...current, [row.id]: { error: false, text: "Сохраняем…" } }));
    try {
      const response = await fetch("/api/integrations/tbank/classification", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: data.accountId, operationId: row.id, categoryId: categoryId || null }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Не удалось сохранить категорию.");
      setData(current => current ? { ...current, operations: current.operations.map(operation => operation.id === row.id ? { ...operation, categoryId: result.categoryId } : operation) } : current);
      setRowMessages(current => ({ ...current, [row.id]: { error: false, text: "Сохранено" } }));
    } catch (error) {
      setRowMessages(current => ({ ...current, [row.id]: { error: true, text: error instanceof Error ? error.message : "Не удалось сохранить категорию. Повторите попытку." } }));
    } finally { setSavingRows(current => ({ ...current, [row.id]: false })); }
  }
  function chooseCategory(id: string) {
    const category = data?.categories.find(item => item.id === id);
    setCategoryForm(category ? { id: category.id, name: category.name, kind: category.kind, archived: category.archived } : emptyCategoryForm);
    setCategoryMessage(null);
  }
  async function saveCategory() {
    setSavingCategory(true); setCategoryMessage(null);
    try {
      const response = await fetch("/api/integrations/tbank/categories", {
        method: categoryForm.id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(categoryForm),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Не удалось сохранить категорию.");
      setData(current => current ? { ...current, categories: result.categories } : current);
      const category = (result.categories as BankCategory[]).find(item => item.id === result.categoryId);
      if (category) setCategoryForm({ id: category.id, name: category.name, kind: category.kind, archived: category.archived });
      setCategoryMessage({ error: false, text: "Категория сохранена. Её можно выбрать у операции." });
    } catch (error) { setCategoryMessage({ error: true, text: error instanceof Error ? error.message : "Не удалось сохранить категорию." }); }
    finally { setSavingCategory(false); }
  }
  const currency = ({ "643": "₽", "810": "₽", "RUB": "₽", "840": "USD", "978": "EUR" } as Record<string, string>)[data?.currency ?? "RUB"] ?? data?.currency ?? "₽";
  const money = (cents: number) => `${(cents / 100).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
  const kindLabel = (kind: string) => kind === "uncategorized" ? "Нужно разобрать" : BANK_CATEGORY_KINDS.find(item => item.value === kind)?.label ?? kind;
  return <main className="eco-page eco-page--wide"><div className="eco-fc">
    <header className="eco-fc-head"><div>
      <Link href="/finance">← Финансы</Link>
      <h1 className="eco-page-title">Операции по счёту</h1>
      <p className="eco-page-subtitle">Банковская выписка Т-Банка и категории движения денег.</p>
    </div><Link className="eco-btn" href="/cabinet/integrations#finance">Настройки Т-Банка</Link></header>
    <form className="eco-fc-filters" onSubmit={event => { event.preventDefault(); void load(); }}>
      <label><span>Подключение</span><select value={connectionId} disabled={busy} onChange={event => { setConnectionId(event.target.value); setAccountId(""); clearStatement(); }}>
        {connections.length === 0 && <option value="">Нет подключений</option>}
        {connections.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <label><span>Счёт</span><select value={accountId} disabled={busy} onChange={event => { setAccountId(event.target.value); clearStatement(); }}>
        <option value="">Основной счёт</option>{accounts.map(account => <option key={account.id} value={account.id}>{account.accountNumberMasked} · {account.currency}</option>)}
      </select></label>
      <label><span>Период с</span><input type="date" required value={dateFrom} disabled={busy} onChange={event => { setDateFrom(event.target.value); clearStatement(); }} /></label>
      <label><span>Период по</span><input type="date" required min={dateFrom} value={dateTo} disabled={busy} onChange={event => { setDateTo(event.target.value); clearStatement(); }} /></label>
      <button className="eco-btn eco-btn--primary" disabled={busy || !connectionId}>{loading ? "Загружаем выписку…" : "Получить выписку"}</button>
    </form>
    {error && <p role="alert">{error}</p>}
    {loading && <p role="status">Получаем все операции за выбранный период…</p>}
    {!data && !loading && !error && <p>Выберите период и получите выписку. Токен и номер расчётного счёта задаются в настройках интеграции.</p>}
    {data && <>
      <section aria-label="Банковские итоги">
        <div className={styles.heading}><h2>Счёт {data.accountMasked}</h2><span>{formatServiceDate(data.dateFrom)} — {formatServiceDate(data.dateTo)}</span></div>
        <dl className={styles.balances}>
          {[['Остаток на начало периода',data.openingCents],['Поступило',data.incomeCents],['Списано',data.expenseCents],['Остаток на конец периода',data.closingCents]].map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{money(Number(value))}</dd></div>)}
        </dl>
      </section>
      <section aria-label="Статистика по категориям">
        <div className={styles.heading}><h2>По категориям</h2><span>Весь выбранный период · {data.operations.length} операций</span></div>
        <p className={styles.muted}>Размечено {data.operations.length - uncategorizedCount} из {data.operations.length}. Переводы между своими счетами и личные средства выделены отдельными видами.</p>
        <div className={styles.tableScroll}><table className="eco-table"><thead><tr><th scope="col">Категория</th><th scope="col">Вид</th><th scope="col">Операций</th><th scope="col">Поступило</th><th scope="col">Списано</th></tr></thead>
          <tbody>{summaries.map(summary => <tr key={summary.categoryId ?? "uncategorized"}>
            <td><button type="button" className={styles.categoryLink} onClick={() => setCategoryFilter(summary.categoryId ?? "uncategorized")}>{summary.name}{summary.archived ? " (архив)" : ""}</button></td>
            <td>{kindLabel(summary.kind)}</td><td>{summary.count}</td><td className={styles.amount}>{money(summary.incomeCents)}</td><td className={styles.amount}>{money(summary.expenseCents)}</td>
          </tr>)}</tbody>
        </table></div>
        {summaries.length === 0 && <p>В этом периоде нет операций для статистики.</p>}
      </section>
      <details className={styles.manager}>
        <summary>Настроить категории</summary>
        <p className={styles.muted}>Категории общие для счетов выбранного филиала. Архивная категория остаётся у уже размеченных операций.</p>
        <form className={styles.categoryForm} onSubmit={event => { event.preventDefault(); void saveCategory(); }}>
          <label><span>Категория</span><select value={categoryForm.id} disabled={busy} onChange={event => chooseCategory(event.target.value)}><option value="">Новая категория</option>{data.categories.map(category => <option key={category.id} value={category.id}>{category.name}{category.archived ? " (архив)" : ""}</option>)}</select></label>
          <label><span>Название</span><input required minLength={2} maxLength={80} value={categoryForm.name} disabled={busy} onChange={event => setCategoryForm(current => ({ ...current, name: event.target.value }))} placeholder="Например, инструмент и оборудование" /></label>
          <label><span>Вид</span><select value={categoryForm.kind} disabled={busy} onChange={event => setCategoryForm(current => ({ ...current, kind: event.target.value as BankCategoryKind }))}>{BANK_CATEGORY_KINDS.map(kind => <option key={kind.value} value={kind.value}>{kind.label}</option>)}</select></label>
          {categoryForm.id && <label className={styles.checkbox}><input type="checkbox" checked={categoryForm.archived} disabled={busy} onChange={event => setCategoryForm(current => ({ ...current, archived: event.target.checked }))} /><span>В архиве</span></label>}
          <button className="eco-btn" disabled={busy}>{savingCategory ? "Сохраняем…" : categoryForm.id ? "Сохранить категорию" : "Создать категорию"}</button>
        </form>
        {categoryMessage && <p role={categoryMessage.error ? "alert" : "status"}>{categoryMessage.text}</p>}
      </details>
      <section aria-label="Банковские операции">
        <div className={styles.heading}><h2>Операции · {visibleOperations.length}{categoryFilter ? ` из ${data.operations.length}` : ""}</h2>
          <label className={styles.filter}><span>Показать</span><select value={categoryFilter} onChange={event => setCategoryFilter(event.target.value)}><option value="">Все операции</option><option value="uncategorized">Без категории · {uncategorizedCount}</option>{data.categories.map(category => <option key={category.id} value={category.id}>{category.name}{category.archived ? " (архив)" : ""}</option>)}</select></label>
        </div>
        {!data.accountId && <p>Для назначения категорий обновите расчётный счёт в настройках интеграции.</p>}
        {visibleOperations.length === 0 ? <p>{categoryFilter ? "Операций с этой категорией в выбранном периоде нет." : "За этот период операций нет."}</p> : <div className={styles.tableScroll}><table className="eco-table">
          <thead><tr><th scope="col">Дата / операция</th><th scope="col">Контрагент</th><th scope="col">Назначение</th><th scope="col">Категория</th><th scope="col">Поступление</th><th scope="col">Списание</th></tr></thead>
          <tbody>{visibleOperations.map((row,index) => <tr key={`${row.id}-${index}`}>
            <td>{formatServiceDate(row.date)}<br /><small>{row.id}</small></td>
            <td>{row.counterparty || "—"}{row.inn && <><br /><small>ИНН {row.inn}</small></>}{row.direction === "internal" && <p>Перевод внутри счёта</p>}</td>
            <td className={styles.purpose}>{row.purpose || "—"}</td>
            <td className={styles.operationCategory}><select aria-label={`Категория операции ${row.id}`} value={row.categoryId ?? ""} disabled={!data.accountId || !row.id || savingRows[row.id] || savingCategory} onChange={event => void assign(row,event.target.value)}>
              <option value="">Без категории</option>
              {BANK_CATEGORY_KINDS.map(kind => <optgroup key={kind.value} label={kind.label}>{data.categories.filter(category => category.kind === kind.value && (!category.archived || category.id === row.categoryId)).map(category => <option key={category.id} value={category.id} disabled={category.archived}>{category.name}{category.archived ? " (архив)" : ""}</option>)}</optgroup>)}
            </select>{rowMessages[row.id] && <small role={rowMessages[row.id].error ? "alert" : "status"} className={rowMessages[row.id].error ? styles.rowError : styles.muted}>{rowMessages[row.id].text}</small>}</td>
            <td className={styles.amount}>{row.direction !== "expense" ? money(row.amountCents) : "—"}</td>
            <td className={styles.amount}>{row.direction !== "income" ? money(row.amountCents) : "—"}</td>
          </tr>)}</tbody>
        </table></div>}
      </section>
    </>}
  </div></main>;
}
