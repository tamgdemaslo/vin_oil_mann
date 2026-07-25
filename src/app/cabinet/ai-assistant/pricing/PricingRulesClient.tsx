"use client";

import { Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type Rule = {
  id: string; locationId: string; serviceFamily: string; procedureType: string; transmissionConfiguration: string | null; materialsOwner: string | null; vehicleId: string | null; aggregateCode: string | null; name: string; laborPriceCents: number; priceFromCents: number | null; priceToCents: number | null; requiresHumanConfirmation: boolean; active: boolean; effectiveFrom: string; effectiveTo: string | null; comment: string | null;
};

type EditableRule = Omit<Rule, "id"> & { id?: string };

const familyLabels: Record<string, string> = { engine_oil: "Моторное масло", transmission_fluid: "АКПП / CVT / трансмиссия", air_filter: "Воздушный фильтр", cabin_filter: "Салонный фильтр" };
const procedureLabels: Record<string, string> = { oil_change: "Замена масла", partial: "Частичная", machine: "Аппаратная", replace: "Замена фильтра" };
const ownerLabels: Record<string, string> = { service: "Материалы сервиса", customer: "Материалы клиента" };
const configurationLabels: Record<string, string> = { no_pan: "Без поддона", pan_and_filter: "Поддон и фильтр", two_coarse_filters: "Два фильтра", not_applicable: "Не применяется" };

const newRule = (): EditableRule => ({ locationId: "dachnaya", serviceFamily: "transmission_fluid", procedureType: "partial", transmissionConfiguration: "no_pan", materialsOwner: "service", vehicleId: null, aggregateCode: null, name: "", laborPriceCents: 0, priceFromCents: null, priceToCents: null, requiresHumanConfirmation: false, active: true, effectiveFrom: new Date().toISOString().slice(0, 10), effectiveTo: null, comment: null });

function rubles(cents: number | null) { return cents == null ? "" : String(cents / 100); }
function cents(value: string) { const result = Math.round(Number(value.replace(",", ".")) * 100); return Number.isFinite(result) && result >= 0 ? result : 0; }
function dateInput(value: string | null) { return value ? value.slice(0, 10) : ""; }

export default function PricingRulesClient() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [selected, setSelected] = useState<EditableRule | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedId = selected?.id;
  const grouped = useMemo(() => rules.filter((rule) => rule.active).sort((left, right) => `${left.locationId}${left.serviceFamily}${left.name}`.localeCompare(`${right.locationId}${right.serviceFamily}${right.name}`, "ru")), [rules]);

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/ai-assistant/pricing-rules", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Не удалось загрузить правила");
      setRules(payload.rules);
      setSelected((current) => current?.id ? payload.rules.find((rule: Rule) => rule.id === current.id) ?? current : current);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось загрузить правила"); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  async function save() {
    if (!selected) return;
    setSaving(true); setError(null);
    try {
      const response = await fetch("/api/ai-assistant/pricing-rules", { method: selected.id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(selected) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Не удалось сохранить правило");
      setSelected(payload.rule); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось сохранить правило"); }
    finally { setSaving(false); }
  }

  async function archive() {
    if (!selectedId || !confirm("Отключить это правило? История расчётов сохранится.")) return;
    setSaving(true); setError(null);
    try {
      const response = await fetch(`/api/ai-assistant/pricing-rules?id=${encodeURIComponent(selectedId)}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Не удалось отключить правило");
      setSelected(null); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось отключить правило"); }
    finally { setSaving(false); }
  }

  const update = <K extends keyof EditableRule>(key: K, value: EditableRule[K]) => setSelected((current) => current ? { ...current, [key]: value } : current);

  return <div className="eco-pricing">
    <section className="eco-pricing__list" aria-label="Правила расчёта">
      <div className="eco-pricing__toolbar"><div><strong>Действующие правила</strong><span>Точка «Дачная» · {grouped.length} шт.</span></div><button type="button" className="eco-btn eco-btn--primary" onClick={() => { setSelected(newRule()); setError(null); }}><Plus size={16} /> Новое правило</button></div>
      {loading ? <p className="eco-pricing__empty">Загружаем тарифы…</p> : grouped.length === 0 ? <p className="eco-pricing__empty">Правила ещё не добавлены. Создайте первое правило — карточки услуг останутся только fallback-источником.</p> : <div className="eco-pricing__table-wrap"><table><thead><tr><th>Сценарий</th><th>Материалы</th><th>Работа</th><th>Подтверждение</th></tr></thead><tbody>{grouped.map((rule) => <tr key={rule.id} className={rule.id === selectedId ? "is-selected" : ""} onClick={() => setSelected(rule)}><td><strong>{rule.name}</strong><small>{familyLabels[rule.serviceFamily] || rule.serviceFamily} · {procedureLabels[rule.procedureType] || rule.procedureType}{rule.transmissionConfiguration ? ` · ${configurationLabels[rule.transmissionConfiguration] || rule.transmissionConfiguration}` : ""}</small></td><td>{rule.materialsOwner ? ownerLabels[rule.materialsOwner] || rule.materialsOwner : "Любые"}</td><td>{rule.priceToCents && rule.priceToCents > rule.laborPriceCents ? `${rubles(rule.laborPriceCents)}–${rubles(rule.priceToCents)} ₽` : `${rubles(rule.laborPriceCents)} ₽`}</td><td>{rule.requiresHumanConfirmation ? "Нужно" : "Не нужно"}</td></tr>)}</tbody></table></div>}
    </section>

    {selected && <section className="eco-pricing__editor" aria-label="Редактор правила">
      <header><div><h2>{selected.id ? "Изменить правило" : "Новое правило"}</h2><p>Специальный тариф всегда имеет приоритет над ценой карточки услуги.</p></div>{selected.id ? <button type="button" className="eco-btn eco-btn--quiet" onClick={() => void archive()} disabled={saving}><Trash2 size={15} /> Отключить</button> : null}</header>
      {error ? <p className="eco-pricing__error" role="alert">{error}</p> : null}
      <div className="eco-pricing__form">
        <label className="wide">Название<input value={selected.name} onChange={(event) => update("name", event.target.value)} placeholder="Например, АКПП: частичная без поддона — масло сервиса" /></label>
        <label>Точка<input value={selected.locationId} onChange={(event) => update("locationId", event.target.value)} /></label>
        <label>Семейство<select value={selected.serviceFamily} onChange={(event) => update("serviceFamily", event.target.value)}>{Object.entries(familyLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Процедура<select value={selected.procedureType} onChange={(event) => update("procedureType", event.target.value)}>{Object.entries(procedureLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Конфигурация<select value={selected.transmissionConfiguration || ""} onChange={(event) => update("transmissionConfiguration", event.target.value || null)}><option value="">Не задана</option>{Object.entries(configurationLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Чьи материалы<select value={selected.materialsOwner || ""} onChange={(event) => update("materialsOwner", event.target.value || null)}><option value="">Любые</option>{Object.entries(ownerLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Тариф, ₽<input inputMode="decimal" value={rubles(selected.laborPriceCents)} onChange={(event) => update("laborPriceCents", cents(event.target.value))} /></label>
        <label>От, ₽<input inputMode="decimal" value={rubles(selected.priceFromCents)} onChange={(event) => update("priceFromCents", event.target.value ? cents(event.target.value) : null)} /></label>
        <label>До, ₽<input inputMode="decimal" value={rubles(selected.priceToCents)} onChange={(event) => update("priceToCents", event.target.value ? cents(event.target.value) : null)} /></label>
        <label>Действует с<input type="date" value={dateInput(selected.effectiveFrom)} onChange={(event) => update("effectiveFrom", event.target.value)} /></label>
        <label>Действует до<input type="date" value={dateInput(selected.effectiveTo)} onChange={(event) => update("effectiveTo", event.target.value || null)} /></label>
        <label>Автомобиль ID (необязательно)<input value={selected.vehicleId || ""} onChange={(event) => update("vehicleId", event.target.value || null)} /></label>
        <label>Код агрегата (необязательно)<input value={selected.aggregateCode || ""} onChange={(event) => update("aggregateCode", event.target.value || null)} /></label>
        <label className="wide">Комментарий<textarea value={selected.comment || ""} onChange={(event) => update("comment", event.target.value || null)} placeholder="Что входит в работу или когда применять правило" /></label>
        <label className="eco-pricing__check wide"><input type="checkbox" checked={selected.requiresHumanConfirmation} onChange={(event) => update("requiresHumanConfirmation", event.target.checked)} /> Перед созданием окончательного расчёта требуется подтверждение сотрудника</label>
      </div>
      <footer><button type="button" className="eco-btn eco-btn--quiet" onClick={() => setSelected(null)} disabled={saving}>Отмена</button><button type="button" className="eco-btn eco-btn--primary" onClick={() => void save()} disabled={saving || !selected.name.trim()}><Save size={16} /> {saving ? "Сохраняем…" : "Сохранить правило"}</button></footer>
    </section>}
  </div>;
}
