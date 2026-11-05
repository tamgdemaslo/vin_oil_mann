"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { FinanceMoneyMovements } from "@/lib/finance-money-movements";

type BranchReport = FinanceMoneyMovements & { branchId: string; branchName: string };
const money = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB" });
const columns = ["cashIn", "cashOut", "bankIn", "bankOut"] as const;
const moneyCell = (cents: number) => money.format(cents / 100);

export default function MoneyMovements({ dateFrom, dateTo, refreshedAt }: {
  dateFrom: string; dateTo: string; refreshedAt?: string;
}) {
  const [reports, setReports] = useState<BranchReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ dateFrom, dateTo });
    async function load() {
      try {
        const response = await fetch(`/api/finance/movements?${query}`, { cache: "no-store", signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Не удалось загрузить движение денег.");
        if (!controller.signal.aborted) setReports(data);
      } catch (error) {
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Не удалось загрузить движение денег.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [dateFrom, dateTo, refreshedAt]);

  const totals = { cashIn: 0, cashOut: 0, bankIn: 0, bankOut: 0 };
  const categories = new Map<string, BranchReport["categories"][number]>();
  for (const report of reports) {
    for (const category of report.categories) {
      const key = category.name.trim().toLocaleLowerCase("ru-RU");
      const row = categories.get(key) ?? { name: category.name, cashIn: 0, cashOut: 0, bankIn: 0, bankOut: 0 };
      for (const column of columns) {
        row[column] += category[column];
        totals[column] += category[column];
      }
      categories.set(key, row);
    }
  }
  const rows = [...categories.values()].sort((a, b) => b.cashOut + b.bankOut - a.cashOut - a.bankOut || a.name.localeCompare(b.name, "ru"));
  const partial = reports.some(report => report.cashIncomplete || report.bankIncomplete);
  const sum = (key: "matchedBankOut" | "depositedCash" | "unlinkedTransferOut" | "unlinkedCashOut" | "transferBankIn" | "transferBankOut") =>
    reports.reduce((total, report) => total + report[key], 0);
  return (
    <section className="eco-fc-panel" aria-label="Фактическое движение денег" aria-busy={loading}>
      <div className="eco-fc-section-head">
        <div><h2>Фактическое движение денег</h2>
          <p>Кассовые смены и выписки Т-Банка за выбранный период по выбранным филиалам целиком. Наличные продажи показаны с учётом возвратов.</p>
        </div>
        {reports.length === 1 && <Link className="eco-btn" href="/finance/bank">Операции по счёту</Link>}
      </div>
      {loading && <p role="status">Загружаем кассу и банковские выписки…</p>}
      {error && <p role="alert">{error}</p>}
      {!loading && !error && <>
        {partial && <p role="status">Итоги по доступным данным. Не удалось получить все данные по следующим источникам: {reports
          .filter(report => report.cashIncomplete || report.bankIncomplete)
          .map(report => `${report.branchName} (${[report.cashIncomplete && "касса", report.bankIncomplete && "банк"].filter(Boolean).join(", ")})`).join("; ")}.</p>}
        <div className="eco-fc-definition-grid">
          <div><span>Пришло</span><strong>{moneyCell(totals.cashIn + totals.bankIn)}</strong></div>
          <div><span>Ушло</span><strong>{moneyCell(totals.cashOut + totals.bankOut)}</strong></div>
          <div><span>Чистый поток</span><strong>{moneyCell(totals.cashIn + totals.bankIn - totals.cashOut - totals.bankOut)}</strong></div>
        </div>
        <div className="eco-table-wrap">
          <table className="eco-table">
            <thead><tr><th scope="col">Категория</th><th scope="col">Касса · приход</th><th scope="col">Касса · расход</th><th scope="col">Банк · приход</th><th scope="col">Банк · расход</th></tr></thead>
            <tbody>{rows.map(row => <tr key={row.name}><th scope="row">{row.name}</th>{columns.map(column => <td className="is-number" key={column}>{moneyCell(row[column])}</td>)}</tr>)}</tbody>
            <tfoot><tr><th scope="row">Итого</th>{columns.map(column => <td className="is-number" key={column}>{moneyCell(totals[column])}</td>)}</tr></tfoot>
          </table>
        </div>
        <p>Банк → касса: списано {moneyCell(sum("matchedBankOut"))}, внесено {moneyCell(sum("depositedCash"))}. Даты списания и внесения могут приходиться на разные периоды.</p>
        {(sum("transferBankIn") > 0 || sum("transferBankOut") > 0) && <p>Другие внутренние движения по банку: приход {moneyCell(sum("transferBankIn"))}, расход {moneyCell(sum("transferBankOut"))}.</p>}
        {(sum("unlinkedTransferOut") > 0 || sum("unlinkedCashOut") > 0) && <p>На сверку: снятия для кассы без подтверждённого внесения {moneyCell(sum("unlinkedTransferOut"))}, изъятия из кассы {moneyCell(sum("unlinkedCashOut"))}.</p>}
      </>}
    </section>
  );
}
