"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  BellRing,
  Bot,
  CheckCircle2,
  Clock3,
  Eye,
  FileText,
  History,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Send,
  SlidersHorizontal,
  TestTube2,
  ToggleLeft,
  ToggleRight,
  Variable,
} from "lucide-react";
import { EcoBadge, EcoButton, EcoCard, EcoInput, EcoKpi, EcoSelect, EcoTable } from "@/components/platform/EcoUI";
import { safeReadJson } from "@/lib/http-json";
import { formatServiceDateTime } from "@/lib/date-time";
import type { EcoBadgeTone } from "@/components/platform/EcoUI";

type EventDefinition = {
  type: string;
  title: string;
  description: string;
  defaultTiming: string;
  future?: boolean;
};

type NotificationTemplate = {
  id: string;
  name: string;
  eventType: string;
  channel: string;
  body: string;
  isActive: boolean;
  status: string;
  branchId: string | null;
  updatedAt: string;
};

type NotificationRule = {
  id: string;
  eventType: string;
  enabled: boolean;
  channel: string;
  templateId: string;
  timingType: string;
  offsetMinutes: number | null;
  conditionsJson: NotificationConditions;
  branchId: string | null;
  updatedAt: string;
};

type NotificationConditions = {
  requireTelegram?: boolean;
  requireConsent?: boolean;
  preventDuplicates?: boolean;
  skipCancelled?: boolean;
  doNotSendAtNight?: boolean;
  minNoticeMinutes?: number;
  timezone?: string;
  quietHours?: { from?: string; to?: string };
  arrivalStatuses?: string[];
};

type NotificationLog = {
  id: string;
  notificationJobId: string | null;
  eventType: string;
  channel: string;
  clientId: string | null;
  appointmentId: string | null;
  diagnosticReportId: string | null;
  templateId: string | null;
  status: string;
  renderedMessage: string | null;
  errorMessage: string | null;
  createdAt: string;
};

type NotificationJob = {
  id: string;
  eventType: string;
  status: string;
  conversationId: string | null;
  scheduledAt: string;
  errorMessage: string | null;
};

type VariableGroup = {
  title: string;
  variables: string[];
};

type SettingsPayload = {
  events: EventDefinition[];
  templates: NotificationTemplate[];
  rules: NotificationRule[];
  logs: NotificationLog[];
  jobs: NotificationJob[];
  variables: VariableGroup[];
  channel: {
    telegramConnected: boolean;
    connectionStatus: string;
    botName: string;
    webhookStatus: string;
    lastSuccessfulSendAt: string | null;
  };
  stats: Record<string, number>;
  statusLabels: Record<string, string>;
  error?: string;
};

type PreviewPayload = {
  ok?: boolean;
  preview?: {
    text: string;
    missingVariables: string[];
    unknownVariables: string[];
  };
  error?: string;
};

type ActionResult = {
  tone: EcoBadgeTone;
  title: string;
  message: string;
};

type TabKey = "auto" | "templates" | "channels" | "logs" | "variables";

const tabs: Array<{ key: TabKey; label: string; icon: typeof BellRing }> = [
  { key: "auto", label: "Автоматические уведомления", icon: BellRing },
  { key: "templates", label: "Шаблоны сообщений", icon: FileText },
  { key: "channels", label: "Каналы отправки", icon: Bot },
  { key: "logs", label: "Журнал отправок", icon: History },
  { key: "variables", label: "Переменные", icon: Variable },
];

function toneForStatus(status: string): EcoBadgeTone {
  if (["sent", "delivered"].includes(status)) return "success";
  if (["scheduled", "queued", "sending"].includes(status)) return "warning";
  if (["error", "template_error"].includes(status)) return "danger";
  if (["client_not_connected", "no_consent"].includes(status)) return "info";
  return "neutral";
}

function shortDate(value?: string | null) {
  if (!value) return "—";
  return formatServiceDateTime(value);
}

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function statusText(settings: SettingsPayload | null, status: string) {
  return settings?.statusLabels?.[status] ?? status;
}

