"use client";

import { useEffect, useMemo, useState } from "react";

type CounterpartyRow = {
  id: string;
  name: string;
  phone: string;
  email: string;
  companyType: string;
  counterpartyTypeName: string;
  legalTitle: string;
  legalLastName: string;
  legalFirstName: string;
  legalMiddleName: string;
  legalAddress: string;
  inn: string;
  kpp: string;
  okpo: string;
  fax: string;
  bik: string;
  bankName: string;
  bankLocation: string;
  correspondentAccount: string;
  checkingAccount: string;
  ogrn: string;
  ogrnip: string;
  certificateNumber: string;
  certificateDate: string;
  archived: boolean;
};

type CounterpartyForm = {
  name: string;
  phone: string;
  email: string;
  companyType: string;
  counterpartyTypeName: string;
  legalTitle: string;
  legalLastName: string;
  legalFirstName: string;
  legalMiddleName: string;
  legalAddress: string;
  inn: string;
  kpp: string;
  okpo: string;
  fax: string;
  bik: string;
  bankName: string;
  bankLocation: string;
  correspondentAccount: string;
  checkingAccount: string;
  ogrn: string;
  ogrnip: string;
  certificateNumber: string;
  certificateDate: string;
};

const emptyForm: CounterpartyForm = {
  name: "",
  phone: "",
  email: "",
  companyType: "legal",
  counterpartyTypeName: "",
  legalTitle: "",
  legalLastName: "",
  legalFirstName: "",
  legalMiddleName: "",
  legalAddress: "",
  inn: "",
  kpp: "",
  okpo: "",
  fax: "",
  bik: "",
  bankName: "",
  bankLocation: "",
  correspondentAccount: "",
  checkingAccount: "",
  ogrn: "",
  ogrnip: "",
  certificateNumber: "",
  certificateDate: "",
};

const counterpartyExtraFields: Array<{ key: keyof CounterpartyForm; label: string; type?: "date" | "textarea" }> = [
  { key: "counterpartyTypeName", label: "Тип контрагента" },
  { key: "legalLastName", label: "Фамилия" },
  { key: "legalFirstName", label: "Имя" },
  { key: "legalMiddleName", label: "Отчество" },
  { key: "legalAddress", label: "Юридический адрес", type: "textarea" },
  { key: "inn", label: "ИНН" },
  { key: "kpp", label: "КПП" },
  { key: "okpo", label: "ОКПО" },
  { key: "fax", label: "Факс" },
  { key: "bik", label: "БИК" },
  { key: "bankName", label: "Банк" },
  { key: "bankLocation", label: "Местонахождение" },
  { key: "correspondentAccount", label: "К/с" },
  { key: "checkingAccount", label: "Р/с" },
  { key: "ogrn", label: "ОГРН" },
  { key: "ogrnip", label: "ОГРНИП" },
  { key: "certificateNumber", label: "Номер свидетельства" },
  { key: "certificateDate", label: "Дата свидетельства", type: "date" },
];

async function readJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function formFromCounterparty(row: CounterpartyRow): CounterpartyForm {
  return {
    name: row.name,
    phone: row.phone,
    email: row.email,
    companyType: row.companyType || "legal",
    counterpartyTypeName: row.counterpartyTypeName,
    legalTitle: row.legalTitle,
    legalLastName: row.legalLastName,
    legalFirstName: row.legalFirstName,
    legalMiddleName: row.legalMiddleName,
    legalAddress: row.legalAddress,
    inn: row.inn,
    kpp: row.kpp,
    okpo: row.okpo,
    fax: row.fax,
    bik: row.bik,
    bankName: row.bankName,
    bankLocation: row.bankLocation,
    correspondentAccount: row.correspondentAccount,
    checkingAccount: row.checkingAccount,
    ogrn: row.ogrn,
    ogrnip: row.ogrnip,
    certificateNumber: row.certificateNumber,
    certificateDate: row.certificateDate,
  };
}

function companyTypeLabel(value: string) {
  if (value === "individual") return "Физлицо";
  if (value === "entrepreneur") return "ИП";
  return "Компания";
}

