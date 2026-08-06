"use client";

import { useState, useEffect, useCallback } from "react";

type Meta = { href: string; type: string; mediaType: string };

export type CatalogRow = {
  id: string;
  name: string;
  meta: Meta;
  price: number;
  currency: string;
  stock: number;
  reserve?: number;
  quantity?: number;
};

type CatalogModalProps = {
  open: boolean;
  onClose: () => void;
  storeId: string;
  onSelect: (items: { name: string; quantity: number; price: number; meta: Meta; currency?: string }[]) => void;
};

export function CatalogModal({ open, onClose, storeId, onSelect }: CatalogModalProps) {
  const [search, setSearch] = useState("");
  const [oem, setOem] = useState("");
  const [params, setParams] = useState("");
  const [rows, setRows] = useState<CatalogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [searchTrigger, setSearchTrigger] = useState(0);

  const fetchCatalog = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams();
      if (search.trim()) query.set("search", search.trim());
      if (storeId) query.set("storeId", storeId);
      if (oem.trim()) query.set("oem", oem.trim());
      if (params.trim()) query.set("params", params.trim());
      query.set("limit", "50");
      const res = await fetch(`/api/local-inventory/catalog?${query.toString()}`);
      const data = await res.json();
      setError(data.error ?? null);
      if (res.ok && Array.isArray(data.rows)) {
        setRows(data.rows);
        setQuantities((prev) => {
          const next = { ...prev };
          for (const r of data.rows) {
            if (next[r.id] === undefined) next[r.id] = 1;
          }
          return next;
        });
      } else {
        setRows([]);
      }
    } catch {
      setRows([]);
      setError("Ошибка запроса");
    } finally {
      setLoading(false);
    }
  }, [search, storeId, oem, params]);

  useEffect(() => {
    if (!open) return;
    fetchCatalog();
  }, [open, searchTrigger, fetchCatalog]);

  const handleQuantityChange = (id: string, value: number) => {
    setQuantities((prev) => ({ ...prev, [id]: Math.max(0, value) }));
  };

  const handleSelect = () => {
    const selected = rows
      .filter((r) => (quantities[r.id] ?? 0) > 0)
      .map((r) => ({
        name: r.name,
        quantity: quantities[r.id] ?? 1,
        price: r.price,
        meta: r.meta,
        currency: r.currency,
      }));
    if (selected.length > 0) {
      onSelect(selected);
      onClose();
      setSearch("");
      setOem("");
      setParams("");
      setQuantities({});
      setError(null);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-700">
          <h2 className="text-lg font-semibold text-zinc-800 dark:text-zinc-100">Выбор товара</h2>
        </div>

        <div className="space-y-3 p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="block text-xs font-medium text-zinc-500">Наименование, код или артикул</label>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && setSearchTrigger((t) => t + 1)}
                placeholder="Поиск..."
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-900"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-500">OEM Parts / кросс-номера / аналоги</label>
              <input
                type="text"
                value={oem}
                onChange={(e) => setOem(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && setSearchTrigger((t) => t + 1)}
                placeholder="OEM, MANN/POMAN, аналоги"
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-900"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-500">Параметры</label>
              <input
                type="text"
                value={params}
                onChange={(e) => setParams(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && setSearchTrigger((t) => t + 1)}
                placeholder="Фильтр по параметрам"
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-900"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setSearchTrigger((t) => t + 1)}
              className="rounded-lg bg-zinc-200 px-4 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-300 dark:bg-zinc-600 dark:text-zinc-100 dark:hover:bg-zinc-500"
            >
              Найти
            </button>
          </div>
        </div>

        <div className="max-h-[50vh] overflow-auto border-t border-zinc-200 p-4 dark:border-zinc-700">
          {error && (
            <p className="mb-2 rounded bg-amber-100 py-2 px-3 text-sm text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
              {error}
            </p>
          )}
          {loading ? (
            <p className="py-4 text-center text-sm text-zinc-500">Загрузка…</p>
          ) : rows.length === 0 ? (
            <p className="py-4 text-center text-sm text-zinc-500">Ничего не найдено. Измените фильтры или поиск.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left dark:border-zinc-700">
                  <th className="px-2 py-2 font-medium text-zinc-500">Наименование</th>
                  <th className="px-2 py-2 text-right font-medium text-zinc-500">Остаток</th>
                  <th className="px-2 py-2 text-right font-medium text-zinc-500">Цена продажи</th>
                  <th className="px-2 py-2 text-right font-medium text-zinc-500">Кол-во</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-zinc-100 dark:border-zinc-700">
                    <td className="px-2 py-2">{r.name}</td>
                    <td className="px-2 py-2 text-right">{r.stock ?? ""}</td>
                    <td className="px-2 py-2 text-right">
                      {r.price.toLocaleString("ru-RU", { minimumFractionDigits: 2 })} {r.currency}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <input
                        type="number"
                        min={0}
                        value={quantities[r.id] ?? 1}
                        onChange={(e) => handleQuantityChange(r.id, Number(e.target.value) || 0)}
                        className="w-20 rounded border border-zinc-300 bg-white px-2 py-1 text-right text-sm dark:border-zinc-600 dark:bg-zinc-900"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-zinc-200 p-4 dark:border-zinc-700">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-600"
          >
            Отменить
          </button>
          <button
            type="button"
            onClick={handleSelect}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          >
            Выбрать
          </button>
        </div>
      </div>
    </div>
  );
}