export default function ClientNotificationsClient() {
  const [settings, setSettings] = useState<SettingsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>("auto");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [templateBody, setTemplateBody] = useState("");
  const [templateStatus, setTemplateStatus] = useState("active");
  const [templateActive, setTemplateActive] = useState(true);
  const [preview, setPreview] = useState<PreviewPayload["preview"] | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [logEvent, setLogEvent] = useState("all");
  const [logStatus, setLogStatus] = useState("all");
  const [testTemplateId, setTestTemplateId] = useState("");
  const [testClientId, setTestClientId] = useState("");
  const [testClientPhone, setTestClientPhone] = useState("");
  const [testTelegramId, setTestTelegramId] = useState("");
  const [newReminderMinutes, setNewReminderMinutes] = useState(180);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const selectedTemplate = useMemo(
    () => settings?.templates.find((template) => template.id === selectedTemplateId) ?? settings?.templates[0] ?? null,
    [selectedTemplateId, settings?.templates]
  );

  const testTemplate = settings?.templates.find((template) => template.id === testTemplateId) ?? selectedTemplate;

  const eventByType = useMemo(() => new Map((settings?.events ?? []).map((event) => [event.type, event])), [settings?.events]);
  const templateById = useMemo(() => new Map((settings?.templates ?? []).map((template) => [template.id, template])), [settings?.templates]);
  const jobsById = useMemo(() => new Map((settings?.jobs ?? []).map((job) => [job.id, job])), [settings?.jobs]);
  const rulesByEvent = useMemo(() => {
    const map = new Map<string, NotificationRule[]>();
    for (const rule of settings?.rules ?? []) {
      map.set(rule.eventType, [...(map.get(rule.eventType) ?? []), rule]);
    }
    return map;
  }, [settings?.rules]);

  const filteredLogs = useMemo(() => {
    return (settings?.logs ?? []).filter((log) => {
      if (logEvent !== "all" && log.eventType !== logEvent) return false;
      if (logStatus !== "all" && log.status !== logStatus) return false;
      return true;
    });
  }, [logEvent, logStatus, settings?.logs]);

  async function loadSettings(showResult = false) {
    setLoading(true);
    try {
      const response = await fetch("/api/client-notifications", { cache: "no-store" });
      const data = await safeReadJson<SettingsPayload>(response);
      if (!response.ok || !data) throw new Error(data?.error ?? "Не удалось загрузить настройки");
      setSettings(data);
      const firstTemplate = data.templates.find((template) => template.id === selectedTemplateId) ?? data.templates[0] ?? null;
      if (firstTemplate) {
        setSelectedTemplateId(firstTemplate.id);
        setTestTemplateId((current) => current || firstTemplate.id);
      }
      if (showResult) setResult({ tone: "success", title: "Обновлено", message: "Настройки уведомлений загружены." });
    } catch (error) {
      setResult({ tone: "danger", title: "Уведомления", message: error instanceof Error ? error.message : "Не удалось загрузить настройки." });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedTemplate) return;
    setTemplateName(selectedTemplate.name);
    setTemplateBody(selectedTemplate.body);
    setTemplateStatus(selectedTemplate.status);
    setTemplateActive(selectedTemplate.isActive);
    setPreview(null);
  }, [selectedTemplate]);

  async function patchRule(rule: NotificationRule, patch: Partial<NotificationRule> & { conditionsJson?: NotificationConditions }) {
    setSaving(rule.id);
    setResult(null);
    try {
      const response = await fetch("/api/client-notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "rule",
          id: rule.id,
          enabled: patch.enabled,
          templateId: patch.templateId,
          timingType: patch.timingType,
          offsetMinutes: Object.prototype.hasOwnProperty.call(patch, "offsetMinutes") ? patch.offsetMinutes : undefined,
          conditions: patch.conditionsJson,
        }),
      });
      const data = await safeReadJson<{ error?: string }>(response);
      if (!response.ok) throw new Error(data?.error ?? "Правило не сохранено");
      await loadSettings();
      setResult({ tone: "success", title: "Правило", message: "Настройка события сохранена." });
    } catch (error) {
      setResult({ tone: "danger", title: "Правило", message: error instanceof Error ? error.message : "Не удалось сохранить правило." });
    } finally {
      setSaving(null);
    }
  }

  async function saveTemplate() {
    if (!selectedTemplate) return;
    setSaving(selectedTemplate.id);
    setResult(null);
    try {
      const response = await fetch("/api/client-notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "template",
          id: selectedTemplate.id,
          name: templateName,
          body: templateBody,
          status: templateStatus,
          isActive: templateActive,
        }),
      });
      const data = await safeReadJson<{ error?: string }>(response);
      if (!response.ok) throw new Error(data?.error ?? "Шаблон не сохранён");
      await loadSettings();
      setResult({ tone: "success", title: "Шаблон", message: "Текст шаблона сохранён." });
    } catch (error) {
      setResult({ tone: "danger", title: "Шаблон", message: error instanceof Error ? error.message : "Не удалось сохранить шаблон." });
    } finally {
      setSaving(null);
    }
  }

  async function loadPreview() {
    setSaving("preview");
    try {
      const response = await fetch("/api/client-notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "preview", body: templateBody }),
      });
      const data = await safeReadJson<PreviewPayload>(response);
      if (!response.ok || !data?.preview) throw new Error(data?.error ?? "Предпросмотр не готов");
      setPreview(data.preview);
    } catch (error) {
      setResult({ tone: "danger", title: "Предпросмотр", message: error instanceof Error ? error.message : "Не удалось собрать предпросмотр." });
    } finally {
      setSaving(null);
    }
  }

  async function postAction(body: Record<string, unknown>, success: string) {
    setSaving(String(body.action ?? "action"));
    setResult(null);
    try {
      const response = await fetch("/api/client-notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await safeReadJson<{ error?: string }>(response);
      if (!response.ok) throw new Error(data?.error ?? "Команда не выполнена");
      await loadSettings();
      setResult({ tone: "success", title: "Уведомления", message: success });
    } catch (error) {
      setResult({ tone: "danger", title: "Уведомления", message: error instanceof Error ? error.message : "Команда не выполнена." });
    } finally {
      setSaving(null);
    }
  }

  function insertVariable(variable: string) {
    const token = `{${variable}}`;
    const el = textareaRef.current;
    if (!el) {
      setTemplateBody((current) => `${current}${token}`);
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    setTemplateBody((current) => `${current.slice(0, start)}${token}${current.slice(end)}`);
    window.setTimeout(() => {
      el.focus();
      el.selectionStart = start + token.length;
      el.selectionEnd = start + token.length;
    }, 0);
  }

  const enabledRules = settings?.rules.filter((rule) => rule.enabled).length ?? 0;
  const sentCount = settings?.stats.sent ?? 0;
  const errorCount = (settings?.stats.error ?? 0) + (settings?.stats.template_error ?? 0);
  const scheduledCount = (settings?.stats.scheduled ?? 0) + (settings?.stats.queued ?? 0);

  return (
    <main className="eco-page eco-page--wide eco-client-notifications-page">
      <section className="eco-page-head">
        <div>
          <div className="eco-page-crumbs">
            <Link href="/">Главная</Link>
            <span className="sep">/</span>
            <Link href="/cabinet">Кабинет</Link>
            <span className="sep">/</span>
            <span className="cur">Уведомления клиентам</span>
          </div>
          <div className="eco-title-row">
            <h1 className="eco-page-title">Уведомления клиентам</h1>
            <EcoBadge tone={settings?.channel.telegramConnected ? "success" : "warning"} dot>
              Telegram {settings?.channel.telegramConnected ? "подключён" : "требует внимания"}
            </EcoBadge>
          </div>
          <p className="eco-page-subtitle">Автоматические Telegram-сообщения по событиям записи, диагностики и визита.</p>
        </div>
        <div className="eco-page-actions">
          <EcoButton type="button" onClick={() => void postAction({ action: "process", limit: 30 }, "Очередь обработана.")} disabled={Boolean(saving)}>
            {saving === "process" ? <Loader2 size={15} className="eco-spin" /> : <Play size={15} />}
            Обработать очередь
          </EcoButton>
          <EcoButton type="button" onClick={() => void loadSettings(true)} disabled={loading}>
            {loading ? <Loader2 size={15} className="eco-spin" /> : <RefreshCw size={15} />}
            Обновить
          </EcoButton>
        </div>
      </section>

      <div className="eco-grid eco-grid--kpi">
        <EcoKpi label="Активные правила" value={enabledRules} tone="success" />
        <EcoKpi label="Запланировано" value={scheduledCount} tone="warning" />
        <EcoKpi label="Отправлено" value={sentCount} tone="info" />
        <EcoKpi label="Ошибки" value={errorCount} tone={errorCount ? "danger" : "neutral"} />
      </div>

      {result ? (
        <div className={cx("eco-notification-result", `eco-notification-result--${result.tone}`)}>
          <strong>{result.title}</strong>
          <span>{result.message}</span>
        </div>
      ) : null}

      <section className="eco-notification-tabs" aria-label="Разделы уведомлений">
        {tabs.map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.key} type="button" className={cx("eco-notification-tab", tab === item.key && "is-active")} onClick={() => setTab(item.key)}>
              <Icon size={16} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </section>

      {loading && !settings ? (
        <EcoCard className="eco-notification-loading">
          <Loader2 className="eco-spin" size={18} />
          <span>Загружаю настройки</span>
        </EcoCard>
      ) : null}

      {settings && tab === "auto" ? (
        <section className="eco-notification-layout">
          <div className="eco-notification-events">
            {settings.events.filter((event) => !event.future).map((event) => {
              const rules = rulesByEvent.get(event.type) ?? [];
              const primaryRule = rules[0] ?? null;
              return (
                <article key={event.type} className="eco-notification-event">
                  <div className="eco-notification-event__switch">
                    <button
                      type="button"
                      aria-label={primaryRule?.enabled ? "Выключить" : "Включить"}
                      onClick={() => primaryRule && void patchRule(primaryRule, { enabled: !primaryRule.enabled })}
                      disabled={!primaryRule || saving === primaryRule.id}
                    >
                      {primaryRule?.enabled ? <ToggleRight size={28} /> : <ToggleLeft size={28} />}
                    </button>
                  </div>
                  <div className="eco-notification-event__body">
                    <div className="eco-notification-event__head">
                      <div>
                        <strong>{event.title}</strong>
                        <p>{event.description}</p>
                      </div>
                      <EcoBadge tone={primaryRule?.enabled ? "success" : "neutral"}>{primaryRule?.enabled ? "включено" : "выключено"}</EcoBadge>
                    </div>
                    {rules.length ? (
                      <div className="eco-notification-rule-list">
                        {rules.map((rule) => {
                          const template = templateById.get(rule.templateId);
                          const conditions = rule.conditionsJson ?? {};
                          return (
                            <div key={rule.id} className="eco-notification-rule">
                              <div className="eco-notification-rule__meta">
                                <span>Канал: Telegram</span>
                                <span>Шаблон: {template?.name ?? "не выбран"}</span>
                                <span>Условие: {rule.timingType === "before_appointment" ? `за ${rule.offsetMinutes ?? 0} мин` : event.defaultTiming}</span>
                                <span>Изменено: {shortDate(rule.updatedAt)}</span>
                              </div>
                              <div className="eco-notification-rule__controls">
                                <EcoSelect value={rule.templateId} onChange={(evt) => void patchRule(rule, { templateId: evt.target.value })}>
                                  {settings.templates
                                    .filter((templateItem) => templateItem.eventType === rule.eventType || templateItem.channel === rule.channel)
                                    .map((templateItem) => (
                                      <option key={templateItem.id} value={templateItem.id}>
                                        {templateItem.name}
                                      </option>
                                    ))}
                                </EcoSelect>
                                {rule.timingType === "before_appointment" || event.type === "visit_completed" ? (
                                  <label className="eco-notification-inline-field">
                                    <Clock3 size={14} />
                                    <input
                                      type="number"
                                      min={1}
                                      defaultValue={rule.offsetMinutes ?? 30}
                                      onBlur={(evt) => void patchRule(rule, { offsetMinutes: Number(evt.target.value) })}
                                    />
                                    <span>мин</span>
                                  </label>
                                ) : null}
                                <button
                                  type="button"
                                  className={cx("eco-notification-check", conditions.requireTelegram && "is-on")}
                                  onClick={() => void patchRule(rule, { conditionsJson: { ...conditions, requireTelegram: !conditions.requireTelegram } })}
                                >
                                  Telegram
                                </button>
                                <button
                                  type="button"
                                  className={cx("eco-notification-check", conditions.preventDuplicates && "is-on")}
                                  onClick={() => void patchRule(rule, { conditionsJson: { ...conditions, preventDuplicates: !conditions.preventDuplicates } })}
                                >
                                  Без дублей
                                </button>
                                <button
                                  type="button"
                                  className={cx("eco-notification-check", conditions.doNotSendAtNight && "is-on")}
                                  onClick={() => void patchRule(rule, { conditionsJson: { ...conditions, doNotSendAtNight: !conditions.doNotSendAtNight } })}
                                >
                                  Не ночью
                                </button>
                              </div>
                              <div className="eco-notification-rule__actions">
                                <EcoButton type="button" size="sm" onClick={() => { setSelectedTemplateId(rule.templateId); setTab("templates"); }}>
                                  <SlidersHorizontal size={14} />
                                  Настроить
                                </EcoButton>
                                <EcoButton
                                  type="button"
                                  size="sm"
                                  onClick={() => {
                                    setTestTemplateId(rule.templateId);
                                    setTab("channels");
                                  }}
                                >
                                  <TestTube2 size={14} />
                                  Тест
                                </EcoButton>
                                <EcoButton type="button" size="sm" onClick={() => { setLogEvent(rule.eventType); setTab("logs"); }}>
                                  <History size={14} />
                                  Журнал
                                </EcoButton>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="eco-notification-muted">Правило пока не создано.</p>
                    )}
                  </div>
                </article>
              );
            })}
            <EcoCard className="eco-notification-reminder-add">
              <div>
                <strong>Дополнительное напоминание</strong>
                <span>Например, за 24 часа и за 3 часа до визита.</span>
              </div>
              <EcoInput type="number" min={1} value={newReminderMinutes} onChange={(event) => setNewReminderMinutes(Number(event.target.value))} />
              <EcoButton type="button" onClick={() => void postAction({ action: "create-reminder", offsetMinutes: newReminderMinutes }, "Напоминание добавлено.")}>
                <Plus size={15} />
                Добавить
              </EcoButton>
            </EcoCard>
          </div>
        </section>
      ) : null}

      {settings && tab === "templates" ? (
        <section className="eco-notification-template-layout">
          <EcoCard>
            <div className="eco-card__head">
              <div>
                <div className="eco-page-kicker">Шаблон</div>
                <h2 className="eco-stock-doc-title">Редактор сообщения</h2>
              </div>
              <EcoBadge tone={templateActive ? "success" : "neutral"}>{templateActive ? "активный" : "выключен"}</EcoBadge>
            </div>
            <div className="eco-notification-form-grid">
              <label>
                <span>Шаблон</span>
                <EcoSelect value={selectedTemplateId} onChange={(event) => setSelectedTemplateId(event.target.value)}>
                  {settings.templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </EcoSelect>
              </label>
              <label>
                <span>Название</span>
                <EcoInput value={templateName} onChange={(event) => setTemplateName(event.target.value)} />
              </label>
              <label>
                <span>Статус</span>
                <EcoSelect value={templateStatus} onChange={(event) => setTemplateStatus(event.target.value)}>
                  <option value="active">Активный</option>
                  <option value="draft">Черновик</option>
                </EcoSelect>
              </label>
            </div>
            <label className="eco-notification-template-editor">
              <span>Текст сообщения</span>
              <textarea ref={textareaRef} className="eco-input" value={templateBody} onChange={(event) => setTemplateBody(event.target.value)} rows={9} />
            </label>
            <div className="eco-notification-editor-actions">
              <label className="eco-notification-toggle">
                <input type="checkbox" checked={templateActive} onChange={(event) => setTemplateActive(event.target.checked)} />
                <span>Активен</span>
              </label>
              <EcoButton type="button" onClick={() => void loadPreview()} disabled={saving === "preview"}>
                {saving === "preview" ? <Loader2 size={15} className="eco-spin" /> : <Eye size={15} />}
                Предпросмотр
              </EcoButton>
              <EcoButton type="button" variant="primary" onClick={() => void saveTemplate()} disabled={saving === selectedTemplate?.id}>
                {saving === selectedTemplate?.id ? <Loader2 size={15} className="eco-spin" /> : <CheckCircle2 size={15} />}
                Сохранить
              </EcoButton>
            </div>
            {preview ? (
              <div className="eco-notification-preview">
                <strong>Предпросмотр</strong>
                <pre>{preview.text}</pre>
                {preview.unknownVariables.length ? <EcoBadge tone="danger">Неизвестно: {preview.unknownVariables.join(", ")}</EcoBadge> : null}
                {preview.missingVariables.length ? <EcoBadge tone="warning">Пусто: {preview.missingVariables.join(", ")}</EcoBadge> : null}
              </div>
            ) : null}
          </EcoCard>

          <EcoCard>
            <div className="eco-card__head">
              <div>
                <div className="eco-page-kicker">Переменные</div>
                <h2 className="eco-stock-doc-title">Вставка в текст</h2>
              </div>
            </div>
            <div className="eco-notification-variable-panel">
              {settings.variables.map((group) => (
                <div key={group.title}>
                  <strong>{group.title}</strong>
                  <div>
                    {group.variables.map((variable) => (
                      <button key={variable} type="button" onClick={() => insertVariable(variable)}>
                        {"{"}{variable}{"}"}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </EcoCard>
        </section>
      ) : null}

      {settings && tab === "channels" ? (
        <section className="eco-notification-channel-layout">
          <EcoCard>
            <div className="eco-card__head">
              <div>
                <div className="eco-page-kicker">Telegram</div>
                <h2 className="eco-stock-doc-title">Канал отправки</h2>
              </div>
              <EcoBadge tone={settings.channel.telegramConnected ? "success" : "warning"} dot>
                {settings.channel.connectionStatus}
              </EcoBadge>
            </div>
            <div className="eco-notification-channel-grid">
              <EcoKpi label="Бот / аккаунт" value={settings.channel.botName} tone="info" />
              <EcoKpi label="Webhook" value={settings.channel.webhookStatus} tone={settings.channel.telegramConnected ? "success" : "warning"} />
              <EcoKpi label="Последняя отправка" value={settings.channel.lastSuccessfulSendAt ? shortDate(settings.channel.lastSuccessfulSendAt) : "—"} tone="neutral" />
            </div>
            <div className="eco-notification-test">
              <div className="eco-card__head--plain">
                <div>
                  <h2>Тестовая отправка</h2>
                  <p>Шаблон будет отправлен через обычную очередь уведомлений.</p>
                </div>
                <Send size={20} />
              </div>
              <div className="eco-notification-form-grid">
                <label>
                  <span>Шаблон</span>
                  <EcoSelect value={testTemplate?.id ?? ""} onChange={(event) => setTestTemplateId(event.target.value)}>
                    {settings.templates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name}
                      </option>
                    ))}
                  </EcoSelect>
                </label>
                <label>
                  <span>Клиент ID</span>
                  <EcoInput value={testClientId} onChange={(event) => setTestClientId(event.target.value)} placeholder="local counterparty id" />
                </label>
                <label>
                  <span>Телефон</span>
                  <EcoInput value={testClientPhone} onChange={(event) => setTestClientPhone(event.target.value)} placeholder="+7..." />
                </label>
                <label>
                  <span>Telegram ID</span>
                  <EcoInput value={testTelegramId} onChange={(event) => setTestTelegramId(event.target.value)} placeholder="telegram:123..." />
                </label>
              </div>
              <EcoButton
                type="button"
                variant="primary"
                onClick={() =>
                  void postAction(
                    {
                      action: "test",
                      templateId: testTemplate?.id,
                      clientId: testClientId,
                      clientPhone: testClientPhone,
                      telegramId: testTelegramId,
                    },
                    "Тестовая отправка поставлена в журнал."
                  )
                }
                disabled={!testTemplate?.id || Boolean(saving)}
              >
                {saving === "test" ? <Loader2 size={15} className="eco-spin" /> : <Send size={15} />}
                Отправить тест
              </EcoButton>
            </div>
          </EcoCard>

          <EcoCard>
            <div className="eco-card__head">
              <div>
                <div className="eco-page-kicker">Следующие каналы</div>
                <h2 className="eco-stock-doc-title">Расширение</h2>
              </div>
            </div>
            <div className="eco-notification-planned-channels">
              {["WhatsApp", "SMS", "Email", "Push"].map((channel) => (
                <span key={channel}>{channel}</span>
              ))}
            </div>
          </EcoCard>
        </section>
      ) : null}

      {settings && tab === "logs" ? (
        <EcoCard>
          <div className="eco-card__head">
            <div>
              <div className="eco-page-kicker">Журнал</div>
              <h2 className="eco-stock-doc-title">Последние отправки</h2>
            </div>
          </div>
          <div className="eco-notification-log-filters">
            <EcoSelect value={logEvent} onChange={(event) => setLogEvent(event.target.value)}>
              <option value="all">Все события</option>
              {settings.events.map((event) => (
                <option key={event.type} value={event.type}>
                  {event.title}
                </option>
              ))}
            </EcoSelect>
            <EcoSelect value={logStatus} onChange={(event) => setLogStatus(event.target.value)}>
              <option value="all">Все статусы</option>
              {Object.entries(settings.statusLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </EcoSelect>
          </div>
          <EcoTable>
            <thead>
              <tr>
                <th>Дата</th>
                <th>Событие</th>
                <th>Клиент</th>
                <th>Запись</th>
                <th>Канал</th>
                <th>Шаблон</th>
                <th>Статус</th>
                <th>Ошибка</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {filteredLogs.map((log) => {
                const job = log.notificationJobId ? jobsById.get(log.notificationJobId) : null;
                return (
                  <tr key={log.id}>
                    <td>{shortDate(log.createdAt)}</td>
                    <td>{eventByType.get(log.eventType)?.title ?? log.eventType}</td>
                    <td>{log.clientId ?? "—"}</td>
                    <td>{log.appointmentId ?? log.diagnosticReportId ?? "—"}</td>
                    <td>{log.channel}</td>
                    <td>{log.templateId ? templateById.get(log.templateId)?.name ?? log.templateId : "—"}</td>
                    <td><EcoBadge tone={toneForStatus(log.status)}>{statusText(settings, log.status)}</EcoBadge></td>
                    <td>{log.errorMessage ?? "—"}</td>
                    <td>
                      <div className="eco-notification-row-actions">
                        {log.notificationJobId ? (
                          <button type="button" onClick={() => void postAction({ action: "retry", id: log.notificationJobId }, "Повторная отправка запущена.")}>
                            Повторить
                          </button>
                        ) : null}
                        {job?.conversationId ? <Link href={`/messages?conversationId=${encodeURIComponent(job.conversationId)}`}>Переписка</Link> : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={9}>Записей журнала пока нет.</td>
                </tr>
              ) : null}
            </tbody>
          </EcoTable>
        </EcoCard>
      ) : null}

      {settings && tab === "variables" ? (
        <section className="eco-notification-variable-docs">
          {settings.variables.map((group) => (
            <EcoCard key={group.title}>
              <div className="eco-card__head">
                <div>
                  <div className="eco-page-kicker">Группа</div>
                  <h2 className="eco-stock-doc-title">{group.title}</h2>
                </div>
              </div>
              <div className="eco-notification-variable-grid">
                {group.variables.map((variable) => (
                  <code key={variable}>{"{"}{variable}{"}"}</code>
                ))}
              </div>
            </EcoCard>
          ))}
        </section>
      ) : null}
    </main>
  );
}
