"use client";

import { useEffect, useState, type FormEvent } from "react";
import { safeReadJson } from "@/lib/http-json";

type Branch = {
  id: string;
  name: string;
  shortName: string;
  slug: string;
  status: string;
  address: string | null;
  phone: string | null;
};

export default function BranchesPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [canManage, setCanManage] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    const response = await fetch("/api/branches", { cache: "no-store" });
    const payload = await safeReadJson<{ branches?: Branch[]; canManageBranches?: boolean; error?: string }>(response);
    setBranches(payload?.branches ?? []);
    setCanManage(Boolean(payload?.canManageBranches));
    setError(response.ok ? "" : payload?.error ?? "Не удалось загрузить филиалы");
    setLoading(false);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/branches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(form.entries())),
    });
    const payload = await safeReadJson<{ error?: string }>(response);
    if (!response.ok) {
      setError(payload?.error ?? "Не удалось создать филиал");
      return;
    }
    event.currentTarget.reset();
    setCreating(false);
    await load();
  }

  return (
    <main className="eco-branches-page">
      <header className="eco-branches-page__head">
        <div><p>BusinessGroup</p><h1>Филиалы</h1><span>Изолированные рабочие области компании и доступ сотрудников.</span></div>
        {canManage && <button type="button" className="eco-btn eco-btn--primary" onClick={() => setCreating((value) => !value)}>{creating ? "Закрыть" : "Создать филиал"}</button>}
      </header>

      {error && <p className="eco-branches-page__error" role="alert">{error}</p>}

      {creating && (
        <form className="eco-branches-page__form" onSubmit={submit}>
          <div><label>Название<input name="name" required placeholder="Светлый" /></label><label>Короткое название<input name="shortName" required placeholder="Светлый" /></label></div>
          <div><label>Адрес<input name="address" placeholder="Адрес точки" /></label><label>Часовой пояс<input name="timezone" defaultValue="Europe/Kaliningrad" /></label></div>
          <div><label>Рабочий телефон<input name="phone" inputMode="tel" /></label><label>Дата открытия<input name="openingDate" type="date" /></label></div>
          <details><summary>Юридические данные</summary><div><label>Юридическое лицо<input name="legalEntityName" /></label><label>Тип<input name="legalEntityType" placeholder="ИП или ООО" /></label><label>ИНН<input name="inn" inputMode="numeric" /></label><label>ОГРН / ОГРНИП<input name="ogrn" inputMode="numeric" /></label></div></details>
          <footer><span>Новый филиал создаётся пустым: остатки, клиенты, продажи и история не копируются.</span><button className="eco-btn eco-btn--primary" type="submit">Создать пустой филиал</button></footer>
        </form>
      )}

      <section className="eco-branches-page__list" aria-busy={loading}>
        {loading ? <p>Загрузка филиалов…</p> : branches.map((branch) => (
          <article key={branch.id}>
            <span className={`eco-branches-page__dot is-${branch.status}`} />
            <div><strong>{branch.shortName}</strong><small>{branch.address || "Адрес не заполнен"}</small></div>
            <span>{branch.phone || "Телефон не заполнен"}</span>
            <code>/branches/{branch.slug}</code>
            <span className="eco-branches-page__status">{branch.status === "active" ? "Активен" : "Архив"}</span>
          </article>
        ))}
      </section>
    </main>
  );
}
