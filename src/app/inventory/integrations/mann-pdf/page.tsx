"use client";

import { useEffect, useState } from "react";
import InventoryNav from "../../InventoryNav";

type StatsResponse = {
  ok?: boolean;
  counts?: {
    filterRows: number;
    applicationRows: number;
    uniqueMakes: number;
    uniqueModels: number;
    uniqueMannArticles: number;
  };
  expected?: {
    filterRows: number;
    applicationRows: number;
    uniqueMakes: number;
    uniqueModels: number;
    uniqueMannArticles: number;
  };
  latestBatch?: {
    status: string;
    importedAt: string;
    applicationsSourceFile?: string | null;
    filtersSourceFile?: string | null;
    errorsJson?: unknown;
  } | null;
  error?: string;
};

type ImportResult = {
  ok?: boolean;
  result?: {
    applicationRows: number;
    filterRows: number;
    uniqueMakes: number;
    uniqueModels: number;
    uniqueMannArticles: number;
    filterTypeCounts: Record<string, number>;
    warnings: string[];
    batchId?: string;
  };
  error?: string;
};

function statLabel(value?: number): string {
  return typeof value === "number" ? value.toLocaleString("ru-RU") : "—";
}

export default function MannPdfIntegrationPage() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [applications, setApplications] = useState<File | null>(null);
  const [filters, setFilters] = useState<File | null>(null);
  const [summary, setSummary] = useState<File | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [loading, setLoading] = useState(false);

  async function loadStats() {
    const response = await fetch("/api/mann-catalog/import", { cache: "no-store" });
    setStats(await response.json());
  }

  useEffect(() => {
    void loadStats();
  }, []);

  async function submitImport(dryRun: boolean) {
    if (!applications || !filters) {
      setResult({ error: "Выберите applications CSV и filters_long CSV" });
      return;
    }
    const form = new FormData();
    form.set("applications", applications);
    form.set("filters", filters);
    if (summary) form.set("summary", summary);
    if (dryRun) form.set("dryRun", "1");
    setLoading(true);
    setResult(null);
    try {
      const response = await fetch("/api/mann-catalog/import", { method: "POST", body: form });
      const json = await response.json();
      setResult(json);
      if (response.ok && !dryRun) await loadStats();
    } catch (error) {
      setResult({ error: error instanceof Error ? error.message : "Не удалось выполнить импорт" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <InventoryNav />
      <section className="eco-card eco-card--padded">
        <div className="eco-card__head">
          <div>
            <div className="eco-page-kicker">Интеграции</div>
            <h1>MANN PDF база</h1>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-5">
          <div className="eco-mini-stat"><span>Строк фильтров</span><strong>{statLabel(stats?.counts?.filterRows)}</strong></div>
          <div className="eco-mini-stat"><span>Применяемость</span><strong>{statLabel(stats?.counts?.applicationRows)}</strong></div>
          <div className="eco-mini-stat"><span>Марки</span><strong>{statLabel(stats?.counts?.uniqueMakes)}</strong></div>
          <div className="eco-mini-stat"><span>Модели</span><strong>{statLabel(stats?.counts?.uniqueModels)}</strong></div>
          <div className="eco-mini-stat"><span>Артикулы MANN</span><strong>{statLabel(stats?.counts?.uniqueMannArticles)}</strong></div>
        </div>

        {stats?.latestBatch ? (
          <p className="mt-4 text-sm text-[var(--eco-muted)]">
            Последний импорт: {new Date(stats.latestBatch.importedAt).toLocaleString("ru-RU")} · {stats.latestBatch.status}
          </p>
        ) : (
          <p className="mt-4 text-sm text-[var(--eco-muted)]">Импортов пока нет.</p>
        )}
        {stats?.error ? <p className="mt-2 text-sm text-red-600">{stats.error}</p> : null}
      </section>

      <section className="eco-card eco-card--padded mt-4">
        <div className="eco-card__head">
          <div>
            <div className="eco-page-kicker">CSV</div>
            <h2>Загрузить базу</h2>
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <label className="eco-field">
            <span>mann_pdf_applications.csv</span>
            <input className="eco-input" type="file" accept=".csv,text/csv" onChange={(event) => setApplications(event.target.files?.[0] ?? null)} />
          </label>
          <label className="eco-field">
            <span>mann_pdf_filters_long.csv</span>
            <input className="eco-input" type="file" accept=".csv,text/csv" onChange={(event) => setFilters(event.target.files?.[0] ?? null)} />
          </label>
          <label className="eco-field">
            <span>mann_pdf_catalog_summary.json</span>
            <input className="eco-input" type="file" accept=".json,application/json" onChange={(event) => setSummary(event.target.files?.[0] ?? null)} />
          </label>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button className="eco-btn" type="button" disabled={loading} onClick={() => void submitImport(true)}>
            Проверить dry-run
          </button>
          <button className="eco-btn eco-btn--primary" type="button" disabled={loading} onClick={() => void submitImport(false)}>
            {loading ? "Импорт..." : "Импортировать"}
          </button>
        </div>
        {result?.error ? <p className="mt-3 text-sm text-red-600">{result.error}</p> : null}
        {result?.result ? (
          <div className="mt-4 rounded border border-[var(--eco-line)] p-3 text-sm">
            <strong>Подготовлено: {statLabel(result.result.filterRows)} строк фильтров</strong>
            <p className="mt-1 text-[var(--eco-muted)]">
              Марки: {statLabel(result.result.uniqueMakes)} · модели: {statLabel(result.result.uniqueModels)} · артикулы: {statLabel(result.result.uniqueMannArticles)}
            </p>
            {result.result.warnings.length > 0 ? (
              <ul className="mt-2 list-disc pl-5 text-amber-700">
                {result.result.warnings.map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
            ) : (
              <p className="mt-2 text-emerald-700">Контрольные количества совпали с summary.</p>
            )}
          </div>
        ) : null}
      </section>
    </>
  );
}
