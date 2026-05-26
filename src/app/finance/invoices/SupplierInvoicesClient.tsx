"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

type SupplierInvoice = {
  id: string;
  number: string;
  invoiceDate: string;
  dueDate: string;
  status: string;
  sum: number;
  counterpartyName: string;
  document: {
    id: string;
    name: string;
    type: string;
    documentDate: string;
    moment: string;
    applicable: boolean;
    storeName: string;
    counterpartyName: string;
    sum: number;
  };
};

type InvoiceResponse = {
  meta?: { total: number; limit: number; offset: number };
  invoices?: SupplierInvoice[];
  error?: string;
};

async function readJson<T>(res: Response): Promise<T | null> {
  try {
    return await res.json() as T;
  } catch {
    return null;
  }
}

function formatMoney(value: number | null | undefined) {
  return Number(value ?? 0).toLocaleString("ru-RU", { style: "currency", currency: "RUB" });
}

function statusLabel(value: string) {
  if (value === "paid") return "Оплачен";
  if (value === "partial") return "Частично";
  return "Не оплачен";
}

function statusClass(value: string) {
  if (value === "paid") return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300";
  if (value === "partial") return "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300";
  return "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200";
}

export default function SupplierInvoicesClient() {
  const searchParams = useSearchParams();
  const requestedInvoiceId = searchParams.get("invoice");
  const [invoices, setInvoices] = useState<SupplierInvoice[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [openId, setOpenId] = useState<string | null>(requestedInvoiceId);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const summary = useMemo(() => {
    const unpaid = invoices.filter((invoice) => invoice.status !== "paid");
    return {
      visibleSum: invoices.reduce((sum, invoice) => sum + invoice.sum, 0),
      unpaidSum: unpaid.reduce((sum, invoice) => sum + invoice.sum, 0),
      unpaidCount: unpaid.length,
    };
  }, [invoices]);

  async function load(nextSearch = search, nextStatus = status) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (nextSearch.trim()) params.set("search", nextSearch.trim());
      if (nextStatus) params.set("status", nextStatus);
      const res = await fetch(`/api/local-inventory/supplier-invoices?${params.toString()}`, { cache: "no-store" });
      const data = await readJson<InvoiceResponse>(res);
      if (!res.ok) throw new Error(data?.error ?? "Не удалось загрузить счета");
      setInvoices(Array.isArray(data?.invoices) ? data.invoices : []);
      setTotal(data?.meta?.total ?? 0);
    } catch (e) {
      setInvoices([]);
      setTotal(0);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (requestedInvoiceId) setOpenId(requestedInvoiceId);
  }, [requestedInvoiceId]);

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">Счета поставщиков</h2>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Все счета, созданные из локальных приёмок.
            </p>
          </div>
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void load(search, status);
            }}
          >
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Номер, поставщик, приёмка"
              className="w-56 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            />
            <select
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                void load(search, event.target.value);
              }}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            >
              <option value="">Все статусы</option>
              <option value="unpaid">Не оплачены</option>
              <option value="partial">Частично</option>
              <option value="paid">Оплачены</option>
            </select>
            <button
              type="submit"
              className="rounded-lg bg-zinc-950 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950"
            >
              Найти
            </button>
          </form>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-950">
            <div className="text-xs font-medium text-zinc-500">Счетов в выборке</div>
            <div className="mt-1 text-xl font-semibold text-zinc-950 dark:text-zinc-50">{invoices.length} из {total}</div>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-950">
            <div className="text-xs font-medium text-zinc-500">Сумма выборки</div>
            <div className="mt-1 text-xl font-semibold tabular-nums text-zinc-950 dark:text-zinc-50">
              {formatMoney(summary.visibleSum)}
            </div>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/60 dark:bg-amber-950/30">
            <div className="text-xs font-medium text-amber-700 dark:text-amber-300">К оплате</div>
            <div className="mt-1 text-xl font-semibold tabular-nums text-zinc-950 dark:text-zinc-50">
              {formatMoney(summary.unpaidSum)}
            </div>
            <div className="mt-1 text-xs text-amber-700 dark:text-amber-300">{summary.unpaidCount} сч.</div>
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
            {error}
          </div>
        )}

        <div className="mt-4 space-y-3">
          {loading && (
            <div className="rounded-lg border border-zinc-200 px-4 py-8 text-center text-sm text-zinc-500 dark:border-zinc-800">
              Загрузка...
            </div>
          )}
          {!loading && invoices.length === 0 && (
            <div className="rounded-lg border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
              Счетов пока нет.
            </div>
          )}
          {!loading && invoices.map((invoice) => {
            const open = openId === invoice.id;
            return (
              <div key={invoice.id} className="rounded-lg border border-zinc-200 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : invoice.id)}
                  className="block w-full px-4 py-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/70"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-zinc-950 dark:text-zinc-50">
                          Счёт {invoice.number || "без номера"}
                        </span>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusClass(invoice.status)}`}>
                          {statusLabel(invoice.status)}
                        </span>
                      </div>
                      <div className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                        {invoice.invoiceDate}
                        {invoice.dueDate ? ` · оплатить до ${invoice.dueDate}` : ""}
                      </div>
                      <div className="mt-1 text-xs text-zinc-500">{invoice.counterpartyName || "без поставщика"}</div>
                    </div>
                    <div className="shrink-0 text-left sm:text-right">
                      <div className="font-semibold tabular-nums text-zinc-950 dark:text-zinc-50">
                        {formatMoney(invoice.sum)}
                      </div>
                      <div className="mt-1 text-xs text-zinc-500">{invoice.document.name}</div>
                    </div>
                  </div>
                </button>
                {open && (
                  <div className="border-t border-zinc-200 px-4 py-3 text-sm dark:border-zinc-800">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <div className="text-xs font-medium text-zinc-500">Поставщик</div>
                        <div className="mt-1 text-zinc-950 dark:text-zinc-50">{invoice.counterpartyName || "не указан"}</div>
                      </div>
                      <div>
                        <div className="text-xs font-medium text-zinc-500">Складской документ</div>
                        <Link
                          href={`/inventory/receipts?document=${invoice.document.id}`}
                          className="mt-1 inline-flex rounded-lg border border-zinc-300 px-3 py-2 font-medium text-zinc-800 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-800"
                        >
                          {invoice.document.name}
                        </Link>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
