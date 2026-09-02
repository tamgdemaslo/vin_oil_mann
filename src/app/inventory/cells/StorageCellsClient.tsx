"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  ChevronLeft,
  ChevronRight,
  MapPin,
  PackageOpen,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import InventoryNav from "../InventoryNav";

type Store = { id: string; name: string; isMain?: boolean; archived?: boolean; branchName?: string };
type CellStatus = "occupied" | "free" | "archived";
type Cell = {
  id: string;
  storeId: string;
  code: string;
  name: string;
  zone: string;
  comment: string;
  archived: boolean;
  productCount: number;
  usedInDocuments: boolean;
  status: CellStatus;
  createdAt: string;
  updatedAt: string;
};
type CellList = {
  store: Store;
  cells: Cell[];
  summary: { total: number; occupied: number; free: number; archived: number };
  meta: { total: number; limit: number; offset: number };
  canManage: boolean;
};
type CellProduct = { id: string; name: string; article: string; quantity: number; available: number; uomName: string };
type Editor = { mode: "new" | "edit"; cell?: Cell } | null;

const PAGE_SIZE = 50;

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error((data as { error?: string }).error || "Не удалось выполнить запрос") as Error & {
      code?: string;
      productCount?: number;
    };
    error.code = (data as { code?: string }).code;
    error.productCount = (data as { productCount?: number }).productCount;
    throw error;
  }
  return data as T;
}

function statusLabel(status: CellStatus) {
  if (status === "occupied") return "Занята";
  if (status === "archived") return "Архив";
  return "Свободна";
}

