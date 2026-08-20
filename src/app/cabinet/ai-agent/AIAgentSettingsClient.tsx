"use client";

import Link from "next/link";
import { Bot, CalendarCheck, Check, CircleAlert, LoaderCircle, Save, ShieldCheck, Tags } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { EcoBadge, EcoButton, EcoCard, EcoInput, EcoKpi, EcoSelect } from "@/components/platform/EcoUI";

type AgentMode = "off" | "suggestions" | "auto_quote_approval" | "auto_booking_approval" | "autonomous";
type Tab = "general" | "prices" | "booking";

type CalculationRules = {
  serviceOilWorkCents: number;
  clientOilWorkCents: number;
  clientFilterSurchargeCents: number;
  protectionRemovalCents: number;
  protectionInstallCents: number;
  complexFilterSurchargeCents: number;
  cartridgeSurchargeCents: number;
  excessVolumeThresholdLiters: number;
  excessVolumeSurchargeCents: number;
  washerCents: number;
  drainPlugCents: number;
  environmentalFeeCents: number;
  minimumOrderCents: number;
  serviceDurationMinutes: number;
  freeWorkWithServiceOil: boolean;
  literRoundingStep: number;
  totalRoundingCents: number;
  maxAutomaticDiscountCents: number;
  quoteValidityHours: number;
  transmissionMachineExchangeMultiplier: number;
  transmissionMinimumBillableLiters: number;
  maxTechnicalVerificationPasses: number;
};

type HandoffRules = {
  lowConfidenceThreshold: number;
  highAmountCents: number;
  complaints: boolean;
  ambiguousVehicle: boolean;
  conflictingTechnicalData: boolean;
  customerRequestsHuman: boolean;
};

type RosskoMarkupRule = { fromCents: number; toCents: number | null; marginPercent: number; category?: string | null };

type AgentSettings = {
  enabled: boolean;
  mode: AgentMode;
  agentName: string;
  tone: string;
  language: string;
  channels: string[];
  allowedServices: string[];
  calculationRules: CalculationRules;
  rosskoMarkupRules: RosskoMarkupRule[];
  responseDelaySeconds: number;
  maxTurns: number;
  maxMessagesWithoutHandoff: number;
  autoBookingEnabled: boolean;
  bookingApprovalRequired: boolean;
  slotHoldMinutes: number;
  minBookingLeadMinutes: number;
  maxBookingHorizonDays: number;
  slotSuggestionCount: number;
  rosskoSearchEnabled: boolean;
  rosskoOrderApprovalRequired: boolean;
  internetSearchEnabled: boolean;
  handoffRules: HandoffRules;
  updatedAt: string;
};

type EnvironmentStatus = {
  openaiConfigured: boolean;
  bookingConfigured: boolean;
  rosskoConfigured: boolean;
};

type SettingsResponse = { settings?: AgentSettings; environment?: EnvironmentStatus; error?: string };

const tabs: Array<{ id: Tab; label: string; icon: typeof Bot }> = [
  { id: "general", label: "Работа агента", icon: Bot },
  { id: "prices", label: "Расчёт стоимости", icon: Tags },
  { id: "booking", label: "Запись и передача", icon: CalendarCheck },
];

const modeOptions: Array<{ id: AgentMode; title: string; body: string }> = [
  { id: "off", title: "Выключен", body: "Агент не отвечает и не запускает подборы в новых диалогах." },
  { id: "suggestions", title: "Только подсказки сотруднику", body: "Готовит исследование и черновик; сотрудник отправляет ответ сам." },
  { id: "auto_quote_approval", title: "Переписка с подтверждением расчёта", body: "Ведёт диалог сам, но каждый расчёт ожидает проверки сотрудника." },
  { id: "auto_booking_approval", title: "Переписка и запись после расчёта", body: "После подтверждённого расчёта сам ведёт клиента до записи; запись остаётся под контролем." },
  { id: "autonomous", title: "Автономный разрешённый сценарий", body: "Самостоятельно работает только в безопасных сценариях; расчёт всё равно подтверждает сотрудник." },
];

function Switch({ checked, onChange, title, hint }: { checked: boolean; onChange: (checked: boolean) => void; title: string; hint: string }) {
  return (
    <label className="eco-agent-switch">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="eco-agent-switch__control" aria-hidden><i /></span>
      <span><strong>{title}</strong><small>{hint}</small></span>
    </label>
  );
}

