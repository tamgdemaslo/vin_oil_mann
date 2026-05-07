"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type Deal = {
  id: string;
  title: string;
  customerName: string | null;
  phoneNormalized: string | null;
  vehicle: string | null;
  source: string | null;
  amountCents: number | null;
  stageId: string;
  responsibleLogin: string | null;
  moyskladCounterpartyId: string | null;
  moyskladCounterpartyName: string | null;
  moyskladCounterpartyHref: string | null;
  nextContactAt: string | null;
  notes: string | null;
  updatedAt: string;
};

type Meta = { href: string; type: string; mediaType: string };
type Counterparty = { id: string; name: string; meta: Meta };

type Stage = {
  id: string;
  name: string;
  sortOrder: number;
  color: string | null;
  deals: Deal[];
};

type PipelineResponse = {
  stages: Stage[];
  error?: string;
  hint?: string;
};

type CreateForm = {
  title: string;
  customerName: string;
  phone: string;
  vehicle: string;
  source: string;
  amount: string;
  nextContactAt: string;
  notes: string;
  createMoyskladCounterparty: boolean;
};

const EMPTY_FORM: CreateForm = {
  title: "",
  customerName: "",
  phone: "",
  vehicle: "",
  source: "",
  amount: "",
  nextContactAt: "",
  notes: "",
  createMoyskladCounterparty: false,
};

function formatMoney(amountCents: number | null) {
  if (amountCents == null) return "Без суммы";
  return `${(amountCents / 100).toLocaleString("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })} ₽`;
}