export default function CounterpartiesClient() {
  const [rows, setRows] = useState<CounterpartyRow[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CounterpartyForm>(emptyForm);

  const editingName = useMemo(
    () => rows.find((row) => row.id === editingId)?.name ?? "",
    [editingId, rows]
  );

  async function load(nextSearch = search) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (nextSearch.trim()) params.set("search", nextSearch.trim());
      const res = await fetch(`/api/local-inventory/counterparties?${params.toString()}`, { cache: "no-store" });
      const data = await readJson<{ counterparties?: CounterpartyRow[]; error?: string }>(res);
      if (!res.ok) throw new Error(data?.error ?? "Не удалось загрузить контрагентов");
      setRows(Array.isArray(data?.counterparties) ? data.counterparties : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateForm(patch: Partial<CounterpartyForm>) {
    setForm((prev) => ({ ...prev, ...patch }));
  }

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm);
    setFormOpen(false);
  }

  function openNewCounterparty() {
    setEditingId(null);
    setForm(emptyForm);
    setInfo(null);
    setError(null);
    setFormOpen(true);
  }

  async function submit() {
    setSaving(true);
    setError(null);
    setInfo(null);
    try {
      const payload = {
        name: form.name.trim(),
        phone: form.phone.trim() || undefined,
        email: form.email.trim() || undefined,
        companyType: form.companyType,
        legalTitle: form.legalTitle.trim() || undefined,
        counterpartyTypeName: form.counterpartyTypeName.trim() || undefined,
        legalLastName: form.legalLastName.trim() || undefined,
        legalFirstName: form.legalFirstName.trim() || undefined,
        legalMiddleName: form.legalMiddleName.trim() || undefined,
        legalAddress: form.legalAddress.trim() || undefined,
        inn: form.inn.trim() || undefined,
        kpp: form.kpp.trim() || undefined,
        okpo: form.okpo.trim() || undefined,
        fax: form.fax.trim() || undefined,
        bik: form.bik.trim() || undefined,
        bankName: form.bankName.trim() || undefined,
        bankLocation: form.bankLocation.trim() || undefined,
        correspondentAccount: form.correspondentAccount.trim() || undefined,
        checkingAccount: form.checkingAccount.trim() || undefined,
        ogrn: form.ogrn.trim() || undefined,
        ogrnip: form.ogrnip.trim() || undefined,
        certificateNumber: form.certificateNumber.trim() || undefined,
        certificateDate: form.certificateDate.trim() || null,
      };
      const res = await fetch(
        editingId ? `/api/local-inventory/counterparties/${editingId}` : "/api/local-inventory/counterparties",
        {
          method: editingId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const data = await readJson<CounterpartyRow & { error?: string }>(res);
      if (!res.ok) throw new Error(data?.error ?? "Не удалось сохранить контрагента");
      setInfo(editingId ? "Контрагент обновлён" : "Контрагент добавлен");
      resetForm();
      await load(search);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function archive(row: CounterpartyRow) {
    if (!window.confirm(`Архивировать контрагента "${row.name}"?`)) return;
    setError(null);
    try {
      const res = await fetch(`/api/local-inventory/counterparties/${row.id}`, { method: "DELETE" });
      const data = await readJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(data?.error ?? "Не удалось архивировать контрагента");
      await load(search);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="space-y-5">
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 px-3 py-6 backdrop-blur-sm sm:px-6">
          <section
            role="dialog"
            aria-modal="true"
            className="w-full max-w-3xl rounded-lg border border-zinc-200 bg-white p-4 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900"
          >
        <div>
          <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">
            {editingId ? "Редактирование контрагента" : "Новый контрагент"}
          </h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {editingId ? editingName : "Клиент, поставщик или компания в локальной БД."}
          </p>
        </div>

        <div className="mt-4 space-y-3">
          <label className="block text-sm">
            <span className="text-xs font-medium text-zinc-500">Имя / название *</span>
            <input
              value={form.name}
              onChange={(event) => updateForm({ name: event.target.value })}
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
            />
          </label>
          <label className="block text-sm">
            <span className="text-xs font-medium text-zinc-500">Юридическое название</span>
            <input
              value={form.legalTitle}
              onChange={(event) => updateForm({ legalTitle: event.target.value })}
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="text-xs font-medium text-zinc-500">Телефон</span>
              <input
                value={form.phone}
                onChange={(event) => updateForm({ phone: event.target.value })}
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
              />
            </label>
            <label className="block text-sm">
              <span className="text-xs font-medium text-zinc-500">Email</span>
              <input
                type="email"
                value={form.email}
                onChange={(event) => updateForm({ email: event.target.value })}
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
              />
            </label>
          </div>
          <label className="block text-sm">
            <span className="text-xs font-medium text-zinc-500">Тип</span>
            <select
              value={form.companyType}
              onChange={(event) => updateForm({ companyType: event.target.value })}
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
            >
              <option value="legal">Компания</option>
              <option value="entrepreneur">ИП</option>
              <option value="individual">Физлицо</option>
            </select>
          </label>
          <details className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800" open={Boolean(editingId)}>
            <summary className="cursor-pointer text-sm font-semibold text-zinc-800 dark:text-zinc-100">
              Юридические и банковские поля
            </summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {counterpartyExtraFields.map((field) => (
                <label
                  key={field.key}
                  className={`block text-sm ${field.type === "textarea" || field.key === "counterpartyTypeName" ? "sm:col-span-2" : ""}`}
                >
                  <span className="text-xs font-medium text-zinc-500">{field.label}</span>
                  {field.type === "textarea" ? (
                    <textarea
                      value={form[field.key]}
                      rows={2}
                      onChange={(event) => updateForm({ [field.key]: event.target.value } as Partial<CounterpartyForm>)}
                      className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
                    />
                  ) : (
                    <input
                      type={field.type === "date" ? "date" : "text"}
                      value={form[field.key]}
                      onChange={(event) => updateForm({ [field.key]: event.target.value } as Partial<CounterpartyForm>)}
                      className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
                    />
                  )}
                </label>
              ))}
            </div>
          </details>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void submit()}
            disabled={saving}
            className="rounded-lg bg-zinc-950 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-950"
          >
            {saving ? "Сохранение..." : editingId ? "Сохранить" : "Добавить"}
          </button>
          <button
            type="button"
            onClick={resetForm}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Отмена
          </button>
        </div>
      </section>
        </div>
      )}

      <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">Контрагенты</h2>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Используются в отгрузках, приёмках и списаниях.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:items-end">
            <button
              type="button"
              onClick={openNewCounterparty}
              className="w-full rounded-lg bg-zinc-950 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800 sm:w-auto dark:bg-zinc-100 dark:text-zinc-950"
            >
              Новый контрагент
            </button>
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void load(search);
              }}
            >
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Поиск"
                className="w-48 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              />
              <button
                type="submit"
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                Найти
              </button>
            </form>
          </div>
        </div>

        {(error || info) && (
          <div className={`mt-4 rounded-lg border px-4 py-3 text-sm ${
            error
              ? "border-red-200 bg-red-50 text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
              : "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-200"
          }`}>
            {error || info}
          </div>
        )}

        <div className="mt-4 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
            <thead className="bg-zinc-50 dark:bg-zinc-950">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-zinc-600 dark:text-zinc-400">Контрагент</th>
                <th className="px-3 py-2 text-left font-medium text-zinc-600 dark:text-zinc-400">Контакты</th>
                <th className="px-3 py-2 text-left font-medium text-zinc-600 dark:text-zinc-400">Реквизиты</th>
                <th className="px-3 py-2 text-left font-medium text-zinc-600 dark:text-zinc-400">Тип</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 bg-white dark:divide-zinc-800 dark:bg-zinc-900">
              {loading && (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-zinc-500">Загрузка...</td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-zinc-500">Контрагенты не найдены.</td>
                </tr>
              )}
              {!loading && rows.map((row) => (
                <tr key={row.id}>
                  <td className="min-w-[240px] px-3 py-2">
                    <div className="font-medium text-zinc-950 dark:text-zinc-50">{row.name}</div>
                    {row.legalTitle && <div className="mt-0.5 text-xs text-zinc-500">{row.legalTitle}</div>}
                  </td>
                  <td className="min-w-[180px] px-3 py-2 text-zinc-600 dark:text-zinc-300">
                    <div>{row.phone || "—"}</div>
                    {row.email && <div className="mt-0.5 text-xs text-zinc-500">{row.email}</div>}
                  </td>
                  <td className="min-w-[220px] px-3 py-2 text-xs text-zinc-600 dark:text-zinc-300">
                    <div>{[row.inn ? `ИНН ${row.inn}` : "", row.kpp ? `КПП ${row.kpp}` : ""].filter(Boolean).join(" · ") || "—"}</div>
                    {(row.bankName || row.checkingAccount || row.ogrn) && (
                      <div className="mt-0.5 text-zinc-500">
                        {[row.bankName, row.checkingAccount ? `Р/с ${row.checkingAccount}` : "", row.ogrn ? `ОГРН ${row.ogrn}` : ""]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">{companyTypeLabel(row.companyType)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(row.id);
                        setForm(formFromCounterparty(row));
                        setInfo(null);
                        setError(null);
                        setFormOpen(true);
                      }}
                      className="rounded-lg px-2 py-1 text-sm font-medium text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-zinc-800"
                    >
                      Править
                    </button>
                    <button
                      type="button"
                      onClick={() => void archive(row)}
                      className="ml-1 rounded-lg px-2 py-1 text-sm font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                    >
                      Архив
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
