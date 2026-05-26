"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  Plus,
  Search,
  UserRound,
} from "lucide-react";
import MoneyInput from "@/components/MoneyInput";
import { EcoBadge, EcoButton, EcoKpi, EcoStatusDot } from "@/components/platform/EcoUI";

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

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

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

function daysSince(value: string) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return 0;
  return Math.max(0, Math.floor((Date.now() - time) / 86_400_000));
}

function stageAccent(color: string | null) {
  if (color === "emerald") return "#059669";
  if (color === "rose") return "#e11d48";
  if (color === "sky" || color === "blue") return "#0284c7";
  if (color === "violet") return "#7c3aed";
  if (color === "orange" || color === "amber") return "#c2410c";
  return "#52525b";
}

function sourceAccent(source: string | null) {
  const value = (source ?? "").toLowerCase();
  if (value.includes("yclients") || value.includes("онлайн")) return "#2563eb";
  if (value.includes("сайт") || value.includes("web")) return "#c2410c";
  if (value.includes("тел") || value.includes("звон")) return "#059669";
  if (value.includes("соц") || value.includes("inst") || value.includes("vk")) return "#9333ea";
  return "#71717a";
}

function isWonStage(stage: Stage) {
  const name = stage.name.toLowerCase();
  return name.includes("оплач") || name.includes("выиг") || name.includes("won");
}

function isLostStage(stage: Stage) {
  const name = stage.name.toLowerCase();
  return name.includes("потер") || name.includes("отлож") || name.includes("lost");
}

function loginLabel(value: string | null) {
  return value?.trim() || "Без ответственного";
}

function shortId(value: string) {
  if (value.length <= 8) return value;
  return `CRM-${value.slice(-6).toUpperCase()}`;
}