function formatDateTime(value: string | null) {
  if (!value) return "Не назначен";
  return new Date(value).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function stageTone(color: string | null) {
  if (color === "emerald") return "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300";
  if (color === "rose") return "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300";
  if (color === "sky" || color === "blue") return "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-300";
  if (color === "violet") return "border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-900/60 dark:bg-violet-950/30 dark:text-violet-300";
  if (color === "orange") return "border-orange-200 bg-orange-50 text-orange-800 dark:border-orange-900/60 dark:bg-orange-950/30 dark:text-orange-300";
  return "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300";
}

export default function CrmPipelineClient({
  userLogin,
  userName,
}: {
  userLogin: string;
  userName: string;
}) {
  const [stages, setStages] = useState<Stage[]>([]);
  const [form, setForm] = useState<CreateForm>(EMPTY_FORM);
  const [counterpartySearch, setCounterpartySearch] = useState("");
  const [counterpartyOptions, setCounterpartyOptions] = useState<Counterparty[]>([]);
  const [selectedCounterparty, setSelectedCounterparty] = useState<Counterparty | null>(null);
  const [counterpartyLoading, setCounterpartyLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [movingDealId, setMovingDealId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  const totals = useMemo(() => {
    const deals = stages.flatMap((stage) => stage.deals);
    return {
      dealsCount: deals.length,
      amountCents: deals.reduce((sum, deal) => sum + (deal.amountCents ?? 0), 0),
      nextContacts: deals.filter((deal) => deal.nextContactAt).length,
    };
  }, [stages]);

  const loadPipeline = useCallback(async () => {
    setLoading(true);
    setError(null);
    setHint(null);
    try {
      const res = await fetch("/api/crm/deals", { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as PipelineResponse;
      if (!res.ok) {
        setError(data.error ?? "Не удалось загрузить CRM");
        setHint(data.hint ?? null);
        return;
      }
      setStages(data.stages ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPipeline();
  }, [loadPipeline]);

  useEffect(() => {
    if (!counterpartySearch.trim() || selectedCounterparty) {
      setCounterpartyOptions([]);
      return;
    }
    const timer = setTimeout(() => {
      setCounterpartyLoading(true);
      fetch(`/api/moysklad/counterparties?search=${encodeURIComponent(counterpartySearch.trim())}&limit=10`)
        .then((res) => res.json())
        .then((data) => {
          setCounterpartyOptions(Array.isArray(data.counterparties) ? data.counterparties : []);
        })
        .catch(() => setCounterpartyOptions([]))
        .finally(() => setCounterpartyLoading(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [counterpartySearch, selectedCounterparty]);

  function updateForm<K extends keyof CreateForm>(key: K, value: CreateForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function createDeal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/crm/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          moyskladCounterpartyName: counterpartySearch.trim() || form.customerName || form.title,
          moyskladCounterparty: selectedCounterparty,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Не удалось создать сделку");
        return;
      }
      setForm(EMPTY_FORM);
      setSelectedCounterparty(null);
      setCounterpartySearch("");
      setCounterpartyOptions([]);
      await loadPipeline();
    } finally {
      setSaving(false);
    }
  }

  async function moveDeal(dealId: string, stageId: string) {
    setMovingDealId(dealId);
    setError(null);
    try {
      const res = await fetch(`/api/crm/deals/${dealId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stageId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Не удалось переместить сделку");
        return;
      }
      await loadPipeline();
    } finally {
      setMovingDealId(null);
    }
  }

  return (
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
      <section className="overflow-hidden rounded-[2rem] border border-amber-200/60 bg-gradient-to-br from-amber-50 via-white to-zinc-50 p-5 shadow-sm dark:border-amber-900/40 dark:from-zinc-900 dark:via-zinc-950 dark:to-zinc-900 sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-medium text-amber-700 dark:text-amber-400">CRM</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
              Воронка продаж
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
              Быстрый контроль лидов, записей и сделок до оплаты. Ответственный по умолчанию: {userName || userLogin}.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/70 bg-white/80 px-4 py-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/70">
              <p className="text-xs uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">Сделки</p>
              <p className="mt-1 text-xl font-semibold text-zinc-950 dark:text-zinc-50">{totals.dealsCount}</p>
            </div>
            <div className="rounded-2xl border border-white/70 bg-white/80 px-4 py-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/70">
              <p className="text-xs uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">Сумма</p>
              <p className="mt-1 text-xl font-semibold text-zinc-950 dark:text-zinc-50">
                {formatMoney(totals.amountCents)}
              </p>
            </div>
            <div className="rounded-2xl border border-white/70 bg-white/80 px-4 py-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/70">
              <p className="text-xs uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">Контакты</p>
              <p className="mt-1 text-xl font-semibold text-zinc-950 dark:text-zinc-50">{totals.nextContacts}</p>
            </div>
          </div>
        </div>
      </section>

      <form
        onSubmit={createDeal}
        className="rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 sm:p-5"
      >
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">Новая сделка</h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Достаточно указать клиента, телефон или короткое название.
            </p>
          </div>
          <button
            type="submit"
            disabled={saving}
            className="mt-3 rounded-full bg-amber-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-amber-600 dark:hover:bg-amber-700 sm:mt-0"
          >
            {saving ? "Создаём..." : "Добавить в воронку"}
          </button>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <input
            value={form.title}
            onChange={(event) => updateForm("title", event.target.value)}
            placeholder="Название сделки"
            className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-amber-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
          />
          <input
            value={form.customerName}
            onChange={(event) => updateForm("customerName", event.target.value)}
            placeholder="Клиент"
            className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-amber-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
          />
          <input
            value={form.phone}
            onChange={(event) => updateForm("phone", event.target.value)}
            placeholder="Телефон"
            className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-amber-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
          />
          <input
            value={form.vehicle}
            onChange={(event) => updateForm("vehicle", event.target.value)}
            placeholder="Авто / госномер"
            className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-amber-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
          />
          <input
            value={form.source}
            onChange={(event) => updateForm("source", event.target.value)}
            placeholder="Источник"
            className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-amber-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
          />
          <input
            value={form.amount}
            onChange={(event) => updateForm("amount", event.target.value)}
            placeholder="Сумма, ₽"
            inputMode="decimal"
            className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-amber-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
          />
          <input
            value={form.nextContactAt}
            onChange={(event) => updateForm("nextContactAt", event.target.value)}
            type="datetime-local"
            className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-amber-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
          />
          <input
            value={form.notes}
            onChange={(event) => updateForm("notes", event.target.value)}
            placeholder="Комментарий"
            className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-amber-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
          />
        </div>
        <div className="mt-4 rounded-2xl border border-zinc-200 bg-zinc-50/70 p-3 dark:border-zinc-800 dark:bg-zinc-950/50">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 flex-1">
              <label className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                Контрагент МойСклад
              </label>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                Выберите существующего клиента или создайте нового контрагента вместе со сделкой.
              </p>
              {selectedCounterparty ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300">
                  <span className="font-medium">{selectedCounterparty.name}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCounterparty(null);
                      setCounterpartySearch("");
                    }}
                    className="text-xs underline-offset-2 hover:underline"
                  >
                    Сменить
                  </button>
                </div>
              ) : (
                <div className="relative mt-3">
                  <input
                    value={counterpartySearch}
                    onChange={(event) => {
                      setCounterpartySearch(event.target.value);
                      updateForm("createMoyskladCounterparty", false);
                    }}
                    placeholder="Поиск по имени или телефону"
                    className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-amber-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
                  />
                  {(counterpartyLoading || counterpartyOptions.length > 0 || counterpartySearch.trim()) && (
                    <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-auto rounded-xl border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                      {counterpartyLoading && (
                        <div className="px-3 py-2 text-sm text-zinc-500 dark:text-zinc-400">Ищем...</div>
                      )}
                      {!counterpartyLoading &&
                        counterpartyOptions.map((counterparty) => (
                          <button
                            key={counterparty.id}
                            type="button"
                            onClick={() => {
                              setSelectedCounterparty(counterparty);
                              setCounterpartySearch(counterparty.name);
                              setCounterpartyOptions([]);
                              updateForm("customerName", form.customerName || counterparty.name);
                              updateForm("createMoyskladCounterparty", false);
                            }}
                            className="block w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-800 hover:bg-zinc-50 dark:text-zinc-100 dark:hover:bg-zinc-800"
                          >
                            {counterparty.name}
                          </button>
                        ))}
                      {!counterpartyLoading && counterpartySearch.trim() && counterpartyOptions.length === 0 && (
                        <div className="px-3 py-2 text-sm text-zinc-500 dark:text-zinc-400">
                          Контрагент не найден
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
            {!selectedCounterparty && (
              <label className="flex max-w-sm items-start gap-2 rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm text-zinc-700 dark:border-amber-900/50 dark:bg-zinc-900 dark:text-zinc-200">
                <input
                  type="checkbox"
                  checked={form.createMoyskladCounterparty}
                  onChange={(event) => updateForm("createMoyskladCounterparty", event.target.checked)}
                  className="mt-1"
                />
                <span>
                  Создать нового контрагента в МойСклад при сохранении сделки
                </span>
              </label>
            )}
          </div>
        </div>
        {error && <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
        {hint && <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{hint}</p>}
      </form>

      <section className="overflow-x-auto pb-2">
        {loading ? (
          <div className="rounded-3xl border border-zinc-200 bg-white p-6 text-sm text-zinc-500 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
            Загружаем воронку...
          </div>
        ) : (
          <div className="grid min-w-[1180px] grid-cols-4 gap-4 xl:min-w-0 xl:grid-cols-8">
            {stages.map((stage, stageIndex) => {
              const prevStage = stages[stageIndex - 1];
              const nextStage = stages[stageIndex + 1];
              const stageAmount = stage.deals.reduce((sum, deal) => sum + (deal.amountCents ?? 0), 0);

              return (
                <div
                  key={stage.id}
                  className="flex min-h-[360px] flex-col rounded-3xl border border-zinc-200 bg-zinc-50/80 p-3 dark:border-zinc-800 dark:bg-zinc-900/60"
                >
                  <div className={`rounded-2xl border px-3 py-2 ${stageTone(stage.color)}`}>
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="text-sm font-semibold">{stage.name}</h2>
                      <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs dark:bg-zinc-950/40">
                        {stage.deals.length}
                      </span>
                    </div>
                    <p className="mt-1 text-xs opacity-80">{formatMoney(stageAmount)}</p>
                  </div>

                  <div className="mt-3 flex flex-1 flex-col gap-3">
                    {stage.deals.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-zinc-300 p-3 text-sm text-zinc-400 dark:border-zinc-700">
                        Пока пусто
                      </div>
                    ) : (
                      stage.deals.map((deal) => (
                        <article
                          key={deal.id}
                          className="rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <h3 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                                {deal.title}
                              </h3>
                              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                                {deal.customerName || "Клиент не указан"}
                              </p>
                            </div>
                            <span className="shrink-0 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                              {formatMoney(deal.amountCents)}
                            </span>
                          </div>
                          <div className="mt-3 space-y-1 text-xs text-zinc-500 dark:text-zinc-400">
                            <p>Телефон: {deal.phoneNormalized || "—"}</p>
                            <p>МойСклад: {deal.moyskladCounterpartyName || "—"}</p>
                            <p>Авто: {deal.vehicle || "—"}</p>
                            <p>Контакт: {formatDateTime(deal.nextContactAt)}</p>
                            <p>Источник: {deal.source || "—"}</p>
                          </div>
                          {deal.notes && (
                            <p className="mt-3 rounded-xl bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                              {deal.notes}
                            </p>
                          )}
                          <div className="mt-3 flex gap-2">
                            <button
                              type="button"
                              disabled={!prevStage || movingDealId === deal.id}
                              onClick={() => prevStage && moveDeal(deal.id, prevStage.id)}
                              className="rounded-full border border-zinc-200 px-3 py-1 text-xs font-medium text-zinc-600 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                            >
                              Назад
                            </button>
                            <button
                              type="button"
                              disabled={!nextStage || movingDealId === deal.id}
                              onClick={() => nextStage && moveDeal(deal.id, nextStage.id)}
                              className="rounded-full bg-zinc-950 px-3 py-1 text-xs font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
                            >
                              Дальше
                            </button>
                          </div>
                        </article>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
