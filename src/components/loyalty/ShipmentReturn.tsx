"use client";

import { useState, type FormEvent } from "react";
import type { FiscalReturnUnit } from "@/lib/loyalty/sales";
import type { DemandDetailHeader } from "@/lib/demand-detail-load";
import { loyaltyMoney, loyaltyRequest } from "./client";

type Totals = { beforeCents: number; cashCents: number; restored: number; earnedReversed: number; token?: string };
export function ShipmentReturn({ id, branchId, loyalty, names }: {
  id: string; branchId: string; loyalty: NonNullable<DemandDetailHeader["loyalty"]>; names: Record<string, string>;
}) {
  const [units, setUnits] = useState<Record<string, FiscalReturnUnit[]>>();
  const [selectedUnits, setSelectedUnits] = useState<Record<string, string[]>>({});
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [receipt, setReceipt] = useState("");
  const [reason, setReason] = useState("");
  const [requestKey, setRequestKey] = useState("");
  const [preview, setPreview] = useState<Totals>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const endpoint = `/api/loyalty/returns/${encodeURIComponent(id)}`;
  async function loadUnits() {
    setError("");
    try { setUnits((await loyaltyRequest<{ units: Record<string, FiscalReturnUnit[]> }>(endpoint)).units); }
    catch (failure) { setError((failure as Error).message); }
  }
  const lines = loyalty.lines.flatMap((line) => {
    const unitKeys = selectedUnits[line.id] ?? [];
    const quantityMilli = units?.[line.id] ? unitKeys.length * 1000 : Math.round(Number(quantities[line.id] || 0) * 1000);
    return quantityMilli > 0 ? [{ id: line.id, quantityMilli, ...(unitKeys.length ? { unitKeys } : {}) }] : [];
  });
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !lines.length) return;
    setBusy(true);
    setError("");
    setNotice("");
    const key = requestKey || crypto.randomUUID();
    setRequestKey(key);
    try {
      const result = await loyaltyRequest<Totals>(endpoint, {
        branchId, receipt, reason, requestKey: key, lines, preview: !preview, token: preview?.token,
      });
      if (!preview) setPreview(result);
      else {
        setNotice(`Возврат зарегистрирован · ${loyaltyMoney(result.cashCents)}`);
        setPreview(undefined);
        setQuantities({});
        setSelectedUnits({});
        await loadUnits();
        setReceipt("");
        setReason("");
        setRequestKey("");
      }
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return <details className="eco-loyalty-panel" onToggle={(event) => {
    if (event.currentTarget.open) void loadUnits();
  }}>
    <summary>Зарегистрировать возврат по чеку</summary>
    <form className="eco-loyalty-rates" onSubmit={submit}>
      <p>Выберите количество, рассчитайте возврат, затем внесите номер оформленного кассового чека.</p>
      {!units && <p role="status">Проверяем исходный чек…</p>}
      {units && loyalty.lines.map((line) => {
        const choices = units[line.id];
        const name = names[line.id] || "Позиция";
        if (choices) return <fieldset key={line.id} disabled={busy || Boolean(preview)}>
          <legend>{name} · коды из исходного чека</legend>
          {choices.map((unit) => <label key={unit.key}>
            <input type="checkbox" disabled={unit.returned} checked={(selectedUnits[line.id] ?? []).includes(unit.key)}
              onChange={(event) => {
                const previous = selectedUnits[line.id] ?? [];
                setSelectedUnits({ ...selectedUnits, [line.id]: event.target.checked ? [...previous, unit.key] : previous.filter((key) => key !== unit.key) });
              }} />
            {unit.label} · {loyaltyMoney(unit.cashCents)}{unit.returned ? " · возвращено" : ""}
          </label>)}
        </fieldset>;
        return <label key={line.id}>{name} · {line.quantityMilli / 1000}
          <input type="number" aria-label={`Возврат · ${name}`} step="0.001" min="0" max={line.quantityMilli / 1000}
            value={quantities[line.id] ?? ""} disabled={busy || Boolean(preview)}
            onChange={(event) => setQuantities({ ...quantities, [line.id]: event.target.value })} />
        </label>;
      })}
      {preview && <>
        <dl className="eco-loyalty-metrics">
          <div><dt>К возврату деньгами</dt><dd>{loyaltyMoney(preview.cashCents)}</dd></div>
          <div><dt>Восстановится бонусов</dt><dd>{preview.restored}</dd></div>
          <div><dt>Сторно начисления</dt><dd>{preview.earnedReversed}</dd></div>
        </dl>
        <label>Номер чека возврата <input required maxLength={250} value={receipt} onChange={(event) => setReceipt(event.target.value)} /></label>
        <label>Основание <input required maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
      </>}
      <div className="eco-loyalty-actions">
        <button type="submit" className="eco-btn eco-btn--primary" disabled={busy || !units || !lines.length}>{preview ? "Сохранить возврат" : "Рассчитать возврат"}</button>
        {preview && <button type="button" className="eco-btn" disabled={busy} onClick={() => { setPreview(undefined); setRequestKey(""); }}>Изменить расчёт</button>}
      </div>
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error} {!units && <button type="button" className="eco-btn" onClick={() => void loadUnits()}>Повторить</button>}</p>}
    </form>
  </details>;
}
