"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  MessageCircle,
  Phone,
  Send,
  Settings,
  X,
} from "lucide-react";
import type { ContactActionContext, ContactEntityType } from "@/lib/messenger/messenger-contact-actions";

type ContactTemplate = {
  key: string;
  label: string;
};

type ContactStatus = {
  hasPhone: boolean;
  phone: string | null;
  phoneNormalized: string | null;
  displayName: string;
  telegramConnected: boolean;
  telegramLinked: boolean;
  canMessage: boolean;
  canOpenConversation: boolean;
  lastConversationId: string | null;
  conversationUrl: string | null;
  reasonIfUnavailable: string | null;
  templates: ContactTemplate[];
};

type ContactActionButtonProps = {
  entityType?: ContactEntityType | string | null;
  entityId?: string | null;
  counterpartyId?: string | null;
  clientId?: string | null;
  supplierId?: string | null;
  phone?: string | null;
  displayName?: string | null;
  preferredChannel?: "telegram" | string | null;
  context?: ContactActionContext | null;
  variant?: "button" | "icon" | "link";
  size?: "sm" | "md";
  label?: string;
  className?: string;
};

type ApiResult = {
  ok?: boolean;
  status?: ContactStatus;
  conversationId?: string;
  conversationUrl?: string;
  error?: string;
  code?: string;
};

type ContactPayload = {
  entityType: ContactEntityType | string | null;
  entityId: string | null;
  counterpartyId: string | null;
  clientId: string | null;
  supplierId: string | null;
  phone: string | null;
  displayName: string | null;
  preferredChannel: "telegram" | string | null;
  context: ContactActionContext | null;
};

const localTemplates: ContactTemplate[] = [
  { key: "greeting", label: "Приветствие" },
  { key: "appointment_confirm", label: "Подтвердить запись" },
  { key: "appointment_reminder", label: "Напомнить о записи" },
  { key: "shipment_estimate", label: "Готов расчёт" },
  { key: "precheck_link", label: "Предчек" },
  { key: "diagnostic_report", label: "Диагностика" },
  { key: "vehicle_ready", label: "Автомобиль готов" },
];

function statusUrl(payload: ContactPayload, counterpartyId?: string | null) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(payload)) {
    if (key === "context" || value === null || value === undefined || typeof value === "object") continue;
    params.set(key, String(value));
  }
  if (counterpartyId) return `/api/messenger/contact/${encodeURIComponent(counterpartyId)}/status?${params.toString()}`;
  return `/api/messenger/contact/resolve?${params.toString()}`;
}

function renderLocalTemplate(templateKey: string, displayName?: string | null, context?: ContactActionContext | null) {
  const name = displayName?.trim() || "клиент";
  const car = context?.car?.trim() || "";
  const date = context?.date || "{дата}";
  const time = context?.time || "{время}";
  const link = context?.link || "{ссылка}";
  const vehicleSuffix = car ? ` по автомобилю ${car}` : "";
  const templates: Record<string, string> = {
    greeting: `Здравствуйте, ${name}! Это "Там где масло".`,
    appointment_confirm: `Здравствуйте, ${name}! Подтвердите, пожалуйста, запись на ${date} в ${time}.`,
    appointment_reminder: `Здравствуйте, ${name}! Напоминаем, что вы записаны на ${date} в ${time}.`,
    shipment_estimate: `Здравствуйте, ${name}! Подготовили расчёт${vehicleSuffix}.`,
    precheck_link: `Здравствуйте, ${name}! Отправляем предчек${vehicleSuffix}: ${link}`,
    diagnostic_report: `Здравствуйте, ${name}! Отправляем отчёт диагностики${vehicleSuffix}: ${link}`,
    vehicle_ready: `Здравствуйте, ${name}! Автомобиль готов, можно забирать.`,
  };
  return templates[templateKey] ?? templates.greeting;
}

