"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { LOYALTY_DEFAULTS } from "@/lib/loyalty/calculation";
import { loyaltyRequest } from "@/components/loyalty/client";

type Settings = { rules: typeof LOYALTY_DEFAULTS; groups: { branchId: string; name: string; groups: { id: string; name: string }[] }[] };
type Reviews = { enabled: boolean; clients: { id: string; name: string; displayName: string }[] };
const fields = [
  { key: "centsPerPoint", name: "Рублей за бонус", factor: 100, min: 0.01, max: 1000 },
  { key: "productRate", name: "Начисление за товары, %", factor: 100, min: 0, max: 100 },
  { key: "serviceRate", name: "Начисление за услуги, %", factor: 100, min: 0, max: 100 },
  { key: "spendRate", name: "Максимум оплаты бонусами, %", factor: 100, min: 0, max: 100 },
  { key: "compensationLimit", name: "Лимит компенсации мастера, бонусов", factor: 1, min: 0, max: 1_000_000 },
] as const;

export function LoyaltySettings({ owner, branchId }: { owner: boolean; branchId: string | null }) {
  const [settings, setSettings] = useState<Settings>();
  const [reviews, setReviews] = useState<Reviews>();
  const [error, setError] = useState("");
  const [reviewError, setReviewError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [group, setGroup] = useState("");
  const [rate, setRate] = useState("");

  useEffect(() => {
    if (owner) void loyaltyRequest<Settings>("/api/loyalty/settings").then(setSettings).catch((reason: Error) => setError(reason.message));
    if (branchId) void loyaltyRequest<Reviews>("/api/loyalty/reviews").then(setReviews).catch((reason: Error) => setReviewError(reason.message));
  }, [owner, branchId]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings || busy) return;
    const form = new FormData(event.currentTarget);
    const rules = { ...settings.rules, enabled: form.get("enabled") === "on" };
    fields.forEach(({ key, factor }) => { rules[key] = Math.round(Number(form.get(key)) * factor); });
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await loyaltyRequest("/api/loyalty/settings", rules, { method: "PUT" });
      setSettings({ ...settings, rules });
      setNotice("Настройки сохранены. Ставки применятся к новым проведениям.");
      if (branchId) await loyaltyRequest<Reviews>("/api/loyalty/reviews").then(setReviews);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const groupNames = new Map(settings?.groups.flatMap((branch) => branch.groups.map((item) => [item.id, `${branch.name} · ${item.name}`] as const)));
  function setRates(groupRates: Record<string, number>) {
    if (settings) setSettings({ ...settings, rules: { ...settings.rules, groupRates } });
  }
  const validRate = rate.trim() !== "" && Number(rate) >= 0 && Number(rate) <= 100;
  return <>
    {owner && <section className="eco-card eco-card--padded">
      <h2>Правила начисления и списания</h2>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {!settings && !error && <p role="status">Загружаем правила…</p>}
      {settings && <form onSubmit={save}>
        <fieldset className="eco-loyalty-panel" disabled={busy}>
          <legend>Для всех филиалов</legend>
          <label><input type="checkbox" name="enabled" defaultChecked={settings.rules.enabled} /> Включить программу</label>
          {fields.map(({ key, name, factor, min, max }) => <label key={key}>{name}
            <input type="number" name={key} defaultValue={settings.rules[key] / factor} min={min} max={max} step={1 / factor} required />
          </label>)}
          <p>Бонусы за покупку бессрочные. Для компенсаций, ручных начислений и акций дату можно указать при выдаче.</p>
        </fieldset>
        <fieldset className="eco-loyalty-panel" disabled={busy}>
          <legend>Ставки товарных групп</legend>
          {Object.entries(settings.rules.groupRates).map(([id, value]) => <div className="eco-loyalty-actions" key={id}>
            <label>{groupNames.get(id) ?? "Архивная группа"} · ставка, %
              <input type="number" min={0} max={100} step="0.01" required value={value / 100}
                onChange={(event) => setRates({ ...settings.rules.groupRates, [id]: Math.round(Number(event.target.value) * 100) })} />
            </label>
            <button type="button" className="eco-btn" onClick={() => {
              const copy = { ...settings.rules.groupRates }; delete copy[id]; setRates(copy);
            }}>Убрать отдельную ставку</button>
          </div>)}
          <div className="eco-loyalty-actions">
            <label>Группа <select value={group} onChange={(event) => setGroup(event.target.value)}>
              <option value="">Выберите группу из каталога</option>
              {settings.groups.map((branch) => <optgroup key={branch.branchId} label={branch.name}>
                {branch.groups.filter((item) => !(item.id in settings.rules.groupRates)).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
              </optgroup>)}
            </select></label>
            <label>Ставка, % <input type="number" min={0} max={100} step="0.01" value={rate} onChange={(event) => setRate(event.target.value)} /></label>
            <button type="button" className="eco-btn" disabled={!group || !validRate} onClick={() => {
              setRates({ ...settings.rules.groupRates, [group]: Math.round(Number(rate) * 100) }); setGroup(""); setRate("");
            }}>Добавить ставку</button>
          </div>
        </fieldset>
        <button type="submit" className="eco-btn eco-btn--primary" disabled={busy}>{busy ? "Сохраняем…" : "Сохранить правила"}</button>
      </form>}
    </section>}
    <section className="eco-card eco-card--padded">
      <h2>Спорные привязки</h2>
      {!branchId && <p>Выберите филиал, чтобы увидеть карточки на проверке.</p>}
      {reviewError && <p role="alert">{reviewError}</p>}
      {reviews?.enabled && (reviews.clients.length
        ? <ul>{reviews.clients.map((client) => <li key={client.id}><Link href={`/clients/counterparties?counterparty=${encodeURIComponent(client.id)}`}>{client.displayName || client.name}</Link></li>)}</ul>
        : <p>В филиале нет карточек на проверке.</p>)}
    </section>
  </>;
}
