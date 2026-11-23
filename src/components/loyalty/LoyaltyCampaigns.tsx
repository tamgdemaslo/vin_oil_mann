"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { RETURN_SCENARIO_LABELS } from "@/lib/customer-return-candidates";
import { RETURN_TABS } from "@/lib/customer-return-workflow";
import type { QueueFilters } from "@/lib/loyalty/queue-filter";
import { expiryLabel, loyaltyDate, loyaltyNumber, loyaltyRequest } from "./client";

type Mode = "one" | "selected" | "filter" | "all";
const modes: Record<Mode, string> = { one: "Открытый клиент", selected: "Отмеченные клиенты", filter: "Все по текущим фильтрам", all: "Клиентская база доступных филиалов" };
type Campaign = {
  id: string; recipients: number; total: number; points: number; counts: Record<string, number>;
  filters: QueueFilters & { mode: Mode; serviceDate: string };
  expiresAt: string | null; reason: string; confirmedAt: string | null;
  deliveryMessage: string; errorCursor?: string; skips: { status: string; error: string; _count: { _all: number } }[];
};
type History = { id: string; reason: string; createdAt: string; confirmedAt: string | null };
const url = "/api/loyalty/campaigns";

export function useCampaignAccess(branchId: string) {
  const [access, setAccess] = useState<{ branchId: string; campaigns: History[] }>();
  useEffect(() => {
    let current = true;
    loyaltyRequest<{ enabled: boolean; campaigns: History[] }>(url).then(({ enabled, campaigns }) => {
      if (current && enabled) setAccess({ branchId, campaigns });
    }).catch(() => undefined);
    return () => { current = false; };
  }, [branchId]);
  return access?.branchId === branchId ? access : undefined;
}

export function LoyaltyCampaigns({ branchId, today, filters, current, selected, history }: {
  branchId: string; today: string; filters: QueueFilters; current?: string; selected: string[]; history: History[];
}) {
  const [mode, setMode] = useState<Mode>("one");
  const [campaign, setCampaign] = useState<Campaign>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const previewAttempt = useRef<{ signature: string; id: string } | null>(null);
  const lock = useRef(false);
  async function preview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current) return;
    const values = new FormData(event.currentTarget);
    const keys = mode === "selected" ? selected : mode === "one" && current ? [current] : [];
    const body = { action: "preview", branchId, serviceDate: today, mode, filters, keys,
      points: Number(values.get("points")), reason: String(values.get("reason")), expires: String(values.get("expires") ?? "") || null };
    const signature = JSON.stringify(body);
    const id = previewAttempt.current?.signature === signature ? previewAttempt.current.id : crypto.randomUUID();
    previewAttempt.current = { id, signature };
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      setCampaign(await loyaltyRequest<Campaign>(url, { ...body, id }));
    } catch (reason) { setError((reason as Error).message); }
    finally { lock.current = false; setBusy(false); }
  }
  async function run() {
    if (!campaign || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      let result: Campaign;
      let errorCursor: string | undefined;
      do {
        result = await loyaltyRequest<Campaign>(url, { action: "run", id: campaign.id, branchId, errorCursor });
        errorCursor = result.errorCursor;
        setCampaign(result);
      } while (errorCursor || (result.counts.pending ?? 0) > 0);
    } catch (reason) { setError((reason as Error).message); }
    finally { lock.current = false; setBusy(false); }
  }
  async function open(id: string) {
    if (!id || lock.current) return;
    setError("");
    try { setCampaign(await loyaltyRequest<Campaign>(url + "?id=" + encodeURIComponent(id))); }
    catch (reason) { setError((reason as Error).message); }
  }
  return <details className="eco-loyalty-panel">
    <summary>Начислить бонусы за акцию</summary>
    {error && <p role="alert">{error}</p>}
    <form className="eco-loyalty-rates" onSubmit={preview}>
      <label>Получатели <select value={mode} disabled={busy} onChange={(event) => setMode(event.target.value as Mode)}>
        {Object.entries(modes).map(([key, label]) => <option value={key} key={key}>{label}{key === "selected" ? ` (${selected.length})` : ""}</option>)}
      </select></label>
      <label>Бонусов на человека <input name="points" type="number" min={1} max={1_000_000} required /></label>
      <label>Действуют до <input name="expires" type="date" /></label>
      <label>Основание <input name="reason" maxLength={500} required /></label>
      <button type="submit" className="eco-btn" disabled={busy || (mode === "one" && !current) || (mode === "selected" && !selected.length)}>Рассчитать аудиторию</button>
    </form>
    {history.length > 0 && <label>Недавние акции <select value="" disabled={busy} onChange={(event) => void open(event.target.value)}>
      <option value="">Открыть результат</option>
      {history.map((item) => <option key={item.id} value={item.id}>{loyaltyDate(item.createdAt)} · {item.reason}</option>)}
    </select></label>}
    {campaign && <fieldset className="eco-loyalty-panel" disabled={busy}>
      <legend>{campaign.confirmedAt ? "Результат акции" : "Проверьте аудиторию"}</legend>
      <p>{modes[campaign.filters.mode]}</p>
      {campaign.filters.mode === "filter" && <p>
        {RETURN_TABS[campaign.filters.tab]} · {campaign.filters.scenario === "all" ? "Все сценарии" : RETURN_SCENARIO_LABELS[campaign.filters.scenario as keyof typeof RETURN_SCENARIO_LABELS]}
        {campaign.filters.todayResult && ` · ${{ processing: "В процессе", sent: "Отправлено", failed: "Не отправлено", unknown: "Не подтверждено" }[campaign.filters.todayResult] ?? ""}`}
        {campaign.filters.search && ` · Поиск «${campaign.filters.search}»`}
      </p>}
      <dl className="eco-loyalty-metrics">
        <div><dt>Уникальных получателей</dt><dd>{loyaltyNumber(campaign.recipients)}</dd></div>
        <div><dt>На человека</dt><dd>{loyaltyNumber(campaign.points)}</dd></div>
        <div><dt>Всего бонусов</dt><dd>{loyaltyNumber(campaign.total)}</dd></div>
        <div><dt>Срок</dt><dd>{campaign.expiresAt ? expiryLabel(campaign.expiresAt) : "Бессрочно"}</dd></div>
      </dl>
      <p>{campaign.reason}</p>
      <p role="status">Начислено {campaign.counts.done ?? 0} · ожидают {campaign.counts.pending ?? 0} · пропущено {campaign.counts.skipped ?? 0} · ошибок {campaign.counts.error ?? 0}</p>
      {campaign.skips.length > 0 && <ul className="eco-loyalty-history">{campaign.skips.map((row) => <li key={row.status + row.error}>{row.error} · {row._count._all}</li>)}</ul>}
      <p>Доставка сообщений · {campaign.deliveryMessage}</p>
      {(campaign.counts.pending || campaign.counts.error) ? <button className="eco-btn eco-btn--primary" type="button" onClick={() => void run()}>
        {campaign.confirmedAt ? "Продолжить начисление" : "Подтвердить начисление"}
      </button> : null}
    </fieldset>}
    {busy && <p role="status">Обрабатываем акцию…</p>}
  </details>;
}