async function parseContactResponse(res: Response) {
  const data = (await res.json().catch(() => ({}))) as ApiResult;
  if (!res.ok || data.error) throw new Error(data.error || "Не удалось выполнить действие");
  return data;
}

export function ContactActionButton(props: ContactActionButtonProps) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<ContactStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [sending, setSending] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [text, setText] = useState("");

  const contactPayload = useMemo(
    (): ContactPayload => ({
      entityType: props.entityType ?? "counterparty",
      entityId: props.entityId ?? null,
      counterpartyId: props.counterpartyId ?? null,
      clientId: props.clientId ?? null,
      supplierId: props.supplierId ?? null,
      phone: props.phone ?? null,
      displayName: props.displayName ?? null,
      preferredChannel: props.preferredChannel ?? "telegram",
      context: props.context ?? null,
    }),
    [
      props.clientId,
      props.context,
      props.counterpartyId,
      props.displayName,
      props.entityId,
      props.entityType,
      props.phone,
      props.preferredChannel,
      props.supplierId,
    ]
  );
  const contactStatusUrl = useMemo(
    () => statusUrl(contactPayload, props.counterpartyId),
    [
      contactPayload,
      props.counterpartyId,
    ]
  );
  const templates = status?.templates?.length ? status.templates : localTemplates;
  const displayName = status?.displayName || props.displayName || "Клиент";
  const phone = status?.phone || props.phone || null;
  const buttonLabel = props.label || "Написать";
  const buttonClassName = [
    "eco-contact-action-button",
    props.variant === "icon" ? "is-icon" : "",
    props.variant === "link" ? "is-link" : "",
    props.size === "sm" ? "is-sm" : "",
    props.className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  const loadStatus = useCallback(async () => {
    setLoadingStatus(true);
    setError(null);
    try {
      const res = await fetch(contactStatusUrl, { cache: "no-store" });
      const data = await parseContactResponse(res);
      setStatus(data.status ?? null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Не удалось проверить Telegram");
    } finally {
      setLoadingStatus(false);
    }
  }, [contactStatusUrl]);

  useEffect(() => {
    if (open) void loadStatus();
  }, [loadStatus, open]);

  const openConversation = useCallback((url?: string | null) => {
    if (!url) return;
    window.location.href = url;
  }, []);

  const startConversation = useCallback(async (redirect = false) => {
    setStarting(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/messenger/conversations/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(contactPayload),
      });
      const data = await parseContactResponse(res);
      if (data.status) setStatus(data.status);
      const url = data.conversationUrl ?? data.status?.conversationUrl ?? null;
      setSuccess("Диалог готов");
      if (redirect) openConversation(url);
      return data;
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Не удалось открыть диалог");
      return null;
    } finally {
      setStarting(false);
    }
  }, [contactPayload, openConversation]);

  const sendMessage = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed) {
      setError("Введите текст сообщения");
      return;
    }
    setSending(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/messenger/messages/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...contactPayload,
          conversationId: status?.lastConversationId ?? null,
          text: trimmed,
          templateKey: selectedTemplate,
        }),
      });
      const data = await parseContactResponse(res);
      setSuccess("Сообщение отправлено");
      setText("");
      setSelectedTemplate(null);
      if (data.conversationUrl) setStatus((current) => current ? { ...current, conversationUrl: data.conversationUrl ?? current.conversationUrl, lastConversationId: data.conversationId ?? current.lastConversationId, canOpenConversation: true, telegramLinked: true } : current);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Не удалось отправить сообщение");
    } finally {
      setSending(false);
    }
  }, [contactPayload, selectedTemplate, status?.lastConversationId, text]);

  const chooseTemplate = useCallback((key: string) => {
    setSelectedTemplate(key);
    setText(renderLocalTemplate(key, props.displayName, props.context));
  }, [props.context, props.displayName]);

  const copyPhone = useCallback(() => {
    if (!phone || typeof navigator === "undefined") return;
    void navigator.clipboard?.writeText(phone).then(() => setSuccess("Телефон скопирован"));
  }, [phone]);

  const statusNotice = useMemo(() => {
    if (!status) return null;
    if (!status.telegramConnected) return "Telegram User Session не подключён";
    if (!status.hasPhone && !status.telegramLinked) return "У контакта нет телефона";
    if (!status.telegramLinked) return "Контакт ещё не связан с Telegram";
    return "Telegram связан";
  }, [status]);

  return (
    <>
      <button className={buttonClassName} type="button" onClick={() => setOpen(true)} title="Написать в Telegram">
        <MessageCircle size={props.variant === "icon" ? 16 : 15} aria-hidden="true" />
        {props.variant !== "icon" ? <span>{buttonLabel}</span> : null}
      </button>

      {open ? (
        <div className="eco-contact-action-backdrop" role="dialog" aria-modal="true">
          <div className="eco-contact-action-panel">
            <header>
              <div>
                <p>Написать клиенту</p>
                <h3>{displayName}</h3>
                <span>{phone || "Телефон не указан"}</span>
              </div>
              <button type="button" className="eco-contact-action-icon" onClick={() => setOpen(false)} title="Закрыть">
                <X size={18} aria-hidden="true" />
              </button>
            </header>

            <section className="eco-contact-action-status">
              {loadingStatus ? <Loader2 size={16} className="is-spin" aria-hidden="true" /> : status?.telegramLinked ? <CheckCircle2 size={16} aria-hidden="true" /> : <AlertCircle size={16} aria-hidden="true" />}
              <span>{loadingStatus ? "Проверяем Telegram..." : statusNotice || "Статус Telegram"}</span>
            </section>

            {error ? <div className="eco-contact-action-alert is-error">{error}</div> : null}
            {success ? <div className="eco-contact-action-alert is-success">{success}</div> : null}

            {status && !status.telegramConnected ? (
              <a className="eco-contact-action-wide" href="/cabinet/integrations/messenger">
                <Settings size={16} aria-hidden="true" />
                <span>Подключить Telegram</span>
              </a>
            ) : null}

            <div className="eco-contact-action-grid">
              <button type="button" onClick={() => void startConversation(true)} disabled={starting || loadingStatus || Boolean(status && !status.canMessage)}>
                {starting ? <Loader2 size={15} className="is-spin" aria-hidden="true" /> : <ExternalLink size={15} aria-hidden="true" />}
                <span>{status?.canOpenConversation ? "Открыть чат" : "Создать чат"}</span>
              </button>
              <button type="button" onClick={copyPhone} disabled={!phone}>
                <Copy size={15} aria-hidden="true" />
                <span>Скопировать</span>
              </button>
              <a href={phone ? `tel:${phone}` : undefined} aria-disabled={!phone}>
                <Phone size={15} aria-hidden="true" />
                <span>Позвонить</span>
              </a>
            </div>

            <div className="eco-contact-action-templates">
              {templates.map((template) => (
                <button
                  key={template.key}
                  type="button"
                  className={selectedTemplate === template.key ? "is-active" : ""}
                  onClick={() => chooseTemplate(template.key)}
                >
                  {template.label}
                </button>
              ))}
            </div>

            <label className="eco-contact-action-message">
              <span>Сообщение</span>
              <textarea value={text} onChange={(event) => setText(event.target.value)} rows={5} />
            </label>

            <footer>
              {status?.conversationUrl ? (
                <button type="button" className="is-secondary" onClick={() => openConversation(status.conversationUrl)}>
                  <ExternalLink size={15} aria-hidden="true" />
                  <span>Полный чат</span>
                </button>
              ) : null}
              <button type="button" className="is-primary" onClick={() => void sendMessage()} disabled={sending || loadingStatus || Boolean(status && !status.canMessage)}>
                {sending ? <Loader2 size={15} className="is-spin" aria-hidden="true" /> : <Send size={15} aria-hidden="true" />}
                <span>Отправить</span>
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </>
  );
}