function matchQuery(deal: Deal, query: string) {
  if (!query) return true;
  const haystack = [
    deal.title,
    deal.customerName,
    deal.phoneNormalized,
    deal.vehicle,
    deal.source,
    deal.responsibleLogin,
    deal.moyskladCounterpartyName,
    deal.notes,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
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
  const [scope, setScope] = useState<"all" | "mine">("all");
  const [query, setQuery] = useState("");
  const [responsibleFilter, setResponsibleFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");

  const allDeals = useMemo(() => stages.flatMap((stage) => stage.deals), [stages]);

  const responsibleOptions = useMemo(
    () => Array.from(new Set(allDeals.map((deal) => loginLabel(deal.responsibleLogin)))).sort((a, b) => a.localeCompare(b, "ru")),
    [allDeals]
  );

  const sourceOptions = useMemo(
    () =>
      Array.from(new Set(allDeals.map((deal) => deal.source?.trim()).filter((source): source is string => Boolean(source)))).sort(
        (a, b) => a.localeCompare(b, "ru")
      ),
    [allDeals]
  );

  const filteredStages = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return stages.map((stage) => ({
      ...stage,
      deals: stage.deals.filter((deal) => {
        if (scope === "mine" && deal.responsibleLogin !== userLogin) return false;
        if (responsibleFilter !== "all" && loginLabel(deal.responsibleLogin) !== responsibleFilter) return false;
        if (sourceFilter !== "all" && deal.source?.trim() !== sourceFilter) return false;
        return matchQuery(deal, normalizedQuery);
      }),
    }));
  }, [query, responsibleFilter, scope, sourceFilter, stages, userLogin]);

  const filteredTotals = useMemo(() => {
    let dealsCount = 0;
    let amountCents = 0;
    let nextContacts = 0;
    let wonDeals = 0;
    for (const stage of filteredStages) {
      for (const deal of stage.deals) {
        dealsCount += 1;
        amountCents += deal.amountCents ?? 0;
        if (deal.nextContactAt) nextContacts += 1;
        if (isWonStage(stage)) wonDeals += 1;
      }
    }
    return {
      dealsCount,
      amountCents,
      nextContacts,
      conversion: dealsCount ? Math.round((wonDeals / dealsCount) * 100) : 0,
    };
  }, [filteredStages]);

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
    <main className="eco-page">
      <section className="eco-page-head">
        <div>
          <div className="eco-page-crumbs">
            <Link href="/">Главная</Link>
            <span className="sep">/</span>
            <span>CRM</span>
            <span className="sep">/</span>
            <span className="cur">Воронка</span>
          </div>
          <div className="eco-title-row">
            <h1 className="eco-page-title">Воронка продаж</h1>
            <EcoBadge>{filteredTotals.dealsCount} сделок</EcoBadge>
            <EcoBadge tone="rust">{formatMoney(filteredTotals.amountCents)}</EcoBadge>
            <EcoBadge tone="success" dot>
              конверсия {filteredTotals.conversion}%
            </EcoBadge>
          </div>
          <p className="eco-page-subtitle">
            Быстрый контроль лидов, записей и сделок до оплаты. Ответственный по умолчанию: {userName || userLogin}.
          </p>
        </div>
        <div className="eco-page-actions">
          <Link href="/records" className="eco-btn">
            <UserRound size={15} />
            Журнал записей
            <ArrowRight size={14} />
          </Link>
          <EcoButton variant="primary" form="crm-new-deal-form" type="submit" disabled={saving}>
            <Plus size={15} />
            {saving ? "Создаём..." : "Новая сделка"}
          </EcoButton>
        </div>
      </section>

      <div className="eco-grid eco-grid--kpi eco-crm-metrics">
        <EcoKpi label="Сделки" value={filteredTotals.dealsCount} tone="info" />
        <EcoKpi label="Сумма" value={formatMoney(filteredTotals.amountCents)} tone="rust" />
        <EcoKpi label="Контакты" value={filteredTotals.nextContacts} tone="success" />
        <EcoKpi label="Стадий" value={stages.length} tone="neutral" />
      </div>

      <div className="eco-crm-filter-strip">
        <div className="eco-seg">
          <button
            type="button"
            className={cx("eco-seg-btn", scope === "all" && "is-active")}
            onClick={() => setScope("all")}
          >
            Все сделки
          </button>
          <button
            type="button"
            className={cx("eco-seg-btn", scope === "mine" && "is-active")}
            onClick={() => setScope("mine")}
          >
            Только мои
          </button>
        </div>
        <div className="eco-search-wrap eco-crm-search">
          <Search className="eco-icon" size={15} />
          <input
            className="eco-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Имя, телефон, сделка..."
          />
        </div>
        <label className="eco-select-chip">
          <span>Ответственный:</span>
          <select
            value={responsibleFilter}
            onChange={(event) => setResponsibleFilter(event.target.value)}
            className="eco-select-inline"
          >
            <option value="all">Все</option>
            {responsibleOptions.map((responsible) => (
              <option key={responsible} value={responsible}>
                {responsible}
              </option>
            ))}
          </select>
        </label>
        <label className="eco-select-chip">
          <span>Источник:</span>
          <select
            value={sourceFilter}
            onChange={(event) => setSourceFilter(event.target.value)}
            className="eco-select-inline"
          >
            <option value="all">Все</option>
            {sourceOptions.map((source) => (
              <option key={source} value={source}>
                {source}
              </option>
            ))}
          </select>
        </label>
        <div className="grow" />
        <div className="eco-seg" aria-label="Вид CRM">
          <button type="button" className="eco-seg-btn is-active">
            Канбан
          </button>
          <button type="button" className="eco-seg-btn" disabled>
            Список
          </button>
        </div>
      </div>

      <form id="crm-new-deal-form" onSubmit={createDeal} className="eco-card eco-card--padded eco-crm-form">
        <div className="eco-card__head eco-card__head--plain">
          <div>
            <h2>Новая сделка</h2>
            <p>Достаточно указать клиента, телефон или короткое название.</p>
          </div>
          <EcoButton variant="primary" type="submit" disabled={saving}>
            <Plus size={15} />
            {saving ? "Создаём..." : "Добавить"}
          </EcoButton>
        </div>
        <div className="eco-crm-form-grid">
          <input
            value={form.title}
            onChange={(event) => updateForm("title", event.target.value)}
            placeholder="Название сделки"
            className="eco-input"
          />
          <input
            value={form.customerName}
            onChange={(event) => updateForm("customerName", event.target.value)}
            placeholder="Клиент"
            className="eco-input"
          />
          <input
            value={form.phone}
            onChange={(event) => updateForm("phone", event.target.value)}
            placeholder="Телефон"
            className="eco-input"
          />
          <input
            value={form.vehicle}
            onChange={(event) => updateForm("vehicle", event.target.value)}
            placeholder="Авто / госномер"
            className="eco-input"
          />
          <input
            value={form.source}
            onChange={(event) => updateForm("source", event.target.value)}
            placeholder="Источник"
            className="eco-input"
          />
          <MoneyInput
            value={form.amount}
            onValueChange={(amount, draft) => updateForm("amount", draft ? String(amount) : "")}
            placeholder="Сумма, ₽"
            className="eco-input"
          />
          <input
            value={form.nextContactAt}
            onChange={(event) => updateForm("nextContactAt", event.target.value)}
            type="datetime-local"
            className="eco-input"
          />
          <input
            value={form.notes}
            onChange={(event) => updateForm("notes", event.target.value)}
            placeholder="Комментарий"
            className="eco-input"
          />
        </div>
        <div className="eco-counterparty-box">
          <div className="eco-counterparty-main">
            <div className="eco-filter-title">Контрагент МойСклад</div>
            <p className="muted">Выберите существующего клиента или создайте нового контрагента вместе со сделкой.</p>
            {selectedCounterparty ? (
              <div className="eco-counterparty-selected">
                <CheckCircle2 size={15} />
                <span>{selectedCounterparty.name}</span>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCounterparty(null);
                    setCounterpartySearch("");
                  }}
                >
                  Сменить
                </button>
              </div>
            ) : (
              <div className="eco-counterparty-search">
                <input
                  value={counterpartySearch}
                  onChange={(event) => {
                    setCounterpartySearch(event.target.value);
                    updateForm("createMoyskladCounterparty", false);
                  }}
                  placeholder="Поиск по имени или телефону"
                  className="eco-input"
                />
                {(counterpartyLoading || counterpartyOptions.length > 0 || counterpartySearch.trim()) && (
                  <div className="eco-counterparty-dropdown">
                    {counterpartyLoading && <div className="eco-counterparty-empty">Ищем...</div>}
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
                        >
                          {counterparty.name}
                        </button>
                      ))}
                    {!counterpartyLoading && counterpartySearch.trim() && counterpartyOptions.length === 0 && (
                      <div className="eco-counterparty-empty">Контрагент не найден</div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
          {!selectedCounterparty && (
            <label className="eco-check-row">
              <input
                type="checkbox"
                checked={form.createMoyskladCounterparty}
                onChange={(event) => updateForm("createMoyskladCounterparty", event.target.checked)}
              />
              <span>Создать нового контрагента в МойСклад при сохранении сделки</span>
            </label>
          )}
        </div>
        {error && <p className="eco-form-error">{error}</p>}
        {hint && <p className="eco-form-hint">{hint}</p>}
      </form>

      <section className="eco-crm-board-shell">
        {loading ? (
          <div className="eco-card eco-card--padded muted">Загружаем воронку...</div>
        ) : (
          <div className="eco-crm-board" style={{ gridTemplateColumns: `repeat(${Math.max(stages.length, 1)}, minmax(260px, 1fr))` }}>
            {filteredStages.map((stage, stageIndex) => {
              const prevStage = stages[stageIndex - 1];
              const nextStage = stages[stageIndex + 1];
              const stageAmount = stage.deals.reduce((sum, deal) => sum + (deal.amountCents ?? 0), 0);
              const won = isWonStage(stage);
              const lost = isLostStage(stage);

              return (
                <div
                  key={stage.id}
                  className="eco-crm-column"
                  style={{ borderTopColor: stageAccent(stage.color) }}
                >
                  <div className="eco-crm-column-head">
                    <div>
                      <div className="eco-crm-column-title">
                        <span>{stage.name}</span>
                        <span className="eco-crm-column-count">{stage.deals.length}</span>
                      </div>
                      <div className="l-money eco-crm-column-sum">{formatMoney(stageAmount)}</div>
                    </div>
                    <button type="button" className="eco-icon-btn" aria-label={`Добавить в ${stage.name}`}>
                      <Plus size={15} />
                    </button>
                  </div>

                  <div className="eco-crm-cards">
                    {stage.deals.length === 0 ? (
                      <div className="eco-crm-empty">Пусто</div>
                    ) : (
                      stage.deals.map((deal) => {
                        const overdue = Boolean(deal.nextContactAt && new Date(deal.nextContactAt).getTime() < Date.now() && !won && !lost);
                        const age = daysSince(deal.updatedAt);
                        return (
                          <article key={deal.id} className={cx("eco-deal-card", lost && "is-muted", overdue && "is-overdue")}>
                            <div className="eco-deal-card__top">
                              <span className="l-mono">{shortId(deal.id)}</span>
                              {!won && !lost && <span className={cx(age >= 3 && "is-warn")}>{age === 0 ? "сегодня" : `${age} дн.`}</span>}
                            </div>
                            <div className="eco-deal-card__title">{deal.customerName || deal.title}</div>
                            <div className="eco-deal-card__vehicle">
                              <UserRound size={13} />
                              <span>{deal.vehicle || deal.phoneNormalized || "Клиент без авто"}</span>
                            </div>
                            <p className="eco-deal-card__text">{deal.title}</p>
                            {deal.amountCents ? (
                              <div className="l-money eco-deal-card__amount">{formatMoney(deal.amountCents)}</div>
                            ) : null}
                            <div className="eco-deal-card__meta">
                              <span>
                                <EcoStatusDot tone="neutral" />
                                {deal.moyskladCounterpartyName || "МойСклад не связан"}
                              </span>
                              <span>{loginLabel(deal.responsibleLogin)}</span>
                            </div>
                            <div className="eco-deal-card__footer">
                              <span>
                                <i style={{ background: sourceAccent(deal.source) }} />
                                {deal.source || "Без источника"}
                              </span>
                              <CircleDollarSign size={15} />
                            </div>
                            {!won && !lost && deal.nextContactAt && (
                              <div className={cx("eco-deal-card__reminder", overdue && "is-overdue")}>
                                {overdue ? <Bell size={13} /> : <CalendarClock size={13} />}
                                <span>{overdue ? "Просрочен контакт" : "Связаться"}</span>
                                <strong>{formatDateTime(deal.nextContactAt)}</strong>
                              </div>
                            )}
                            {deal.notes && <p className="eco-deal-card__notes">{deal.notes}</p>}
                            <div className="eco-deal-card__actions">
                              <button
                                type="button"
                                disabled={!prevStage || movingDealId === deal.id}
                                onClick={() => prevStage && moveDeal(deal.id, prevStage.id)}
                              >
                                <ArrowLeft size={13} />
                                Назад
                              </button>
                              <button
                                type="button"
                                disabled={!nextStage || movingDealId === deal.id}
                                onClick={() => nextStage && moveDeal(deal.id, nextStage.id)}
                              >
                                Дальше
                                <ArrowRight size={13} />
                              </button>
                            </div>
                          </article>
                        );
                      })
                    )}
                  </div>

                  <button type="button" className="eco-crm-column-add">
                    <Plus size={14} />
                    Сделка
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
