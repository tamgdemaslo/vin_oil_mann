"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatServiceDate, toServiceDateInput } from "@/lib/date-time";
import { BANK_CATEGORY_KINDS, needsBankExpenseReview, summarizeBankCategories, type BankCategory, type BankCategoryKind } from "@/lib/bank-operation-category-domain";
import styles from "./bank.module.css";

type Operation = { id: string; date: string; direction: string; amountCents: number; counterparty: string; inn: string; purpose: string; categoryId: string | null; hiddenFromReview: boolean; categorySource: "manual" | "automatic" | null; canRemember: boolean; hasRule: boolean; cashTransferDate?: string | null };
type Statement = {
  connectionId: string; accountId: string | null; categories: BankCategory[];
  accountMasked: string; currency: string; dateFrom: string; dateTo: string;
  openingCents: number; closingCents: number; incomeCents: number; expenseCents: number;
  operations: Operation[];
};
type Connection = { id: string; name: string; accounts: Account[] };
type Account = { id: string; accountNumberMasked: string; currency: string };
const expensePalette = ["#a84422", "#315d6a", "#997026", "#4f6a40", "#755679", "#886d59", "#35527f", "#9a4c61"];
const shareFormat = new Intl.NumberFormat("ru-RU", { style: "percent", maximumFractionDigits: 1 });
const expenseFilterPrefix = "expense:";
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
  const summaries = useMemo(() => summarizeBankCategories(data?.operations.filter(row => !row.cashTransferDate) ?? [], data?.categories ?? []), [data]);
  const expenseSummaries = useMemo(() => summarizeBankCategories(
    data?.operations.filter(row => row.direction === "expense" && !row.cashTransferDate) ?? [],
    data?.categories ?? [],
  ).filter(row => row.expenseCents > 0 && row.kind !== "transfer"), [data]);
  const expenseTotal = expenseSummaries.reduce((sum, row) => sum + row.expenseCents, 0);
  const selectedExpense = categoryFilter.startsWith(expenseFilterPrefix) ? categoryFilter.slice(expenseFilterPrefix.length) : null;
  const expenseSlices = expenseSummaries.map((row, index) => ({
    ...row,
    key: row.categoryId ?? "uncategorized",
    color: row.categoryId ? expensePalette[index % expensePalette.length] : "#77756c",
    share: row.expenseCents / expenseTotal,
  }));
  const uncategorizedCount = data?.operations.filter(row => !row.categoryId && !row.cashTransferDate).length ?? 0;
  const hiddenCount = data?.operations.filter(row => row.hiddenFromReview).length ?? 0;
  const reviewCount = data?.operations.filter(needsBankExpenseReview).length ?? 0;
  const visibleOperations = data?.operations.filter(row => {
    if (selectedExpense) {
      return row.direction === "expense" && !row.cashTransferDate &&
        (row.categoryId ?? "uncategorized") === selectedExpense;
    }
    if (categoryFilter === "review") return needsBankExpenseReview(row);
    if (categoryFilter === "hidden") return row.hiddenFromReview;
    if (categoryFilter === "uncategorized") return !row.categoryId && !row.cashTransferDate;
    return !categoryFilter || row.categoryId === categoryFilter;
  }) ?? [];
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
  const load = useCallback(async (keepView = false) => {
    setLoading(true);
    setError("");
    if (!keepView) {
      setData(null);
      setRowMessages({});
      setCategoryFilter(new URLSearchParams(window.location.search).get("review") === "1" ? "review" : "");
      setCategoryMessage(null);
      setCategoryForm(emptyCategoryForm);
    }
    try {
      const query = new URLSearchParams({ dateFrom, dateTo, accountId, connectionId });
      const response = await fetch(`/api/integrations/tbank/statement?${query}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Не удалось загрузить выписку.");
      setData(result);
    } catch (error) { setError(error instanceof Error ? error.message : "Ошибка загрузки выписки."); }
    finally { setLoading(false); }
  }, [dateFrom, dateTo, accountId, connectionId]);
  const openedFromReview = useRef(false);
  useEffect(() => {
    if (!connectionId || openedFromReview.current || new URLSearchParams(window.location.search).get("review") !== "1") return;
    openedFromReview.current = true;
    void load();
  }, [connectionId, load]);
  async function assign(
    row: Operation,
    categoryId: string | null,
    options: { hiddenFromReview?: boolean; rule?: "remember" | "forget" } = {},
  ) {
    if (!data?.accountId) return;
    setSavingRows(current => ({ ...current, [row.id]: true }));
    setRowMessages(current => ({ ...current, [row.id]: { error: false, text: "Сохраняем…" } }));
    try {
      const response = await fetch("/api/integrations/tbank/classification", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: data.accountId, operationId: row.id, categoryId: categoryId || null,
          ...options, counterparty: row.counterparty, inn: row.inn,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Не удалось сохранить категорию.");
      if (options.rule) {
        await load(true);
      } else {
        setData(current => current ? { ...current, operations: current.operations.map(operation => operation.id === row.id
          ? { ...operation, categoryId: result.categoryId, hiddenFromReview: result.hiddenFromReview, categorySource: "manual" }
          : operation) } : current);
      }
      const text = options.rule === "remember" ? "Правило сохранено" : options.rule === "forget" ? "Правило удалено" : "Сохранено";
      setRowMessages(current => ({ ...current, [row.id]: { error: false, text } }));
    } catch (error) {
      setRowMessages(current => ({ ...current, [row.id]: { error: true, text: error instanceof Error ? error.message : "Не удалось сохранить категорию. Повторите попытку." } }));
    } finally { setSavingRows(current => ({ ...current, [row.id]: false })); }
  }
  async function recordCashDeposit(row: Operation) {
    if (!data?.accountId || !window.confirm("Подтвердите, что всю сумму по этой операции фактически внесли в открытую кассовую смену.")) return;
    setSavingRows(current => ({ ...current, [row.id]: true }));
    try {
      const response = await fetch("/api/integrations/tbank/cash-transfer", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: data.accountId, operationId: row.id, bankDate: row.date.slice(0, 10) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Не удалось связать операцию с кассой.");
      setData(current => current ? { ...current, operations: current.operations.map(operation =>
        operation.id === row.id ? { ...operation, cashTransferDate: result.cashDate } : operation
      ) } : current);
    } catch (error) {
      setRowMessages(current => ({ ...current, [row.id]: { error: true, text: error instanceof Error ? error.message : "Не удалось связать операцию с кассой." } }));
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
      await load(true);
    } catch (error) { setCategoryMessage({ error: true, text: error instanceof Error ? error.message : "Не удалось сохранить категорию." }); }
    finally { setSavingCategory(false); }
  }
  const currency = ({ "643": "₽", "810": "₽", "RUB": "₽", "840": "USD", "978": "EUR" } as Record<string, string>)[data?.currency ?? "RUB"] ?? data?.currency ?? "₽";
  const money = (cents: number) => `${(cents / 100).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
  const kindLabel = (kind: string) => kind === "uncategorized" ? "Без категории" : BANK_CATEGORY_KINDS.find(item => item.value === kind)?.label ?? kind;
  return <main className="eco-page eco-page--wide"><div className={`eco-fc ${styles.layout}`}>
    <header className={`eco-fc-head ${styles.pageHead}`}><div>
      <Link href="/finance">← Финансы</Link>
      <h1 className="eco-page-title">Операции по счёту</h1>
      <p className="eco-page-subtitle">Банковская выписка Т-Банка и категории движения денег.</p>
    </div><Link className="eco-btn" href="/cabinet/integrations#finance">Настройки Т-Банка</Link></header>
    <form className={`eco-fc-filters ${styles.statementFilters}`} onSubmit={event => { event.preventDefault(); void load(); }}>
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
    {error && <p className={styles.feedback} role="alert">{error}</p>}
    {loading && <p className={styles.feedback} role="status">Получаем все операции за выбранный период…</p>}
    {!data && !loading && !error && <p className={styles.feedback}>Выберите счёт и период, затем нажмите «Получить выписку».</p>}
    {data && <>
      <section aria-label="Банковские итоги">
        <div className={styles.heading}><h2>Счёт {data.accountMasked}</h2><span>{formatServiceDate(data.dateFrom)} — {formatServiceDate(data.dateTo)}</span></div>
        <dl className={styles.balances}>
          {[['Остаток на начало периода',data.openingCents],['Поступило',data.incomeCents],['Списано',data.expenseCents],['Остаток на конец периода',data.closingCents]].map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{money(Number(value))}</dd></div>)}
        </dl>
      </section>
      <section className={styles.expenseOverview} aria-labelledby="expense-chart-title">
        <div className={styles.expenseHeader}>
          <div><h2 id="expense-chart-title">Списания по категориям</h2>
            <p>Доля в списаниях за период. Внутренние переводы и внесения в кассу вынесены отдельно.</p>
          </div>
          {selectedExpense && <button type="button" className="eco-btn" onClick={() => setCategoryFilter("")}>Сбросить фильтр</button>}
        </div>
        {expenseTotal > 0 ? <div className={styles.expenseChart}>
          <div className={styles.donut}>
            <svg viewBox="0 0 160 160" aria-hidden="true">
              <circle cx="80" cy="80" r="67" fill="none" stroke="var(--eco-line, #e2ded6)" strokeWidth="16" />
              {expenseSlices.map((slice, index) => {
                const start = expenseSlices.slice(0, index).reduce((sum, previous) => sum + previous.share, 0);
                return <circle key={slice.key} cx="80" cy="80" r="67" pathLength="100" fill="none"
                  stroke={slice.color} strokeWidth="16" strokeDasharray={`${slice.share * 100} ${100 - slice.share * 100}`}
                  strokeDashoffset={-start * 100} transform="rotate(-90 80 80)"
                  opacity={selectedExpense && selectedExpense !== slice.key ? 0.3 : 1} />;
              })}
            </svg>
            <div className={styles.donutTotal}><span>Всего по категориям</span><strong>{money(expenseTotal)}</strong></div>
          </div>
          <div className={styles.expenseLegend} role="group" aria-label="Фильтр списаний по категориям">
            {expenseSlices.map(slice => <button key={slice.key} type="button" aria-pressed={selectedExpense === slice.key}
              onClick={() => setCategoryFilter(selectedExpense === slice.key ? "" : expenseFilterPrefix + slice.key)}>
              <span className={styles.legendDot} style={{ backgroundColor: slice.color }} />
              <span>{slice.name}{slice.archived ? " (архив)" : ""}</span>
              <strong>{money(slice.expenseCents)}</strong>
              <span className={styles.legendShare}>{slice.share < 0.001 ? "< 0,1%" : shareFormat.format(slice.share)}</span>
            </button>)}
          </div>
        </div> : <p className={styles.expenseEmpty}>За выбранный период нет списаний для диаграммы.</p>}
      </section>
      <section className={styles.workspace} aria-label="Банковские операции">
        <div className={styles.workspaceHeader}>
          <h2>{selectedExpense ? `Списания · ${expenseSlices.find(slice => slice.key === selectedExpense)?.name ?? "выбранная категория"}` : categoryFilter === "review" ? "Расходы к разбору" : "Операции"}</h2>
          <span role="status">Показано {visibleOperations.length} из {data.operations.length}</span>
        </div>
        <div className={styles.toolbar}>
          <div className={styles.views} role="group" aria-label="Вид операций">
            {[{ id: "", label: "Все", count: data.operations.length }, { id: "review", label: "К разбору", count: reviewCount }, { id: "hidden", label: "Скрытые", count: hiddenCount }].map(view => (
              <button key={view.id} type="button" aria-pressed={categoryFilter === view.id} onClick={() => setCategoryFilter(view.id)}>
                {view.label} <span>{view.count}</span>
              </button>
            ))}
          </div>
          <label className={styles.filter}><span>Категория</span>
            <select value={selectedExpense ?? (categoryFilter === "review" || categoryFilter === "hidden" ? "" : categoryFilter)} onChange={event => setCategoryFilter(event.target.value)}>
              <option value="">Все категории</option><option value="uncategorized">Без категории · {uncategorizedCount}</option>
              {data.categories.map(category => <option key={category.id} value={category.id}>{category.name}{category.archived ? " (архив)" : ""}</option>)}
            </select>
          </label>
        </div>
        {!data.accountId && <p>Для назначения категорий обновите расчётный счёт в настройках интеграции.</p>}
        {visibleOperations.length === 0 ? <p className={styles.feedback}>{categoryFilter === "review" ? "За выбранный период нет расходов к разбору." : categoryFilter ? "В выбранном периоде нет операций по этому фильтру." : "За этот период операций нет."}</p> : <div className={styles.tableScroll}><table className={`eco-table ${styles.operationTable}`} role="table">
          <thead role="rowgroup"><tr role="row"><th scope="col" role="columnheader">Дата</th><th scope="col" role="columnheader">Операция</th><th scope="col" role="columnheader">Сумма</th><th scope="col" role="columnheader">Категория</th></tr></thead>
          <tbody role="rowgroup">{visibleOperations.map((row,index) => <tr role="row" key={`${row.id}-${index}`}>
            <td role="cell" className={styles.date}>{formatServiceDate(row.date)}</td>
            <td role="cell" className={styles.operationInfo}>
              <strong>{row.counterparty || (row.direction === "internal" ? "Перевод внутри счёта" : "Контрагент не указан")}</strong>
              {row.purpose && <span>{row.purpose}</span>}
              {(row.id || row.inn) && <details className={styles.requisites}><summary>Реквизиты</summary>
                {row.inn && <div>ИНН {row.inn}</div>}{row.id && <div>Операция {row.id}</div>}
              </details>}
            </td>
            <td role="cell" className={`${styles.amount} ${styles.operationAmount}`}><strong>
              {row.direction === "expense" ? "−" : row.direction === "income" ? "+" : ""}{money(row.amountCents)}
            </strong>{row.direction === "internal" && <small>Внутренний перевод</small>}</td>
            <td role="cell" className={styles.operationCategory}>{row.cashTransferDate ? <strong>Внесено в кассу · {formatServiceDate(row.cashTransferDate)}</strong> : <><select aria-label={`Категория операции ${row.id}`} value={row.categoryId ?? ""} disabled={!data.accountId || !row.id || busy} onChange={event => void assign(row,event.target.value)}>
              <option value="">Без категории</option>
              {BANK_CATEGORY_KINDS.map(kind => <optgroup key={kind.value} label={kind.label}>{data.categories.filter(category => category.kind === kind.value && (!category.archived || category.id === row.categoryId)).map(category => <option key={category.id} value={category.id} disabled={category.archived}>{category.name}{category.archived ? " (архив)" : ""}</option>)}</optgroup>)}
            </select>
              {row.categorySource === "automatic" && <small className={styles.muted}>Назначена автоматически</small>}
              {row.hiddenFromReview && <small className={styles.muted}>Скрыта из разбора</small>}
              {data.accountId && row.id && row.direction === "expense" && (
                <div className={styles.rowActions}>
                  {!row.categoryId && <button type="button" className={styles.categoryLink} disabled={busy} onClick={() => void assign(row, null, { hiddenFromReview: !row.hiddenFromReview })}>
                    {row.hiddenFromReview ? "Вернуть к разбору" : "Скрыть из разбора"}
                  </button>}
                  {row.canRemember && row.categoryId && !data.categories.find(category => category.id === row.categoryId)?.archived && (
                    <button type="button" className={styles.categoryLink} disabled={busy} onClick={() => void assign(row, row.categoryId, { rule: "remember" })}>
                      {row.hasRule ? "Обновить правило" : "Запомнить для получателя"}
                    </button>
                  )}
                  {row.hasRule && <button type="button" className={styles.categoryLink} disabled={busy} onClick={() => void assign(row, null, { rule: "forget" })}>Удалить правило</button>}
                  <button type="button" className={styles.categoryLink} disabled={busy} onClick={() => void recordCashDeposit(row)}>Подтвердить внесение в кассу</button>
                </div>
              )}</>}
              {rowMessages[row.id] && <small role={rowMessages[row.id].error ? "alert" : "status"} className={rowMessages[row.id].error ? styles.rowError : styles.muted}>{rowMessages[row.id].text}</small>}</td>
          </tr>)}</tbody>
        </table></div>}
      </section>
      <details className={styles.manager}>
        <summary>Подробная сводка по категориям</summary>
        <p className={styles.muted}>Операций без категории: {uncategorizedCount}. Подтверждённые внесения из банка показаны в списке операций.</p>
        <div className={styles.tableScroll}><table className="eco-table"><thead><tr><th scope="col">Категория</th><th scope="col">Вид</th><th scope="col">Операций</th><th scope="col">Поступило</th><th scope="col">Списано</th></tr></thead>
          <tbody>{summaries.map(summary => <tr key={summary.categoryId ?? "uncategorized"}>
            <td><button type="button" className={styles.categoryLink} onClick={() => setCategoryFilter(summary.categoryId ?? "uncategorized")}>{summary.name}{summary.archived ? " (архив)" : ""}</button></td>
            <td>{kindLabel(summary.kind)}</td><td>{summary.count}</td><td className={styles.amount}>{money(summary.incomeCents)}</td><td className={styles.amount}>{money(summary.expenseCents)}</td>
          </tr>)}</tbody>
        </table></div>
        {summaries.length === 0 && <p>В этом периоде нет операций для статистики.</p>}
      </details>
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
    </>}
  </div></main>;
}
