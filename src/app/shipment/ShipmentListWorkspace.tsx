"use client";

import { Check, ChevronDown, Copy, Download, Printer, SlidersHorizontal, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { EcoBadge } from "@/components/platform/EcoUI";
import { ShipmentListRow } from "./ShipmentListRow";
import { ShipmentRowActions } from "./ShipmentRowActions";

export type ShipmentListItem = {
  id: string;
  name: string;
  applicable: boolean;
  paymentStatus: "paid" | "unpaid" | "unknown";
  sum: number;
  sumLabel: string;
  moment: { date: string; time: string };
  counterpartyName: string;
  counterpartyHref: string | null;
  counterpartyId: string | null;
  phone: string;
  vehiclePrimary: string;
  vehicleSecondary: string;
  vehicleTitle: string;
  plate: string;
  vin: string;
  storeName: string;
  ecoUserName: string;
  positionCount: number;
};

type OptionalColumns = {
  phone: boolean;
  vin: boolean;
  positionCount: boolean;
};

type ShipmentListWorkspaceProps = {
  rows: ShipmentListItem[];
  totalCount: number;
  totalSumLabel: string;
  emptyMessage: string;
};

function csvCell(value: string | number): string {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest("a, button, input, summary, details, [data-row-action]"));
}

export function ShipmentListWorkspace({ rows, totalCount, totalSumLabel, emptyMessage }: ShipmentListWorkspaceProps) {
  const router = useRouter();
  const headerCheckboxRef = useRef<HTMLInputElement>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [busyAction, setBusyAction] = useState<"post" | "copy" | "delete" | null>(null);
  const [notice, setNotice] = useState("");
  const [columns, setColumns] = useState<OptionalColumns>({ phone: false, vin: false, positionCount: false });

  const selectedRows = useMemo(() => rows.filter((row) => selectedIds.has(row.id)), [rows, selectedIds]);
  const draftRows = useMemo(() => selectedRows.filter((row) => !row.applicable), [selectedRows]);
  const allOnPageSelected = rows.length > 0 && selectedRows.length === rows.length;
  const partiallySelected = selectedRows.length > 0 && !allOnPageSelected;
  const selectionActive = selectedRows.length > 0;

  useEffect(() => {
    if (headerCheckboxRef.current) headerCheckboxRef.current.indeterminate = partiallySelected;
  }, [partiallySelected]);

  function setRowSelected(id: string, selected: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (selected) next.add(id);
      else next.delete(id);
      return next;
    });
    setNotice("");
  }

  function togglePage(selected: boolean) {
    setSelectedIds(selected ? new Set(rows.map((row) => row.id)) : new Set());
    setNotice("");
  }

  async function requestAction(url: string, method: "POST" | "DELETE"): Promise<string | null> {
    try {
      const response = await fetch(url, { method });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) return typeof payload.error === "string" ? payload.error : "Не удалось выполнить действие";
      return null;
    } catch {
      return "Ошибка сети";
    }
  }

  async function postDrafts() {
    if (busyAction || draftRows.length === 0) return;
    setBusyAction("post");
    setNotice("");
    const errors: string[] = [];
    for (const row of draftRows) {
      const error = await requestAction(`/api/shipments/${encodeURIComponent(row.id)}/post`, "POST");
      if (error) errors.push(`${row.name}: ${error}`);
    }
    const completed = draftRows.length - errors.length;
    setNotice(errors.length > 0 ? `Проведено ${completed} из ${draftRows.length}. ${errors[0]}` : `Проведено: ${completed}`);
    setSelectedIds(new Set());
    setBusyAction(null);
    router.refresh();
  }

  async function copySelected() {
    if (busyAction || selectedRows.length === 0) return;
    const count = selectedRows.length;
    if (!window.confirm(`Создать ${count} ${count === 1 ? "копию" : "копии"}? Новые документы будут черновиками; клиент, автомобиль и позиции сохранятся.`)) return;
    setBusyAction("copy");
    setNotice("");
    const errors: string[] = [];
    for (const row of selectedRows) {
      const error = await requestAction(`/api/demands/${encodeURIComponent(row.id)}/copy`, "POST");
      if (error) errors.push(`${row.name}: ${error}`);
    }
    const completed = count - errors.length;
    setNotice(errors.length > 0 ? `Создано ${completed} из ${count} копий. ${errors[0]}` : `Создано копий: ${completed}`);
    setSelectedIds(new Set());
    setBusyAction(null);
    router.refresh();
  }

  async function deleteSelected() {
    if (busyAction || selectedRows.length === 0) return;
    const count = selectedRows.length;
    if (!window.confirm(`Удалить ${count} ${count === 1 ? "отгрузку" : "отгрузок"}? Действие необратимо.`)) return;
    setBusyAction("delete");
    setNotice("");
    const errors: string[] = [];
    for (const row of selectedRows) {
      const error = await requestAction(`/api/demands/${encodeURIComponent(row.id)}`, "DELETE");
      if (error) errors.push(`${row.name}: ${error}`);
    }
    const completed = count - errors.length;
    setNotice(errors.length > 0 ? `Удалено ${completed} из ${count}. ${errors[0]}` : `Удалено: ${completed}`);
    setSelectedIds(new Set());
    setBusyAction(null);
    router.refresh();
  }

  function exportSelected() {
    const targets = selectedRows.length > 0 ? selectedRows : rows;
    const data = [
      ["№", "Клиент", "Телефон", "Автомобиль", "Гос. номер", "VIN", "Склад", "Создал", "Статус", "Оплата", "Сумма"],
      ...targets.map((row) => [
        row.name,
        row.counterpartyName,
        row.phone,
        row.vehiclePrimary,
        row.plate,
        row.vin,
        row.storeName,
        row.ecoUserName,
        row.applicable ? "Проведено" : "Черновик",
        row.paymentStatus === "paid" ? "Оплачено" : row.paymentStatus === "unpaid" ? "Не оплачено" : "Не указано",
        row.sumLabel,
      ]),
    ];
    const csv = `\uFEFF${data.map((line) => line.map(csvCell).join(";")).join("\n")}`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `shipments-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function printRows(selectedOnly = false) {
    if (selectedOnly) document.body.classList.add("eco-print-selected-shipments");
    const cleanup = () => document.body.classList.remove("eco-print-selected-shipments");
    window.addEventListener("afterprint", cleanup, { once: true });
    window.print();
    window.setTimeout(cleanup, 1000);
  }

  return (
    <div className="eco-shipment-list-workspace">
      <div className={`eco-shipment-bulk-bar ${selectionActive ? "is-visible" : ""}`} aria-hidden={!selectionActive}>
        <strong>Выбрано: {selectedRows.length}</strong>
        <span>на этой странице</span>
        <button type="button" className="eco-btn eco-btn--primary eco-btn--sm" onClick={() => void postDrafts()} disabled={busyAction !== null || draftRows.length === 0}>
          <Check aria-hidden className="eco-icon" />
          {busyAction === "post" ? "Проводим…" : draftRows.length > 0 ? `Провести ${draftRows.length}` : "Нет черновиков"}
        </button>
        <button type="button" className="eco-btn eco-btn--sm" onClick={() => void copySelected()} disabled={busyAction !== null}>
          <Copy aria-hidden className="eco-icon" />
          {busyAction === "copy" ? "Копируем…" : "Создать копии"}
        </button>
        <button type="button" className="eco-btn eco-btn--sm" onClick={() => printRows(true)} disabled={busyAction !== null}>
          <Printer aria-hidden className="eco-icon" />
          Печать
        </button>
        <details className="eco-shipment-bulk-more">
          <summary className="eco-btn eco-btn--sm">Ещё <ChevronDown aria-hidden className="eco-icon" /></summary>
          <div>
            <button type="button" onClick={exportSelected}><Download aria-hidden />Экспортировать выбранные</button>
            <button type="button" className="is-danger" onClick={() => void deleteSelected()} disabled={busyAction !== null}>
              <Trash2 aria-hidden />{busyAction === "delete" ? "Удаляем…" : `Удалить ${selectedRows.length}`}
            </button>
          </div>
        </details>
        <button type="button" className="eco-shipment-clear-selection" onClick={() => setSelectedIds(new Set())}>
          <X aria-hidden />Снять выделение
        </button>
      </div>

      {notice ? <div className="eco-shipment-list-notice" role="status">{notice}</div> : null}

      <div className="eco-table-wrap eco-shipment-list-wrap">
        <div className="eco-table-toolbar">
          <span className="l-meta">Показано {rows.length} из {totalCount} · сумма на странице {totalSumLabel}</span>
          <div className="grow" />
          <button type="button" className="eco-btn eco-btn--ghost eco-btn--sm" onClick={() => printRows(false)}>
            <Printer aria-hidden className="eco-icon" />Печать списка
          </button>
          <details className="eco-shipment-columns-menu">
            <summary className="eco-btn eco-btn--ghost eco-btn--sm">
              <SlidersHorizontal aria-hidden className="eco-icon" />Колонки
            </summary>
            <div>
              <strong>Дополнительные колонки</strong>
              <label><input type="checkbox" checked={columns.phone} onChange={(event) => setColumns((current) => ({ ...current, phone: event.target.checked }))} />Телефон</label>
              <label><input type="checkbox" checked={columns.vin} onChange={(event) => setColumns((current) => ({ ...current, vin: event.target.checked }))} />VIN</label>
              <label><input type="checkbox" checked={columns.positionCount} onChange={(event) => setColumns((current) => ({ ...current, positionCount: event.target.checked }))} />Количество позиций</label>
            </div>
          </details>
        </div>

        <div className="eco-shipment-mobile-list" aria-label="Список отгрузок">
          {rows.map((row) => {
            const selected = selectedIds.has(row.id);
            return (
              <article
                key={row.id}
                className={`eco-shipment-mobile-card ${selected ? "is-selected" : ""}`}
                onClick={(event) => {
                  if (isInteractiveTarget(event.target)) return;
                  if (selectionActive) setRowSelected(row.id, !selected);
                  else router.push(`/shipment/${row.id}`);
                }}
              >
                <div className="eco-shipment-mobile-card__top">
                  <input type="checkbox" className="eco-shipment-select" checked={selected} onChange={(event) => setRowSelected(row.id, event.target.checked)} aria-label={`Выбрать отгрузку ${row.name}`} />
                  <div className="eco-shipment-mobile-card__number"><Link href={`/shipment/${row.id}`}>{row.name}</Link><span>{row.moment.date} · {row.moment.time}</span></div>
                  <strong className="l-money eco-shipment-mobile-card__sum">{row.sumLabel}</strong>
                </div>
                <div className="eco-shipment-mobile-card__grid">
                  <div className="eco-shipment-mobile-field"><span>Клиент</span><strong>{row.counterpartyName}</strong></div>
                  <div className="eco-shipment-mobile-field"><span>Авто</span><strong>{row.vehiclePrimary}</strong>{row.vehicleSecondary ? <em>{row.vehicleSecondary}</em> : null}</div>
                  <div className="eco-shipment-mobile-field"><span>Склад</span><strong>{row.storeName}</strong></div>
                  <div className="eco-shipment-mobile-field"><span>Создал</span><strong>{row.ecoUserName}</strong></div>
                </div>
                <div className="eco-shipment-mobile-card__foot">
                  <div className="eco-shipment-mobile-card__badges">
                    <EcoBadge tone={row.applicable ? "success" : "neutral"} dot>{row.applicable ? "Проведено" : "Черновик"}</EcoBadge>
                    <EcoBadge tone={row.paymentStatus === "paid" ? "success" : row.paymentStatus === "unpaid" ? "warning" : "neutral"} dot>
                      {row.paymentStatus === "paid" ? "Оплачено" : row.paymentStatus === "unpaid" ? "Не оплачено" : "Не указано"}
                    </EcoBadge>
                  </div>
                  <div data-row-action><ShipmentRowActions shipmentId={row.id} counterpartyId={row.counterpartyId} counterpartyName={row.counterpartyName} phone={row.phone} vehicleLabel={row.vehicleTitle || row.vehiclePrimary} /></div>
                </div>
              </article>
            );
          })}
          {rows.length === 0 ? <div className="eco-shipment-mobile-empty">{emptyMessage}</div> : null}
        </div>

        <table className="eco-table eco-shipment-list-table">
          <thead>
            <tr>
              <th className="eco-shipment-select-cell eco-shipment-cell--select">
                <input ref={headerCheckboxRef} type="checkbox" className="eco-shipment-select" checked={allOnPageSelected} onChange={(event) => togglePage(event.target.checked)} aria-label="Выбрать все отгрузки на странице" />
              </th>
              <th className="eco-shipment-cell--document">№</th>
              <th className="eco-shipment-cell--client">Клиент</th>
              {columns.phone ? <th className="eco-shipment-cell--phone">Телефон</th> : null}
              <th className="eco-shipment-cell--vehicle">Авто / гос. номер</th>
              {columns.vin ? <th className="eco-shipment-cell--vin">VIN</th> : null}
              <th className="eco-shipment-cell--store">Склад</th>
              <th className="eco-shipment-cell--creator">Создал</th>
              <th className="eco-shipment-cell--status">Статус</th>
              <th className="eco-shipment-cell--payment">Оплата</th>
              <th className="is-right eco-shipment-cell--sum">Сумма</th>
              <th className="eco-shipment-actions-cell eco-shipment-cell--actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <ShipmentListRow
                key={row.id}
                row={{ id: row.id, name: row.name, applicable: row.applicable, sum: row.sum, paymentStatus: row.paymentStatus, store: { name: row.storeName } }}
                moment={row.moment}
                counterpartyName={row.counterpartyName}
                counterpartyHref={row.counterpartyHref}
                counterpartyId={row.counterpartyId}
                vehiclePrimary={row.vehiclePrimary}
                vehicleSecondary={row.vehicleSecondary}
                vehicleTitle={row.vehicleTitle}
                ecoUserName={row.ecoUserName}
                sumLabel={row.sumLabel}
                phone={row.phone}
                vin={row.vin}
                positionCount={row.positionCount}
                selected={selectedIds.has(row.id)}
                selectionActive={selectionActive}
                showPhone={columns.phone}
                showVin={columns.vin}
                showPositionCount={columns.positionCount}
                onSelectionChange={(selected) => setRowSelected(row.id, selected)}
              />
            ))}
            {rows.length === 0 ? <tr className="eco-shipment-list-empty-row"><td colSpan={12}>{emptyMessage}</td></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
