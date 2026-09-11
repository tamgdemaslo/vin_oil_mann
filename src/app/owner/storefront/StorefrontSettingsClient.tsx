"use client";

import { useState } from "react";

type StoreOption = { id: string; branchId: string; name: string; isMain: boolean; archived: boolean };
type BranchOption = {
  id: string;
  slug: string;
  name: string;
  shortName: string | null;
  address: string | null;
  phone: string | null;
  status: string;
  enabled: boolean;
  publicName: string;
  publicAddress: string;
  publicPhone: string;
  sortOrder: number;
  selectedStoreIds: string[];
  stores: StoreOption[];
};
type Settings = {
  canManage: boolean;
  storefront: { id: string; slug: string; name: string; status: string } | null;
  branches: BranchOption[];
};

export default function StorefrontSettingsClient({ initial }: { initial: Settings }) {
  const [settings, setSettings] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function updateBranch(branchId: string, patch: Partial<BranchOption>) {
    setSettings((current) => ({
      ...current,
      branches: current.branches.map((branch) => branch.id === branchId ? { ...branch, ...patch } : branch),
    }));
  }

  function toggleStore(branch: BranchOption, storeId: string) {
    const selectedStoreIds = branch.selectedStoreIds.includes(storeId)
      ? branch.selectedStoreIds.filter((id) => id !== storeId)
      : [...branch.selectedStoreIds, storeId];
    updateBranch(branch.id, { selectedStoreIds });
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const enabled = settings.branches.filter((branch) => branch.enabled);
      const response = await fetch("/api/owner/storefront", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: settings.storefront?.slug || "client-site",
          name: settings.storefront?.name || "Клиентский сайт",
          branches: enabled.map((branch, index) => ({
            branchId: branch.id,
            storeIds: branch.selectedStoreIds,
            publicName: branch.publicName || branch.shortName || branch.name,
            publicAddress: branch.publicAddress || branch.address,
            publicPhone: branch.publicPhone || branch.phone,
            sortOrder: index,
          })),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Не удалось сохранить витрину");
      setSettings(payload);
      setMessage("Публичные филиалы и склады сохранены. Товары не опубликованы автоматически.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="eco-page eco-page--wide eco-storefront-settings">
      <header className="eco-owner-dashboard__head">
        <div>
          <p>Владелец · Все филиалы</p>
          <h1>Клиентская витрина</h1>
          <span>Выберите точки и физические склады, остатки которых можно показывать клиентам.</span>
        </div>
        <a href="/owner" className="eco-btn eco-btn--secondary">К сводке</a>
      </header>

      <section className="eco-owner-dashboard__section">
        <div className="eco-owner-dashboard__section-head">
          <div>
            <h2>Публичные филиалы и склады</h2>
            <span>ID и реквизиты загружены из справочника CRM</span>
          </div>
        </div>
        <div className="eco-storefront-settings__branches">
          {settings.branches.map((branch) => (
            <article key={branch.id} className={branch.enabled ? "is-enabled" : ""}>
              <label className="eco-storefront-settings__branch-toggle">
                <input
                  type="checkbox"
                  checked={branch.enabled}
                  onChange={(event) => updateBranch(branch.id, { enabled: event.target.checked })}
                />
                <span><b>{branch.shortName || branch.name}</b><small>{branch.address || "Адрес не указан"}</small></span>
              </label>
              {branch.enabled ? (
                <div className="eco-storefront-settings__stores">
                  <strong>Склады, доступные для сайта</strong>
                  {branch.stores.length ? branch.stores.map((store) => (
                    <label key={store.id}>
                      <input type="checkbox" checked={branch.selectedStoreIds.includes(store.id)} onChange={() => toggleStore(branch, store.id)} />
                      <span>{store.name}{store.isMain ? " · основной" : ""}</span>
                    </label>
                  )) : <span>В филиале нет активных складов.</span>}
                </div>
              ) : null}
            </article>
          ))}
        </div>
        {message ? <div className="eco-products-notice is-success">{message}</div> : null}
        {error ? <div className="eco-products-notice is-error">{error}</div> : null}
        <div className="eco-storefront-settings__actions">
          <button type="button" className="eco-btn eco-btn--primary" disabled={saving} onClick={() => void save()}>
            {saving ? "Сохраняем…" : "Сохранить витрину"}
          </button>
          <span>Сохранение не меняет остатки, цены и публикацию товаров.</span>
        </div>
      </section>
    </main>
  );
}
