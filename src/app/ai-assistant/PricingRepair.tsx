"use client";

import "./pricing-repair.css";

import { useCallback, useEffect, useState } from "react";
import { Wrench } from "lucide-react";

type RepairRule = { id: string; name: string; laborPriceCents: number; priceFromCents: number | null; priceToCents: number | null; requiresHumanConfirmation: boolean; effectiveTo: string | null };
type RepairPlan = { id: string; kind: "restore" | "copy"; sourceBranchName: string; targetBranchName: string; sourceNeedsRepair: boolean; initialSettings: boolean; token: string; rules: RepairRule[] };
type Preview = { branch: { id: string; name: string }; legacyCount: number; visibleCount: number; plans: RepairPlan[] };
const money = (cents: number) => new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(cents / 100);

export default function PricingRepair({ scopeQuery = "", refreshKey = "", onApplied, onRecalculate }: {
  scopeQuery?: string; refreshKey?: string; onApplied?: () => void; onRecalculate?: () => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [planId, setPlanId] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const endpoint = `/api/ai-assistant/pricing-rules/repair${scopeQuery ? `?${scopeQuery}` : ""}`;
  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(endpoint, { cache: "no-store", signal });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || "Не удалось проверить настройки тарифов.");
    setPreview(value);
    setPlanId(value.plans[0]?.id ?? "");
    setSelected(value.plans[0]?.rules.map((rule: RepairRule) => rule.id) ?? []);
  }, [endpoint]);
  useEffect(() => {
    const controller = new AbortController();
    setPreview(null); setError(null); setExpanded(false); setSuccess(null);
    void load(controller.signal).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Не удалось проверить настройки."); });
    return () => controller.abort();
  }, [load, refreshKey]);
  const plan = preview?.plans.find(item => item.id === planId);

  async function apply() {
    if (!plan || !selected.length) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planId: plan.id, token: plan.token, ruleIds: selected }) });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 409) await load();
        throw new Error(result.error || "Не удалось применить тарифы.");
      }
      setSuccess(`Тарифы сохранены для «${result.branch.name}»: ${result.applied}. Новый расчёт будет учитывать эти настройки.`);
      setExpanded(false);
      onApplied?.();
      try { await load(); } catch { setError("Тарифы сохранены, но обновить список не удалось. Обновите страницу."); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось применить тарифы."); }
    finally { setBusy(false); }
  }
  if (!error && !success && (!preview || !preview.plans.length && !preview.legacyCount && preview.visibleCount > 0)) return null;
  return <section className="eco-pricing-repair" aria-label="Исправление настроек расчёта">
    {success ? <p role="status">{success}</p> : <>
      <strong><Wrench size={16} aria-hidden /> {preview?.legacyCount ? "Тарифы есть, но помощник их не видит" : "Проверьте стоимость работы для филиала"}</strong>
      <p>{preview?.legacyCount
        ? `В «${preview.branch.name}» найдены правила со старой привязкой к организации. Можно проверить суммы и восстановить их применение.`
        : `Для «${preview?.branch.name ?? "текущего филиала"}» можно настроить недостающие тарифы${preview?.plans.length ? " по правилам другого филиала" : " в редакторе"}.`}</p>
    </>}
    {error && <p className="eco-pricing-repair__error" role="alert">{error}</p>}
    {expanded && plan && <div className="eco-pricing-repair__preview">
      {preview!.plans.length > 1 && <label>Источник правил<select value={planId} disabled={busy} onChange={event => {
        const next = preview!.plans.find(item => item.id === event.target.value)!;
        setPlanId(next.id); setSelected(next.rules.map(rule => rule.id)); setError(null);
      }}>{preview!.plans.map(item => <option key={item.id} value={item.id}>{item.kind === "restore" ? "Восстановить" : "Скопировать из"} · {item.sourceBranchName}</option>)}</select></label>}
      <p><b>{plan.kind === "restore" ? "Восстановить привязку" : `Тарифы из «${plan.sourceBranchName}»`} → {plan.targetBranchName}</b></p>
      {(plan.initialSettings || plan.sourceNeedsRepair && plan.kind === "copy") && <p>Это сохранённые начальные настройки или правила со старой привязкой. Проверьте, что суммы соответствуют вашему прайсу.</p>}
      <div className="eco-pricing-repair__rows">{plan.rules.map(rule => <label key={rule.id}>
        <input type="checkbox" checked={selected.includes(rule.id)} disabled={busy} onChange={event => setSelected(ids => event.target.checked ? [...ids, rule.id] : ids.filter(id => id !== rule.id))} />
        <span>{rule.name}{rule.requiresHumanConfirmation && <small>Требуется подтверждение сотрудника</small>}{rule.effectiveTo && <small>Действует до {new Date(rule.effectiveTo).toLocaleDateString("ru-RU")}</small>}</span>
        <b>{money(rule.priceFromCents ?? rule.laborPriceCents)}{rule.priceToCents != null && rule.priceToCents !== (rule.priceFromCents ?? rule.laborPriceCents) ? `–${money(rule.priceToCents)}` : ""}</b>
      </label>)}</div>
      <p>Сохранятся только выбранные правила. Уже настроенные тарифы и прошлые сметы сохранятся.</p>
    </div>}
    <div className="eco-pricing-repair__actions">
      {expanded && plan ? <><button type="button" className="eco-btn eco-btn--primary" disabled={busy || !selected.length} onClick={() => void apply()}>{busy ? "Сохраняем…" : `Применить выбранные (${selected.length})`}</button><button type="button" className="eco-btn eco-btn--quiet" disabled={busy} onClick={() => setExpanded(false)}>Отмена</button></>
        : plan && <button type="button" className="eco-btn eco-btn--primary" onClick={() => setExpanded(true)}>Посмотреть и исправить</button>}
      {success && onRecalculate && <button type="button" className="eco-btn eco-btn--primary" onClick={onRecalculate}>Подготовить повторный запрос</button>}
      {error && <button type="button" className="eco-btn eco-btn--quiet" disabled={busy} onClick={() => { setError(null); void load().catch(reason => setError(reason.message)); }}>Обновить проверку</button>}
      <a className="eco-btn eco-btn--quiet" href={`/cabinet/ai-assistant/pricing${preview ? `?branchId=${encodeURIComponent(preview.branch.id)}` : ""}`}>Редактор тарифов</a>
    </div>
  </section>;
}