export default function StorageCellsClient() {
  const [stores, setStores] = useState<Store[]>([]);
  const [storeId, setStoreId] = useState("");
  const [data, setData] = useState<CellList | null>(null);
  const [search, setSearch] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("code");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editor, setEditor] = useState<Editor>(null);
  const [saving, setSaving] = useState(false);
  const [activeCell, setActiveCell] = useState<Cell | null>(null);
  const [products, setProducts] = useState<CellProduct[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [deleteCell, setDeleteCell] = useState<Cell | null>(null);
  const [reassignToCellId, setReassignToCellId] = useState("");
  const [reassignTargets, setReassignTargets] = useState<Cell[]>([]);
  const [reassignTargetsLoading, setReassignTargetsLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await readJson<{ stores?: Store[] }>(await fetch("/api/local-inventory/stores", { cache: "no-store" }));
        if (cancelled) return;
        const activeStores = (result.stores ?? []).filter((store) => !store.archived);
        setStores(activeStores);
        setStoreId((current) => current || activeStores.find((store) => store.isMain)?.id || activeStores[0]?.id || "");
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Не удалось загрузить склады");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const loadCells = useCallback(async () => {
    if (!storeId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      search,
      status,
      sort,
      direction,
      limit: String(PAGE_SIZE),
      offset: String(offset),
    });
    try {
      const next = await readJson<CellList>(await fetch(`/api/local-inventory/stores/${encodeURIComponent(storeId)}/cells?${params}`, { cache: "no-store" }));
      setData(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось загрузить ячейки");
    } finally {
      setLoading(false);
    }
  }, [direction, offset, search, sort, status, storeId]);

  useEffect(() => { void loadCells(); }, [loadCells]);

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pages = Math.max(1, Math.ceil((data?.meta.total ?? 0) / PAGE_SIZE));

  useEffect(() => {
    if (!deleteCell?.productCount || !storeId) {
      setReassignTargets([]);
      setReassignTargetsLoading(false);
      return;
    }
    let cancelled = false;
    setReassignTargetsLoading(true);
    void (async () => {
      try {
        const targets: Cell[] = [];
        let targetOffset = 0;
        let total = Number.POSITIVE_INFINITY;
        while (targetOffset < total) {
          const params = new URLSearchParams({ status: "all", limit: "100", offset: String(targetOffset), sort: "code" });
          const result = await readJson<CellList>(await fetch(
            `/api/local-inventory/stores/${encodeURIComponent(storeId)}/cells?${params}`,
            { cache: "no-store" },
          ));
          targets.push(...result.cells.filter((cell) => cell.id !== deleteCell.id));
          total = result.meta.total;
          if (!result.cells.length) break;
          targetOffset += result.cells.length;
        }
        if (!cancelled) setReassignTargets(targets);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Не удалось загрузить ячейки для переноса");
      } finally {
        if (!cancelled) setReassignTargetsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [deleteCell, storeId]);

  async function saveCell(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor || !storeId) return;
    const form = new FormData(event.currentTarget);
    const body = {
      code: String(form.get("code") ?? ""),
      name: String(form.get("name") ?? ""),
      zone: String(form.get("zone") ?? ""),
      comment: String(form.get("comment") ?? ""),
    };
    setSaving(true);
    setError("");
    try {
      const url = editor.mode === "new"
        ? `/api/local-inventory/stores/${encodeURIComponent(storeId)}/cells`
        : `/api/local-inventory/stores/${encodeURIComponent(storeId)}/cells/${encodeURIComponent(editor.cell!.id)}`;
      await readJson(await fetch(url, {
        method: editor.mode === "new" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }));
      setNotice(editor.mode === "new" ? "Ячейка создана" : "Ячейка обновлена");
      setEditor(null);
      await loadCells();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось сохранить ячейку");
    } finally {
      setSaving(false);
    }
  }

  async function toggleArchive(cell: Cell) {
    if (!storeId) return;
    setError("");
    try {
      await readJson(await fetch(`/api/local-inventory/stores/${encodeURIComponent(storeId)}/cells/${encodeURIComponent(cell.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: !cell.archived }),
      }));
      setNotice(cell.archived ? "Ячейка восстановлена" : "Ячейка перемещена в архив");
      await loadCells();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось изменить статус ячейки");
    }
  }

  async function confirmDelete() {
    if (!deleteCell || !storeId) return;
    setDeleting(true);
    setError("");
    try {
      const result = await readJson<{ archived: boolean; productCount: number }>(await fetch(
        `/api/local-inventory/stores/${encodeURIComponent(storeId)}/cells/${encodeURIComponent(deleteCell.id)}`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reassignToCellId: reassignToCellId || undefined }),
        },
      ));
      setNotice(result.archived ? "Товары переназначены, ячейка сохранена в архиве" : "Пустая ячейка удалена");
      setDeleteCell(null);
      setReassignToCellId("");
      await loadCells();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось удалить ячейку");
    } finally {
      setDeleting(false);
    }
  }

  async function openProducts(cell: Cell) {
    if (!storeId) return;
    setActiveCell(cell);
    setProducts([]);
    setProductsLoading(true);
    try {
      const result = await readJson<{ products: CellProduct[] }>(await fetch(
        `/api/local-inventory/stores/${encodeURIComponent(storeId)}/cells/${encodeURIComponent(cell.id)}/products`,
        { cache: "no-store" },
      ));
      setProducts(result.products);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось загрузить товары ячейки");
    } finally {
      setProductsLoading(false);
    }
  }

  return (
    <>
      <InventoryNav />
      <section className="space-y-4">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--eco-muted)]">Склад / Ячейки</div>
            <h1 className="eco-page-title mt-1">Ячейки хранения</h1>
            <p className="mt-1 max-w-2xl text-sm text-[var(--eco-muted)]">Справочник мест хранения. У товара может быть одна текущая ячейка на каждом складе.</p>
          </div>
          <button type="button" className="eco-btn eco-btn--primary" disabled={!data?.canManage || !storeId} onClick={() => setEditor({ mode: "new" })}>
            <Plus aria-hidden className="eco-icon" /> Создать ячейку
          </button>
        </header>

        {error ? <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">{error}</div> : null}
        {notice ? <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800" role="status">{notice}</div> : null}

        <div className="grid gap-px overflow-hidden rounded-lg border border-[var(--eco-line)] bg-[var(--eco-line)] sm:grid-cols-4">
          {[
            ["Всего", data?.summary.total ?? 0],
            ["Заняты", data?.summary.occupied ?? 0],
            ["Свободны", data?.summary.free ?? 0],
            ["В архиве", data?.summary.archived ?? 0],
          ].map(([label, value]) => (
            <div key={String(label)} className="bg-[var(--eco-surface)] px-4 py-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-[var(--eco-muted)]">{label}</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-[var(--eco-line)] bg-[var(--eco-surface)] p-3">
          <label className="min-w-56 flex-1 text-xs font-semibold text-[var(--eco-muted)]">Склад
            <select className="eco-input mt-1 w-full" value={storeId} onChange={(event) => { setStoreId(event.target.value); setOffset(0); }}>
              {stores.map((store) => <option key={store.id} value={store.id}>{store.name}{store.isMain ? " · основной" : ""}</option>)}
            </select>
          </label>
          <form className="min-w-64 flex-[2]" onSubmit={(event) => { event.preventDefault(); setSearch(searchDraft.trim()); setOffset(0); }}>
            <label className="text-xs font-semibold text-[var(--eco-muted)]">Поиск по коду, названию или зоне</label>
            <div className="mt-1 flex gap-2">
              <div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--eco-muted)]" /><input className="eco-input w-full pl-9" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Например, A-12" /></div>
              <button className="eco-btn" type="submit">Найти</button>
            </div>
          </form>
          <label className="min-w-40 text-xs font-semibold text-[var(--eco-muted)]">Статус
            <select className="eco-input mt-1 w-full" value={status} onChange={(event) => { setStatus(event.target.value); setOffset(0); }}>
              <option value="all">Активные</option><option value="occupied">Занятые</option><option value="free">Свободные</option><option value="archived">Архив</option>
            </select>
          </label>
          <label className="min-w-44 text-xs font-semibold text-[var(--eco-muted)]">Сортировка
            <select className="eco-input mt-1 w-full" value={`${sort}:${direction}`} onChange={(event) => { const [nextSort, nextDirection] = event.target.value.split(":"); setSort(nextSort); setDirection(nextDirection as "asc" | "desc"); setOffset(0); }}>
              <option value="code:asc">Код А—Я</option><option value="code:desc">Код Я—А</option><option value="products:desc">Больше товаров</option><option value="createdAt:desc">Сначала новые</option>
            </select>
          </label>
          <button type="button" className="eco-icon-btn" title="Обновить" aria-label="Обновить" onClick={() => void loadCells()}><RefreshCw className={`eco-icon ${loading ? "animate-spin" : ""}`} /></button>
        </div>

        <div className="overflow-hidden rounded-lg border border-[var(--eco-line)] bg-[var(--eco-surface)]">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[840px] border-collapse text-sm">
              <thead className="bg-[var(--eco-surface-muted)] text-left text-xs uppercase tracking-wide text-[var(--eco-muted)]"><tr><th className="px-4 py-3">Код</th><th className="px-4 py-3">Название</th><th className="px-4 py-3">Зона</th><th className="px-4 py-3">Товары</th><th className="px-4 py-3">Статус</th><th className="px-4 py-3">Изменено</th><th className="px-4 py-3 text-right">Действия</th></tr></thead>
              <tbody>
                {loading ? Array.from({ length: 6 }).map((_, index) => <tr key={index} className="border-t border-[var(--eco-line)]"><td colSpan={7} className="px-4 py-4"><div className="h-5 animate-pulse rounded bg-[var(--eco-surface-muted)]" /></td></tr>) : null}
                {!loading && (data?.cells ?? []).map((cell) => (
                  <tr key={cell.id} className="border-t border-[var(--eco-line)] align-middle hover:bg-[var(--eco-surface-muted)]/60">
                    <td className="px-4 py-3"><button className="font-semibold text-[var(--eco-ink)] hover:underline" type="button" onClick={() => void openProducts(cell)}>{cell.code}</button>{cell.comment ? <div className="mt-1 max-w-xs truncate text-xs text-[var(--eco-muted)]" title={cell.comment}>{cell.comment}</div> : null}</td>
                    <td className="px-4 py-3">{cell.name || "—"}</td><td className="px-4 py-3">{cell.zone || "—"}</td>
                    <td className="px-4 py-3"><button type="button" className="inline-flex items-center gap-1 font-medium hover:underline" onClick={() => void openProducts(cell)}><PackageOpen className="h-4 w-4" />{cell.productCount}</button></td>
                    <td className="px-4 py-3"><span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${cell.status === "occupied" ? "bg-emerald-100 text-emerald-800" : cell.status === "archived" ? "bg-zinc-200 text-zinc-700" : "bg-amber-100 text-amber-800"}`}>{statusLabel(cell.status)}</span></td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-[var(--eco-muted)]">{new Intl.DateTimeFormat("ru-RU", { dateStyle: "short" }).format(new Date(cell.updatedAt))}</td>
                    <td className="px-4 py-3"><div className="flex justify-end gap-1"><button type="button" className="eco-icon-btn" title="Изменить" aria-label={`Изменить ${cell.code}`} disabled={!data?.canManage} onClick={() => setEditor({ mode: "edit", cell })}><Pencil className="eco-icon" /></button><button type="button" className="eco-icon-btn" title={cell.archived ? "Восстановить" : "В архив"} aria-label={cell.archived ? `Восстановить ${cell.code}` : `Архивировать ${cell.code}`} disabled={!data?.canManage} onClick={() => void toggleArchive(cell)}>{cell.archived ? <ArchiveRestore className="eco-icon" /> : <Archive className="eco-icon" />}</button><button type="button" className="eco-icon-btn" title="Удалить" aria-label={`Удалить ${cell.code}`} disabled={!data?.canManage} onClick={() => { setDeleteCell(cell); setReassignToCellId(""); }}><Trash2 className="eco-icon" /></button></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!loading && !data?.cells.length ? <div className="px-6 py-14 text-center"><MapPin className="mx-auto h-8 w-8 text-[var(--eco-muted)]" /><h2 className="mt-3 font-semibold">Ячейки не найдены</h2><p className="mt-1 text-sm text-[var(--eco-muted)]">Измените фильтры или создайте первую ячейку для этого склада.</p></div> : null}
          <footer className="flex items-center justify-between border-t border-[var(--eco-line)] px-4 py-3 text-sm"><span className="text-[var(--eco-muted)]">Найдено: {data?.meta.total ?? 0}</span><div className="flex items-center gap-2"><button type="button" className="eco-icon-btn" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}><ChevronLeft className="eco-icon" /></button><span className="tabular-nums">{page} / {pages}</span><button type="button" className="eco-icon-btn" disabled={page >= pages} onClick={() => setOffset(offset + PAGE_SIZE)}><ChevronRight className="eco-icon" /></button></div></footer>
        </div>
      </section>

      {editor ? <div className="fixed inset-0 z-50 flex justify-end bg-black/35" role="dialog" aria-modal="true"><div className="h-full w-full max-w-lg overflow-y-auto bg-[var(--eco-surface)] p-6 shadow-xl"><div className="flex items-start justify-between gap-4"><div><div className="text-xs font-semibold uppercase tracking-wide text-[var(--eco-muted)]">{editor.mode === "new" ? "Новая ячейка" : "Редактирование"}</div><h2 className="mt-1 text-xl font-semibold">{editor.mode === "new" ? "Создать ячейку" : editor.cell?.code}</h2></div><button type="button" className="eco-icon-btn" onClick={() => setEditor(null)} aria-label="Закрыть"><X className="eco-icon" /></button></div><form className="mt-6 space-y-4" onSubmit={saveCell}><label className="block text-sm font-semibold">Код ячейки *<input name="code" className="eco-input mt-1 w-full" defaultValue={editor.cell?.code ?? ""} required autoFocus /></label><label className="block text-sm font-semibold">Название<input name="name" className="eco-input mt-1 w-full" defaultValue={editor.cell?.name ?? ""} placeholder="Например, Стеллаж масел" /></label><label className="block text-sm font-semibold">Зона<input name="zone" className="eco-input mt-1 w-full" defaultValue={editor.cell?.zone ?? ""} placeholder="Например, Зона A" /></label><label className="block text-sm font-semibold">Комментарий<textarea name="comment" className="eco-input mt-1 min-h-28 w-full resize-y" defaultValue={editor.cell?.comment ?? ""} /></label><div className="flex justify-end gap-2 border-t border-[var(--eco-line)] pt-4"><button type="button" className="eco-btn" onClick={() => setEditor(null)}>Отмена</button><button type="submit" className="eco-btn eco-btn--primary" disabled={saving}>{saving ? "Сохранение…" : "Сохранить"}</button></div></form></div></div> : null}

      {activeCell ? <div className="fixed inset-0 z-50 flex justify-end bg-black/35" role="dialog" aria-modal="true"><div className="h-full w-full max-w-2xl overflow-y-auto bg-[var(--eco-surface)] shadow-xl"><header className="sticky top-0 flex items-start justify-between gap-4 border-b border-[var(--eco-line)] bg-[var(--eco-surface)] p-5"><div><div className="text-xs font-semibold uppercase tracking-wide text-[var(--eco-muted)]">Товары в ячейке</div><h2 className="mt-1 text-xl font-semibold">{activeCell.code}{activeCell.name ? ` · ${activeCell.name}` : ""}</h2></div><button className="eco-icon-btn" type="button" onClick={() => setActiveCell(null)} aria-label="Закрыть"><X className="eco-icon" /></button></header><div className="p-5">{productsLoading ? <p className="text-sm text-[var(--eco-muted)]">Загрузка…</p> : products.length ? <div className="divide-y divide-[var(--eco-line)] rounded-lg border border-[var(--eco-line)]">{products.map((product) => <Link key={product.id} href={`/inventory/products?product=${encodeURIComponent(product.id)}`} className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-[var(--eco-surface-muted)]"><div><div className="font-medium">{product.name}</div><div className="mt-1 text-xs text-[var(--eco-muted)]">{product.article || "Без артикула"}</div></div><div className="text-right text-sm"><div>{product.quantity} {product.uomName}</div><div className="text-xs text-[var(--eco-muted)]">Доступно {product.available}</div></div></Link>)}</div> : <div className="py-12 text-center text-sm text-[var(--eco-muted)]">В этой ячейке пока нет товаров.</div>}</div></div></div> : null}

      {deleteCell ? <div className="fixed inset-0 z-50 grid place-items-center bg-black/35 p-4" role="dialog" aria-modal="true"><div className="w-full max-w-md rounded-lg bg-[var(--eco-surface)] p-5 shadow-xl"><h2 className="text-lg font-semibold">Удалить ячейку {deleteCell.code}?</h2><p className="mt-2 text-sm text-[var(--eco-muted)]">{deleteCell.productCount ? `К ней привязано товаров: ${deleteCell.productCount}. Выберите ячейку, куда их перенести. Исходная ячейка останется в архиве для истории.` : deleteCell.usedInDocuments ? "Ячейка использовалась в документах, поэтому будет сохранена в архиве." : "Пустая ячейка будет удалена безвозвратно."}</p>{deleteCell.productCount > 0 ? <label className="mt-4 block text-sm font-semibold">Перенести товары в<select className="eco-input mt-1 w-full" value={reassignToCellId} onChange={(event) => setReassignToCellId(event.target.value)} required disabled={reassignTargetsLoading}><option value="">{reassignTargetsLoading ? "Загрузка ячеек…" : "Выберите ячейку"}</option>{reassignTargets.map((cell) => <option key={cell.id} value={cell.id}>{cell.code}{cell.name ? ` · ${cell.name}` : ""}</option>)}</select></label> : null}<div className="mt-5 flex justify-end gap-2"><button type="button" className="eco-btn" onClick={() => setDeleteCell(null)}>Отмена</button><button type="button" className="eco-btn eco-btn--danger" disabled={deleting || reassignTargetsLoading || (deleteCell.productCount > 0 && !reassignToCellId)} onClick={() => void confirmDelete()}>{deleting ? "Удаление…" : deleteCell.productCount || deleteCell.usedInDocuments ? "Переназначить и архивировать" : "Удалить"}</button></div></div></div> : null}
    </>
  );
}