function NumberField({ label, hint, value, onChange, min = 0, max, step = 1, suffix }: {
  label: string;
  hint?: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  return (
    <label className="eco-agent-field">
      <span>{label}</span>
      <div><EcoInput type="number" min={min} max={max} step={step} value={Number.isFinite(value) ? value : 0} onChange={(event) => onChange(Number(event.target.value))} />{suffix && <em>{suffix}</em>}</div>
      {hint && <small>{hint}</small>}
    </label>
  );
}

function MoneyField({ label, hint, cents, onChange }: { label: string; hint?: string; cents: number; onChange: (cents: number) => void }) {
  return <NumberField label={label} hint={hint} value={cents / 100} onChange={(value) => onChange(Math.max(0, Math.round(value * 100)))} suffix="₽" step={10} />;
}

function SectionHead({ title, body }: { title: string; body: string }) {
  return <div className="eco-agent-settings__section-head"><div><h2>{title}</h2><p>{body}</p></div></div>;
}

function IntegrationStatus({ ok, title, body }: { ok: boolean; title: string; body: string }) {
  return (
    <div className={`eco-agent-integration ${ok ? "is-ready" : ""}`}>
      <span>{ok ? <Check size={15} /> : <CircleAlert size={15} />}</span>
      <div><strong>{title}</strong><small>{ok ? body : "Требуется настройка на сервере"}</small></div>
      <b>{ok ? "готово" : "не готово"}</b>
    </div>
  );
}

export default function AIAgentSettingsClient() {
  const [tab, setTab] = useState<Tab>("general");
  const [settings, setSettings] = useState<AgentSettings | null>(null);
  const [environment, setEnvironment] = useState<EnvironmentStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  useEffect(() => {
    void fetch("/api/ai-agent/settings", { cache: "no-store" })
      .then(async (response) => {
        const data = (await response.json().catch(() => null)) as SettingsResponse | null;
        if (!response.ok || !data?.settings) throw new Error(data?.error || "Настройки не загрузились");
        setSettings(data.settings);
        setEnvironment(data.environment ?? null);
      })
      .catch((error) => setNotice({ tone: "danger", text: error instanceof Error ? error.message : "Настройки не загрузились" }))
      .finally(() => setLoading(false));
  }, []);

  function patch(patchValue: Partial<AgentSettings>) {
    setSettings((current) => current ? { ...current, ...patchValue } : current);
  }

  function patchCalculation<K extends keyof CalculationRules>(key: K, value: CalculationRules[K]) {
    setSettings((current) => current ? { ...current, calculationRules: { ...current.calculationRules, [key]: value } } : current);
  }

  function patchHandoff<K extends keyof HandoffRules>(key: K, value: HandoffRules[K]) {
    setSettings((current) => current ? { ...current, handoffRules: { ...current.handoffRules, [key]: value } } : current);
  }

  function patchRosskoMarkup(index: number, patchValue: Partial<RosskoMarkupRule>) {
    setSettings((current) => current ? {
      ...current,
      rosskoMarkupRules: current.rosskoMarkupRules.map((rule, currentIndex) => currentIndex === index ? { ...rule, ...patchValue } : rule),
    } : current);
  }

  async function save() {
    if (!settings) return;
    setSaving(true);
    setNotice(null);
    try {
      const body = {
        enabled: settings.enabled,
        mode: settings.mode,
        agentName: settings.agentName,
        tone: settings.tone,
        language: settings.language,
        channels: settings.channels,
        allowedServices: settings.allowedServices,
        calculationRules: settings.calculationRules,
        rosskoMarkupRules: settings.rosskoMarkupRules,
        responseDelaySeconds: settings.responseDelaySeconds,
        maxTurns: settings.maxTurns,
        maxMessagesWithoutHandoff: settings.maxMessagesWithoutHandoff,
        autoBookingEnabled: settings.autoBookingEnabled,
        bookingApprovalRequired: settings.bookingApprovalRequired,
        slotHoldMinutes: settings.slotHoldMinutes,
        minBookingLeadMinutes: settings.minBookingLeadMinutes,
        maxBookingHorizonDays: settings.maxBookingHorizonDays,
        slotSuggestionCount: settings.slotSuggestionCount,
        rosskoSearchEnabled: settings.rosskoSearchEnabled,
        rosskoOrderApprovalRequired: settings.rosskoOrderApprovalRequired,
        internetSearchEnabled: settings.internetSearchEnabled,
        handoffRules: settings.handoffRules,
      };
      const response = await fetch("/api/ai-agent/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = (await response.json().catch(() => null)) as SettingsResponse | null;
      if (!response.ok || !data?.settings) throw new Error(data?.error || "Настройки не сохранились");
      setSettings(data.settings);
      setNotice({ tone: "success", text: "Настройки ИИ-помощника сохранены." });
    } catch (error) {
      setNotice({ tone: "danger", text: error instanceof Error ? error.message : "Настройки не сохранились" });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <main className="eco-page eco-agent-settings"><div className="eco-agent-settings__loading"><LoaderCircle className="is-spin" size={20} /> Загружаем настройки…</div></main>;
  }

  if (!settings) {
    return <main className="eco-page eco-agent-settings"><div className="eco-agent-settings__error"><CircleAlert size={18} /><span><strong>Настройки недоступны</strong><small>{notice?.text || "Проверьте подключение к базе данных."}</small></span></div></main>;
  }

  const modeTitle = modeOptions.find((item) => item.id === settings.mode)?.title ?? "Черновики";
  const integrationsReady = [environment?.openaiConfigured, environment?.bookingConfigured, environment?.rosskoConfigured].filter(Boolean).length;

  let content: ReactNode;
  if (tab === "general") {
    content = (
      <div className="eco-agent-settings__content">
        <EcoCard padded={false}>
          <SectionHead title="Основной режим" body="Начните с черновиков, проверьте ответы на реальных диалогах и только затем включайте автоматическую отправку." />
          <div className="eco-agent-settings__body">
            <Switch checked={settings.enabled && settings.mode !== "off"} onChange={(enabled) => patch({ enabled, mode: enabled && settings.mode === "off" ? "suggestions" : settings.mode })} title="ИИ-помощник включён" hint="Новые входящие сообщения будут попадать в безопасный сценарий обработки." />
            <div className="eco-agent-mode-list">
              {modeOptions.map((option) => (
                <label key={option.id} className={settings.mode === option.id ? "is-selected" : ""}>
                  <input type="radio" name="agentMode" value={option.id} checked={settings.mode === option.id} onChange={() => patch({ mode: option.id, enabled: option.id !== "off" })} />
                  <span><strong>{option.title}</strong><small>{option.body}</small></span>
                  {settings.mode === option.id && <Check size={16} />}
                </label>
              ))}
            </div>
          </div>
        </EcoCard>

        <EcoCard padded={false}>
          <SectionHead title="Имя и темп общения" body="Клиент видит только обычный ответ — без внутренних названий систем и служебных данных." />
          <div className="eco-agent-settings__body eco-agent-settings__grid">
            <label className="eco-agent-field"><span>Имя помощника</span><EcoInput value={settings.agentName} maxLength={80} onChange={(event) => patch({ agentName: event.target.value })} /><small>Используется в подписи и рабочей панели.</small></label>
            <label className="eco-agent-field"><span>Стиль ответа</span><EcoSelect value={settings.tone} onChange={(event) => patch({ tone: event.target.value })}><option value="friendly_brief">Дружелюбно и кратко</option><option value="formal_brief">Сдержанно и по делу</option></EcoSelect><small>Без длинных анкет и технического жаргона.</small></label>
            <NumberField label="Пауза перед ответом" hint="Небольшая пауза делает диалог естественнее." value={settings.responseDelaySeconds} onChange={(responseDelaySeconds) => patch({ responseDelaySeconds })} min={0} max={300} suffix="сек" />
            <NumberField label="Лимит шагов на запрос" hint="Защищает от слишком длинной цепочки проверок." value={settings.maxTurns} onChange={(maxTurns) => patch({ maxTurns })} min={3} max={30} />
          </div>
        </EcoCard>

        <EcoCard padded={false}>
          <SectionHead title="Готовность подключений" body="Секретные ключи хранятся только на сервере и никогда не показываются сотруднику или клиенту." />
          <div className="eco-agent-settings__body eco-agent-integrations">
            <IntegrationStatus ok={Boolean(environment?.openaiConfigured)} title="OpenAI · GPT-5.6 Terra" body="Ответы и инструменты агента готовы" />
            <IntegrationStatus ok={Boolean(environment?.bookingConfigured)} title="Эко-платформа · Запись" body="Расписание, услуги и мастера готовы" />
            <IntegrationStatus ok={Boolean(environment?.rosskoConfigured)} title="ROSSKO" body="Поиск наличия у поставщика готов" />
          </div>
        </EcoCard>
      </div>
    );
  } else if (tab === "prices") {
    content = (
      <div className="eco-agent-settings__content">
        <EcoCard padded={false}>
          <SectionHead title="Работы и доплаты" body="Агент не складывает суммы сам: каждый расчёт проходит через эти фиксированные правила и сохраняется в журнале." />
          <div className="eco-agent-settings__body eco-agent-settings__grid">
            <MoneyField label="Замена с маслом сервиса" cents={settings.calculationRules.serviceOilWorkCents} onChange={(value) => patchCalculation("serviceOilWorkCents", value)} />
            <MoneyField label="Замена с маслом клиента" cents={settings.calculationRules.clientOilWorkCents} onChange={(value) => patchCalculation("clientOilWorkCents", value)} />
            <MoneyField label="Фильтр клиента" cents={settings.calculationRules.clientFilterSurchargeCents} onChange={(value) => patchCalculation("clientFilterSurchargeCents", value)} />
            <MoneyField label="Снятие защиты" cents={settings.calculationRules.protectionRemovalCents} onChange={(value) => patchCalculation("protectionRemovalCents", value)} />
            <MoneyField label="Установка защиты" cents={settings.calculationRules.protectionInstallCents} onChange={(value) => patchCalculation("protectionInstallCents", value)} />
            <MoneyField label="Сложный доступ к фильтру" cents={settings.calculationRules.complexFilterSurchargeCents} onChange={(value) => patchCalculation("complexFilterSurchargeCents", value)} />
            <MoneyField label="Картриджный фильтр" cents={settings.calculationRules.cartridgeSurchargeCents} onChange={(value) => patchCalculation("cartridgeSurchargeCents", value)} />
            <MoneyField label="Доплата за большой объём" cents={settings.calculationRules.excessVolumeSurchargeCents} onChange={(value) => patchCalculation("excessVolumeSurchargeCents", value)} />
            <MoneyField label="Шайба" cents={settings.calculationRules.washerCents} onChange={(value) => patchCalculation("washerCents", value)} />
            <MoneyField label="Сливная пробка" cents={settings.calculationRules.drainPlugCents} onChange={(value) => patchCalculation("drainPlugCents", value)} />
            <MoneyField label="Экологический сбор" cents={settings.calculationRules.environmentalFeeCents} onChange={(value) => patchCalculation("environmentalFeeCents", value)} />
            <MoneyField label="Минимальный заказ" cents={settings.calculationRules.minimumOrderCents} onChange={(value) => patchCalculation("minimumOrderCents", value)} />
          </div>
        </EcoCard>

        <EcoCard padded={false}>
          <SectionHead title="Правила расчёта" body="Округление, срок действия предложения и норматив времени применяются одинаково во всех каналах." />
          <div className="eco-agent-settings__body">
            <Switch checked={settings.calculationRules.freeWorkWithServiceOil} onChange={(value) => patchCalculation("freeWorkWithServiceOil", value)} title="Работа бесплатна с маслом сервиса" hint="Стоимость работы не добавляется к варианту с маслом из локального каталога." />
            <div className="eco-agent-settings__grid">
              <NumberField label="Большой объём начинается с" value={settings.calculationRules.excessVolumeThresholdLiters} onChange={(value) => patchCalculation("excessVolumeThresholdLiters", value)} min={0} max={30} step={0.5} suffix="л" />
              <NumberField label="Округлять масло до" value={settings.calculationRules.literRoundingStep} onChange={(value) => patchCalculation("literRoundingStep", value)} min={0.1} max={10} step={0.1} suffix="л" />
              <NumberField label="Норматив записи" value={settings.calculationRules.serviceDurationMinutes} onChange={(value) => patchCalculation("serviceDurationMinutes", Math.round(value))} min={10} max={480} suffix="мин" />
              <NumberField label="Расчёт действует" value={settings.calculationRules.quoteValidityHours} onChange={(value) => patchCalculation("quoteValidityHours", Math.round(value))} min={1} max={168} suffix="ч" />
              <NumberField label="Коэффициент аппаратной замены" hint="Умножает полный объём трансмиссии для расчёта жидкости; значение можно настроить под филиал." value={settings.calculationRules.transmissionMachineExchangeMultiplier} onChange={(value) => patchCalculation("transmissionMachineExchangeMultiplier", value)} min={1} max={3} step={0.1} />
              <NumberField label="Минимальный объём трансмиссии" hint="Минимальный оплачиваемый объём жидкости при замене." value={settings.calculationRules.transmissionMinimumBillableLiters} onChange={(value) => patchCalculation("transmissionMinimumBillableLiters", value)} min={0} max={200} step={0.5} suffix="л" />
              <NumberField label="Дополнительных техпроверок" hint="Не более двух; после лимита помощник возвращает честный предварительный результат." value={settings.calculationRules.maxTechnicalVerificationPasses} onChange={(value) => patchCalculation("maxTechnicalVerificationPasses", Math.round(value))} min={0} max={2} />
            </div>
            <p className="eco-agent-settings__note">Фильтр трансмиссии, требующий разборки агрегата, в услугу ТГМ и смету не включается.</p>
          </div>
        </EcoCard>

        <EcoCard padded={false}>
          <SectionHead title="ROSSKO: розничная цена" body="Наценка применяется только к предложениям под заказ. Закупочная цена остаётся внутренней и не показывается клиенту." />
          <div className="eco-agent-settings__body eco-agent-settings__grid">
            {settings.rosskoMarkupRules.map((rule, index) => (
              <div className="eco-agent-field" key={`${rule.fromCents}-${index}`}>
                <span>{rule.toCents == null ? `От ${Math.round(rule.fromCents / 100).toLocaleString("ru-RU")} ₽` : `${Math.round(rule.fromCents / 100).toLocaleString("ru-RU")}–${Math.round(rule.toCents / 100).toLocaleString("ru-RU")} ₽`}</span>
                <div><EcoInput type="number" min={0} max={300} value={rule.marginPercent} onChange={(event) => patchRosskoMarkup(index, { marginPercent: Math.max(0, Number(event.target.value) || 0) })} /><em>%</em></div>
                <small>Наценка для этой закупочной стоимости.</small>
              </div>
            ))}
          </div>
        </EcoCard>
      </div>
    );
  } else {
    content = (
      <div className="eco-agent-settings__content">
        <EcoCard padded={false}>
          <SectionHead title="Запись в сервис" body="Даже в автономном режиме запись создаётся только после явного согласия клиента с датой, временем, адресом и автомобилем." />
          <div className="eco-agent-settings__body">
            <Switch checked={settings.autoBookingEnabled} onChange={(autoBookingEnabled) => patch({ autoBookingEnabled })} title="Разрешить подготовку записи" hint="Помощник сможет получать реальные окна Эко-платформы и удерживать выбранное время." />
            <Switch checked={settings.bookingApprovalRequired} onChange={(bookingApprovalRequired) => patch({ bookingApprovalRequired })} title="Подтверждение сотрудником обязательно" hint="Рекомендуется оставить включённым до завершения пилотного периода." />
            <div className="eco-agent-settings__grid">
              <NumberField label="Удерживать окно" value={settings.slotHoldMinutes} onChange={(slotHoldMinutes) => patch({ slotHoldMinutes: Math.round(slotHoldMinutes) })} min={5} max={15} suffix="мин" />
              <NumberField label="Не записывать раньше чем через" value={settings.minBookingLeadMinutes} onChange={(minBookingLeadMinutes) => patch({ minBookingLeadMinutes: Math.round(minBookingLeadMinutes) })} min={0} max={10080} suffix="мин" />
              <NumberField label="Горизонт записи" value={settings.maxBookingHorizonDays} onChange={(maxBookingHorizonDays) => patch({ maxBookingHorizonDays: Math.round(maxBookingHorizonDays) })} min={1} max={180} suffix="дн" />
              <NumberField label="Предлагать вариантов" value={settings.slotSuggestionCount} onChange={(slotSuggestionCount) => patch({ slotSuggestionCount: Math.round(slotSuggestionCount) })} min={1} max={5} />
            </div>
          </div>
        </EcoCard>

        <EcoCard padded={false}>
          <SectionHead title="Когда звать сотрудника" body="Эти правила останавливают автоматический сценарий, если точность или характер запроса требуют человека." />
          <div className="eco-agent-settings__body">
            <div className="eco-agent-settings__grid">
              <NumberField label="Минимальная уверенность" value={Math.round(settings.handoffRules.lowConfidenceThreshold * 100)} onChange={(value) => patchHandoff("lowConfidenceThreshold", Math.max(0, Math.min(1, value / 100)))} min={0} max={100} suffix="%" />
              <MoneyField label="Передавать дорогие расчёты от" cents={settings.handoffRules.highAmountCents} onChange={(value) => patchHandoff("highAmountCents", value)} />
            </div>
            <Switch checked={settings.handoffRules.complaints} onChange={(value) => patchHandoff("complaints", value)} title="Жалобы и компенсации" hint="Сразу передавать сотруднику с краткой сводкой разговора." />
            <Switch checked={settings.handoffRules.ambiguousVehicle} onChange={(value) => patchHandoff("ambiguousVehicle", value)} title="Автомобиль определён неоднозначно" hint="Не выбирать модификацию и совместимость наугад." />
            <Switch checked={settings.handoffRules.conflictingTechnicalData} onChange={(value) => patchHandoff("conflictingTechnicalData", value)} title="Технические данные противоречат друг другу" hint="Не использовать спорные допуски, объёмы и применимость." />
            <Switch checked={settings.handoffRules.customerRequestsHuman} onChange={(value) => patchHandoff("customerRequestsHuman", value)} title="Клиент просит человека" hint="Немедленно остановить ответы агента в этом диалоге." />
          </div>
        </EcoCard>
      </div>
    );
  }

  return (
    <main className="eco-page eco-agent-settings">
      <section className="eco-page-head">
        <div>
          <div className="eco-page-crumbs"><Link href="/">Главная</Link><span className="sep">/</span><Link href="/cabinet">Кабинет</Link><span className="sep">/</span><span className="cur">ИИ-помощник</span></div>
          <div className="eco-title-row"><h1 className="eco-page-title">ИИ-помощник клиентам</h1><EcoBadge tone={settings.enabled ? "success" : "neutral"} dot>{settings.enabled ? "включён" : "выключен"}</EcoBadge></div>
          <p className="eco-page-subtitle">Переписка, проверяемый расчёт стоимости и запись в сервис под контролем сотрудника.</p>
        </div>
        <div className="eco-page-actions"><Link href="/messages" className="eco-btn eco-btn--ghost">Открыть диалоги</Link><EcoButton variant="primary" onClick={() => void save()} disabled={saving}><Save size={15} />{saving ? "Сохраняем…" : "Сохранить"}</EcoButton></div>
      </section>

      <div className="eco-grid eco-grid--kpi">
        <EcoKpi label="Режим" value={modeTitle} tone={settings.mode === "suggestions" || settings.mode === "off" ? "neutral" : "rust"} sub="Меняется без перезапуска приложения." />
        <EcoKpi label="Подключения" value={`${integrationsReady} из 3`} tone={integrationsReady === 3 ? "success" : "warning"} sub="OpenAI, собственная запись и поставщик." />
        <EcoKpi label="Запись" value={settings.autoBookingEnabled ? "Разрешена" : "Выключена"} tone={settings.autoBookingEnabled ? "success" : "neutral"} sub={settings.bookingApprovalRequired ? "С подтверждением сотрудника." : "По явному согласию клиента."} />
      </div>

      {notice && <div className={`eco-agent-settings__notice is-${notice.tone}`}>{notice.tone === "success" ? <Check size={15} /> : <CircleAlert size={15} />}{notice.text}</div>}

      <nav className="eco-agent-settings__tabs" aria-label="Разделы настроек">
        {tabs.map((item) => { const Icon = item.icon; return <button key={item.id} type="button" className={tab === item.id ? "is-active" : ""} onClick={() => setTab(item.id)}><Icon size={15} />{item.label}</button>; })}
      </nav>

      {content}

      <div className="eco-agent-settings__safety"><ShieldCheck size={17} /><span><strong>Безопасность по умолчанию</strong><small>Закупочные цены, ключи интеграций и внутренние комментарии не передаются клиенту. Все действия, расчёты и подтверждения записываются в журнал.</small></span></div>
    </main>
  );
}
