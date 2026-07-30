"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeft,
  AlertTriangle,
  BriefcaseBusiness,
  CalendarClock,
  Car,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Download,
  ExternalLink,
  Expand,
  FileAudio,
  FileText,
  FileVideo,
  ImageIcon,
  Link2,
  MessageCircle,
  Mic,
  MoreVertical,
  Package,
  Pause,
  Pin,
  Play,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldQuestion,
  Sparkles,
  Star,
  StickyNote,
  Truck,
  Unlink,
  UserCheck,
  UserPlus,
  UserSearch,
  Wrench,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useMessenger, type MessengerFilter } from "./MessengerProvider";
import {
  MESSENGER_DEV_TOOLS_ENABLED,
  attachmentActions,
  attachmentLabel,
  channelConfigs,
  connectionStatusLabel,
  formatMessageDay,
  formatMessengerTime,
  gatewayEndpoints,
  getInitials,
  messagePreviewText,
  quickReplyTemplates,
  safeMessageText,
  type Attachment,
  type Conversation,
  type Message,
  type MessengerClientContext,
  type MessengerClientSuggestion,
  type MessengerConversationContext,
  type MessengerChannel,
  type QuickReplyTemplate,
} from "./messenger-data";

type ApiChannel = {
  key: keyof typeof channelConfigs;
  label: string;
  enabled: boolean;
  connectionStatus: string;
  adapterStatus: "real" | "test" | "planned";
};

type TemplatesResponse = {
  templates?: QuickReplyTemplate[];
};

type AgentListActivity = {
  conversationId: string;
  runId: string;
  status: "queued" | "running" | "waiting_for_human" | "waiting_for_client" | "handed_off" | "failed";
  stageLabel: string | null;
  elapsedSeconds: number;
  stale: boolean;
  requiresHumanApproval: boolean;
};

type AgentListActivitiesResponse = { activities?: AgentListActivity[] };

type AgentRunActivityStatus = {
  status?: {
    state: string;
    currentRun: {
      id: string;
      status: string;
      stageLabel: string | null;
      elapsedSeconds: number;
      heartbeatSeconds: number;
      softExceeded: boolean;
      stale: boolean;
      completedStages: string[];
      lastToolName: string | null;
      lastToolStatus: string | null;
      events: Array<{ id: string; publicLabel: string | null }>;
    } | null;
  };
};

function runElapsed(seconds: number) {
  const value = Math.max(0, Math.floor(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

const filterOptions: Array<{ id: MessengerFilter; label: string }> = [
  { id: "all", label: "Все" },
  { id: "unread", label: "Непрочитанные" },
  { id: "important", label: "Важные" },
  { id: "clients", label: "Клиенты" },
  { id: "suppliers", label: "Поставщики" },
  { id: "employees", label: "Сотрудники" },
  { id: "withoutClient", label: "Без клиента" },
  { id: "openCases", label: "С открытыми делами" },
];

const statusLabels: Record<string, string> = {
  received: "получено",
  queued: "в очереди",
  sending: "отправляется",
  sent: "отправлено",
  delivered: "доставлено",
  read: "прочитано",
  failed: "ошибка",
  skipped: "пропущено",
};

function normalizeMessengerError(value?: string | null) {
  const text = safeMessageText(value ?? "").trim();
  if (!text) return "";
  if (/session is missing/i.test(text)) return "Telegram-сессия не найдена. Подключите Telegram заново.";
  if (/account is not connected/i.test(text)) return "Telegram-аккаунт не подключён.";
  if (/message_empty|message is empty/i.test(text)) return "Telegram отклонил пустое сообщение.";
  if (/input entity|chat id is missing|не нашёл .*диалог/i.test(text)) return "Telegram не нашёл диалог. Проверьте телефон клиента и повторите отправку.";
  return text.length > 180 ? `${text.slice(0, 177)}...` : text;
}

const channelFilterOptions: MessengerChannel[] = ["telegram", "whatsapp", "vk", "avito", "max", "sms"];

type ClientSearchResult = {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  companyType?: string;
  counterpartyTypeName?: string;
  archived?: boolean;
  vehicleLabel?: string;
  vehiclePlate?: string;
  vehicleVin?: string;
  demandCount?: number;
  lastDemandName?: string;
  lastDemandAt?: string;
  recentDemands?: Array<{ id: string; name: string; momentAt: string; sumCents: number; applicable: boolean }>;
};

type ClientSearchResponse = {
  counterparties?: ClientSearchResult[];
  clients?: MessengerClientSuggestion[];
  meta?: { total?: number };
  error?: string;
};

type ClientCreateForm = {
  companyType: "individual" | "entrepreneur" | "legal";
  name: string;
  phone: string;
  additionalPhone: string;
  email: string;
  comment: string;
  vehicleModel: string;
  vehiclePlate: string;
  vehicleVin: string;
  vehicleYear: string;
};

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function compactPhone(value?: string | null) {
  return (value ?? "").replace(/\D/g, "");
}

function clientTypeLabel(value?: string) {
  if (value === "individual") return "Физлицо";
  if (value === "entrepreneur") return "ИП";
  if (value === "supplier") return "Поставщик";
  return "Компания";
}

function clientCardHref(input: { id?: string; name?: string; phone?: string } | null | undefined) {
  if (input?.id) return `/clients/counterparties?counterparty=${encodeURIComponent(input.id)}`;
  const query = input?.name || input?.phone || "";
  return query ? `/clients/counterparties?search=${encodeURIComponent(query)}` : "/clients/counterparties";
}

function buildAppointmentHref(conversation: Conversation, context: MessengerClientContext | null) {
  if (context?.appointment?.id) return `/records?recordId=${encodeURIComponent(context.appointment.id)}`;
  const params = new URLSearchParams({ new: "1", crmDealId: conversation.caseId || `messenger-${conversation.id}` });
  params.set("source", `${channelConfigs[conversation.channel].label} / Messenger`);
  params.set("comment", [conversation.lastMessageText, `Диалог: ${conversation.id}`].filter(Boolean).join("\n"));
  const clientName = context?.name || conversation.participantName;
  const phone = context?.phone || conversation.participantPhone || "";
  const vehicle = context?.vehicle?.label || conversation.title || "";
  if (clientName) params.set("client", clientName);
  if (phone) params.set("phone", phone);
  if (vehicle) params.set("vehicle", vehicle);
  if (conversation.assignedTo) params.set("responsible", conversation.assignedTo);
  return `/records?${params.toString()}`;
}

function buildShipmentHref(conversation: Conversation, context: MessengerClientContext | null) {
  if (conversation.shipmentId) return `/shipment/${encodeURIComponent(conversation.shipmentId)}`;
  const params = new URLSearchParams();
  const clientName = context?.name || conversation.participantName;
  const phone = context?.phone || conversation.participantPhone || "";
  const vehicle = context?.vehicle?.label || conversation.title || "";
  if (clientName) params.set("counterparty", clientName);
  if (phone) params.set("phone", phone);
  if (vehicle) params.set("vehicle", vehicle);
  if (context?.vehicle?.plate) params.set("plate", context.vehicle.plate);
  if (context?.vehicle?.vin) params.set("vin", context.vehicle.vin);
  params.set("comment", [conversation.lastMessageText, `Источник: Messenger ${conversation.id}`].filter(Boolean).join("\n"));
  if (conversation.caseId) params.set("crmDealId", conversation.caseId);
  return `/shipment/new?${params.toString()}`;
}

function buildCaseHref(conversation: Conversation, context: MessengerClientContext | null) {
  const id = context?.activeCase?.id || conversation.caseId;
  return id ? `/crm?dealId=${encodeURIComponent(id)}` : "/crm";
}

function bestClientSearchSeed(conversation: Conversation) {
  return conversation.participantPhone || conversation.participantName || conversation.title || "";
}

function clientMatchReason(conversation: Conversation, client: ClientSearchResult) {
  const conversationPhone = compactPhone(conversation.participantPhone);
  const clientPhone = compactPhone(client.phone);
  if (conversation.clientId && conversation.clientId === client.id) return "Ранее привязан к Telegram";
  if (conversationPhone && clientPhone && clientPhone.endsWith(conversationPhone.slice(-10))) return "Совпал телефон";
  if (client.vehiclePlate || client.vehicleVin) return "Есть авто в истории клиента";
  return "Совпало имя, требуется проверка";
}

function suggestionToClientSearchResult(suggestion: MessengerClientSuggestion): ClientSearchResult {
  return {
    id: suggestion.id,
    name: suggestion.name,
    phone: suggestion.phone,
    companyType: suggestion.type === "Физлицо" ? "individual" : suggestion.type === "Поставщик" ? "supplier" : "legal",
    vehicleLabel: suggestion.vehicle?.label,
    vehiclePlate: suggestion.vehicle?.plate,
    vehicleVin: suggestion.vehicle?.vin,
  };
}

function emptyCreateClientForm(conversation: Conversation): ClientCreateForm {
  return {
    companyType: "individual",
    name: conversation.participantName || conversation.title || "",
    phone: conversation.participantPhone || "",
    additionalPhone: "",
    email: "",
    comment: `Клиент создан из диалога ${channelConfigs[conversation.channel].label}`,
    vehicleModel: "",
    vehiclePlate: "",
    vehicleVin: "",
    vehicleYear: "",
  };
}

function avatarStyle(seed: string, tint: string, color: string) {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) hash = (hash * 31 + seed.charCodeAt(index)) % 360;
  return {
    background: `linear-gradient(135deg, ${tint}, hsl(${hash} 82% 94%))`,
    color,
  };
}

function formatAttachmentSize(size?: number) {
  if (!size || size <= 0) return "";
  if (size < 1024) return `${size} Б`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} КБ`;
  return `${(size / 1024 / 1024).toFixed(size >= 10 * 1024 * 1024 ? 0 : 1)} МБ`;
}

function formatDuration(seconds?: number) {
  if (!seconds || seconds <= 0 || !Number.isFinite(seconds)) return "";
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function isAttachmentReady(attachment: Attachment) {
  return attachment.status === "available" || attachment.status === "ready" || Boolean(attachment.url || attachment.previewUrl);
}

function isAttachmentFailed(attachment: Attachment) {
  return attachment.status === "failed" || attachment.status === "too_large" || attachment.status === "unsupported";
}

function isPhotoAttachment(attachment: Attachment) {
  return ["photo", "image", "sticker", "animation"].includes(attachment.type);
}

function isVideoAttachment(attachment: Attachment) {
  return attachment.type === "video" || attachment.type === "video_note";
}

function isAudioAttachment(attachment: Attachment) {
  return attachment.type === "voice" || attachment.type === "audio";
}

function isTechnicalAttachmentName(value?: string) {
  return /^(attachment|photo|video|voice|audio|document)-telegram:message:/i.test(value ?? "") || /^voice[-_]\d/i.test(value ?? "");
}

function displayAttachmentName(attachment: Attachment) {
  if (attachment.type === "voice") return "Голосовое сообщение";
  if (attachment.name && !isTechnicalAttachmentName(attachment.name)) return attachment.name;
  if (attachment.type === "photo" || attachment.type === "image") return "Фото Telegram";
  if (attachment.type === "video") return "Видео Telegram";
  if (attachment.type === "audio") return "Аудио Telegram";
  if (attachment.type === "sticker") return "Стикер Telegram";
  if (attachment.type === "animation") return "GIF Telegram";
  if (attachment.type === "video_note") return "Видеосообщение Telegram";
  if (attachment.type === "document") return "Документ Telegram";
  return "Файл Telegram";
}

function attachmentMetaLine(attachment: Attachment) {
  return [formatAttachmentSize(attachment.size), formatDuration(attachment.duration), attachment.mimeType]
    .filter(Boolean)
    .join(" · ");
}

function audioMetaLine(attachment: Attachment) {
  return formatAttachmentSize(attachment.size) || (attachment.type === "voice" ? "Telegram voice" : "Аудио");
}

function autoNotificationParts(text: string) {
  const match = text.match(/^Автоуведомление\s*·\s*([^\n]+)\n+([\s\S]*)$/);
  if (!match) return null;
  return { event: match[1]?.trim() || "Событие", body: match[2]?.trim() || "" };
}

function pendingAttachmentText(attachment: Attachment) {
  if (attachment.status === "downloading" || attachment.status === "queued") {
    return attachment.progress && attachment.progress > 0 ? `Загружаем вложение · ${attachment.progress}%` : "Подготавливаем вложение...";
  }
  return `${attachmentLabel(attachment)} ожидает загрузки`;
}

function appointmentDateParts(value: string | undefined) {
  const text = value?.trim() ?? "";
  const time = text.match(/(?:^|\s)(\d{1,2}:\d{2})(?:\s|$)/)?.[1] ?? "{{time}}";
  const date = text.replace(time, "").trim() || "{{date}}";
  return { date, time };
}

function templateValueMap(conversation: Conversation, context: MessengerClientContext | null) {
  const appointment = appointmentDateParts(context?.appointment?.date);
  const diagnostic = context?.diagnostics.find((item) => item.publicReportUrl) ?? context?.diagnostics[0];
  const task = context?.tasks[0];
  return {
    clientName: context?.name || conversation.participantName,
    vehicleName: context?.vehicle?.label || conversation.title || "{{vehicleName}}",
    reportUrl: diagnostic?.publicReportUrl || "{{reportUrl}}",
    date: appointment.date,
    time: appointment.time,
    serviceName: context?.appointment?.service || "{{serviceName}}",
    summary: conversation.lastMessageText || "{{summary}}",
    amount: context?.shipments[0]?.amount?.replace(/[^\d.,]/g, "") || "{{amount}}",
    taskTitle: task?.title || "{{taskTitle}}",
    dueAt: context?.activeCase?.deadline || "{{dueAt}}",
    caseTitle: context?.activeCase?.title || conversation.title || "{{caseTitle}}",
  };
}

function renderTemplateText(template: QuickReplyTemplate, conversation: Conversation, context: MessengerClientContext | null) {
  const values = templateValueMap(conversation, context);
  return template.text.replace(/\{\{(\w+)\}\}/g, (match, key: string) => values[key as keyof typeof values] ?? match);
}

export function MessengerTopbarButton() {
  const { unreadTotal, openInbox } = useMessenger();
  return (
    <button
      type="button"
      className="platform-shell__icon-btn platform-shell__notification-btn eco-messenger-topbar"
      onClick={openInbox}
      aria-label="Сообщения"
    >
      <MessageCircle aria-hidden className="eco-icon" />
      {!!unreadTotal && <span>{unreadTotal > 99 ? "99+" : unreadTotal}</span>}
    </button>
  );
}

export function MessengerWidget() {
  const pathname = usePathname();
  const { widgetView, unreadTotal, openInbox, closeWidget, selectedConversation, toast, clearToast } = useMessenger();
  const hidden =
    pathname === "/login" ||
    pathname === "/client-site" ||
    pathname === "/messages" ||
    pathname === "/crm/messages" ||
    pathname.startsWith("/report/");
  if (hidden) return null;

  return (
    <>
      {toast && (
        <button type="button" className={cx("eco-messenger-toast", widgetView !== "collapsed" && "is-widget-open")} onClick={clearToast}>
          <span className="eco-messenger-toast__dot" />
          <span>
            <strong>Новое сообщение</strong>
            <small>{toast.text}</small>
          </span>
          <X aria-hidden className="eco-icon" />
        </button>
      )}

      <div className={cx("eco-messenger-widget", widgetView !== "collapsed" && "is-open")}>
        {widgetView === "collapsed" ? (
          <button type="button" className="eco-messenger-launcher" onClick={openInbox} aria-label="Открыть сообщения">
            <span className="eco-messenger-launcher__icon">
              <MessageCircle aria-hidden className="eco-icon" />
            </span>
            <span>Сообщения</span>
            {!!unreadTotal && <strong>{unreadTotal}</strong>}
            <ChevronDown aria-hidden className="eco-icon" />
          </button>
        ) : (
          <section className="eco-messenger-popover" aria-label="Сообщения">
            {widgetView === "inbox" && <MessengerInbox compact onClose={closeWidget} />}
            {widgetView === "chat" && selectedConversation && <MiniChat conversation={selectedConversation} onClose={closeWidget} />}
          </section>
        )}
      </div>
    </>
  );
}

export function MessengerInbox({
  compact = false,
  onClose,
  onSelect,
}: {
  compact?: boolean;
  onClose?: () => void;
  onSelect?: () => void;
}) {
  const {
    filteredConversations,
    selectedConversationId,
    selectConversation,
    filter,
    setFilter,
    channel,
    setChannel,
    search,
    setSearch,
    unreadTotal,
    loading,
    errorMode,
    simulateIncoming,
  } = useMessenger();
  return (
    <div className={cx("eco-messenger-inbox", compact && "is-compact")}>
      <div className="eco-messenger-panel-head eco-messenger-inbox__head">
        <div>
          <h2>{compact ? "Сообщения" : "Чаты"}</h2>
          <p>{filteredConversations.length ? `Диалогов: ${filteredConversations.length}` : "Единый центр"}</p>
        </div>
        <div className="eco-messenger-head-actions">
          {!!unreadTotal && <span className="eco-messenger-unread">{unreadTotal}</span>}
          {compact && (
            <Link href="/messages" className="eco-messenger-icon-btn" aria-label="Развернуть чат" title="Развернуть чат">
              <Expand aria-hidden className="eco-icon" />
            </Link>
          )}
          {compact && (
            <button type="button" className="eco-messenger-icon-btn" onClick={onClose} aria-label="Свернуть">
              <X aria-hidden className="eco-icon" />
            </button>
          )}
        </div>
      </div>

      <div className="eco-messenger-inbox__tools">
        <div className="eco-messenger-search eco-messenger-inbox__search">
          <Search aria-hidden className="eco-icon" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Поиск по чатам"
            aria-label="Поиск по имени, телефону, тексту, автомобилю или VIN"
          />
        </div>

        <label className="eco-messenger-channel-filter eco-messenger-inbox__channel">
          <span className="eco-messenger-visually-hidden">Канал</span>
          <span className="eco-messenger-select-wrap">
            <select
              value={channel}
              onChange={(event) => setChannel(event.target.value as typeof channel)}
              aria-label="Фильтр по каналу"
            >
              <option value="all">Все каналы</option>
              {channelFilterOptions.map((id) => {
                const item = channelConfigs[id];
                return (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                );
              })}
              {MESSENGER_DEV_TOOLS_ENABLED && (
                <option value="mock">{channelConfigs.mock.label}</option>
              )}
            </select>
            <ChevronDown aria-hidden className="eco-icon" />
          </span>
        </label>
      </div>

      <div className="eco-messenger-filters eco-messenger-inbox__tabs" aria-label="Фильтры сообщений">
        {filterOptions.slice(0, compact ? 6 : filterOptions.length).map((option) => (
          <button
            type="button"
            key={option.id}
            className={filter === option.id ? "is-active" : ""}
            onClick={() => setFilter(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {compact && MESSENGER_DEV_TOOLS_ENABLED && (
        <button type="button" className="eco-messenger-simulate" onClick={simulateIncoming}>
          <Sparkles aria-hidden className="eco-icon" />
          Mock-сообщение
        </button>
      )}

      <div className="eco-messenger-dialog-list eco-messenger-inbox__list">
        {loading && <MessengerState title="Загружаем диалоги" body="Получаем переписки через Messenger Gateway." />}
        {errorMode && !loading && <MessengerState danger title="Ошибка канала" body="Список недоступен, можно повторить позже." />}
        {!loading &&
          !errorMode &&
          filteredConversations.map((conversation) => (
            <ConversationListItem
              key={conversation.id}
              conversation={conversation}
              selected={conversation.id === selectedConversationId}
              onClick={() => {
                selectConversation(conversation.id, compact);
                onSelect?.();
              }}
            />
          ))}
        {!loading && !errorMode && filteredConversations.length === 0 && (
          <MessengerState title="Диалогов нет" body="Попробуйте другой фильтр или очистите поиск." />
        )}
      </div>
    </div>
  );
}

export function ConversationListItem({
  conversation,
  selected,
  onClick,
}: {
  conversation: Conversation;
  selected: boolean;
  onClick: () => void;
}) {
  const channel = channelConfigs[conversation.channel];
  const Icon = channel.Icon;
  const preview = messagePreviewText({ text: conversation.lastMessageText });

  return (
    <button type="button" className={cx("eco-messenger-dialog", selected && "is-selected")} onClick={onClick}>
      <MessengerAvatar conversation={conversation} />
      <span className="eco-messenger-dialog__body">
        <span className="eco-messenger-dialog__top">
          <strong>{conversation.participantName}</strong>
          <time>{formatMessengerTime(conversation.lastMessageAt)}</time>
        </span>
        <span className="eco-messenger-dialog__meta">
          <span className="eco-messenger-channel" style={{ color: channel.color }}>
            <Icon aria-hidden className="eco-icon" />
            {channel.label}
          </span>
          {conversation.clientId ? <span>клиент/авто</span> : <span>без клиента</span>}
          {conversation.hasOverdueCase && <span className="is-danger">просрочка</span>}
        </span>
        <span className="eco-messenger-dialog__text">{preview}</span>
        <span className="eco-messenger-dialog__tags">
          {conversation.isPinned && <Pin aria-hidden className="eco-icon" />}
          {conversation.isImportant && <Star aria-hidden className="eco-icon is-star" />}
          {conversation.tags.slice(0, 3).map((tag) => (
            <em key={tag}>{tag}</em>
          ))}
        </span>
      </span>
      {!!conversation.unreadCount && <span className="eco-messenger-unread">{conversation.unreadCount}</span>}
    </button>
  );
}

function MessengerAvatar({ conversation, compact = false }: { conversation: Conversation; compact?: boolean }) {
  const channel = channelConfigs[conversation.channel];
  const [failed, setFailed] = useState(false);
  const src = conversation.participantAvatar && !failed ? conversation.participantAvatar : "";
  return (
    <span
      className={cx("eco-messenger-avatar", compact && "is-compact", src && "has-image")}
      style={avatarStyle(`${conversation.id}:${conversation.participantName}`, channel.tint, channel.color)}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" onError={() => setFailed(true)} />
      ) : (
        getInitials(conversation.participantName)
      )}
    </span>
  );
}

function MiniChat({ conversation, onClose }: { conversation: Conversation; onClose: () => void }) {
  const { setWidgetView } = useMessenger();
  return (
    <div className="eco-messenger-mini-chat">
      <ChatHeader
        conversation={conversation}
        compact
        leftAction={
          <button type="button" className="eco-messenger-icon-btn" onClick={() => setWidgetView("inbox")} aria-label="Назад">
            <ArrowLeft aria-hidden className="eco-icon" />
          </button>
        }
        rightAction={
          <>
            <Link href="/messages" className="eco-messenger-icon-btn" aria-label="Открыть полный экран">
              <Expand aria-hidden className="eco-icon" />
            </Link>
            <button type="button" className="eco-messenger-icon-btn" aria-label="Действия">
              <MoreVertical aria-hidden className="eco-icon" />
            </button>
            <button type="button" className="eco-messenger-icon-btn" onClick={onClose} aria-label="Свернуть">
              <X aria-hidden className="eco-icon" />
            </button>
          </>
        }
      />
      <ChatThread conversation={conversation} compact />
      <MessengerComposer conversation={conversation} compact />
    </div>
  );
}

export function ChatHeader({
  conversation,
  compact = false,
  leftAction,
  rightAction,
}: {
  conversation: Conversation;
  compact?: boolean;
  leftAction?: React.ReactNode;
  rightAction?: React.ReactNode;
}) {
  const channel = channelConfigs[conversation.channel];
  const Icon = channel.Icon;
  const { channelStatuses, channelLabels } = useMessenger();
  const status = channelStatuses[conversation.channel] ?? channel.connectionStatus;
  const statusLabel = channelLabels[conversation.channel] ?? connectionStatusLabel(status);
  return (
    <div className={cx("eco-messenger-chat-head", compact && "is-compact")}>
      {leftAction}
      <MessengerAvatar conversation={conversation} compact={compact} />
      <div className="eco-messenger-chat-head__copy">
        <strong>{conversation.participantName}</strong>
        <span>
          <span className="eco-messenger-chat-head__channel">
            <Icon aria-hidden className="eco-icon" />
            {channel.label} · {statusLabel}
          </span>
        </span>
      </div>
      {!conversation.clientId && (
        <button type="button" className="eco-messenger-client-status" title="Привязать клиента">
          <span className="is-full">Клиент не привязан</span>
          <span className="is-short">Без клиента</span>
        </button>
      )}
      <div className="eco-messenger-chat-head__actions">{rightAction}</div>
    </div>
  );
}

/** Compact operational state in the thread itself, so an employee does not
 * have to infer a long-running calculation from a draft in the side panel. */
export function AIAgentRunActivity({ conversation }: { conversation: Conversation }) {
  const [status, setStatus] = useState<AgentRunActivityStatus["status"] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const response = await fetch(`/api/ai-agent/conversations/${encodeURIComponent(conversation.id)}/status`, { cache: "no-store" });
        const data = (await response.json()) as AgentRunActivityStatus;
        if (alive && response.ok) setStatus(data.status ?? null);
      } catch {
        // A missing status feed must never interrupt the messenger thread.
      }
    }
    void load();
    const timer = window.setInterval(() => void load(), 8_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [conversation.id]);
  const run = status?.currentRun;
  if (!run || !["queued", "running", "waiting_for_human"].includes(run.status)) return null;
  const event = run.events[0]?.publicLabel || run.stageLabel || "Подготавливаем следующий шаг";
  const step = Math.min(10, run.completedStages.length + (run.status === "waiting_for_human" ? 0 : 1));
  async function control(action: "takeover" | "stop") {
    setBusy(true);
    try {
      await fetch(`/api/ai-agent/conversations/${encodeURIComponent(conversation.id)}/control`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={cx("eco-messenger-agent-activity", run.stale && "is-stale", run.status === "waiting_for_human" && "is-waiting")} aria-live="polite">
      <div>
        <span>{run.status === "waiting_for_human" ? <CheckCircle2 aria-hidden className="eco-icon" /> : <Sparkles aria-hidden className="eco-icon" />}</span>
        <p><strong>{run.status === "waiting_for_human" ? "Расчёт готов — ждёт проверки сотрудника" : `ИИ-агент рассчитывает · ${runElapsed(run.elapsedSeconds)}`}</strong><small>Шаг {step || 1} из 10 · {run.stageLabel ?? "Разбираем запрос"} · {event}</small></p>
      </div>
      <div className="eco-messenger-agent-activity__actions">
        <details><summary>Детали</summary><span>Последняя активность: {event}</span></details>
        <button type="button" disabled={busy} onClick={() => void control("takeover")}>Перехватить</button>
        <button type="button" disabled={busy} onClick={() => void control("stop")}>Остановить</button>
      </div>
      {(run.stale || run.softExceeded) && <em><AlertTriangle aria-hidden className="eco-icon" /> {run.stale ? "Нет активности больше минуты: проверьте запуск или передайте сотруднику." : "Проверка идёт дольше обычного, результаты сохраняются."}</em>}
    </section>
  );
}

export function ChatThread({ conversation, compact = false }: { conversation: Conversation; compact?: boolean }) {
  const { messagesByConversation, retryMessage, retryAttachment } = useMessenger();
  const messages = messagesByConversation[conversation.id] ?? [];
  const threadRef = useRef<HTMLDivElement | null>(null);
  const rows = messages.map((message, index) => {
    const day = formatMessageDay(message.createdAt);
    const previous = index > 0 ? formatMessageDay(messages[index - 1].createdAt) : "";
    return { message, day, showDay: day !== previous };
  });

  useEffect(() => {
    const node = threadRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }, [conversation.id, messages.length]);

  if (messages.length === 0) {
    return <MessengerState title="Сообщений пока нет" body="История появится после первого ответа." />;
  }

  return (
    <div ref={threadRef} className={cx("eco-messenger-thread", compact && "is-compact")}>
      {rows.map(({ message, day, showDay }) => (
        <div key={message.id} className="eco-messenger-message-wrap">
          {showDay && <div className="eco-messenger-day">{day}</div>}
          <MessageBubble
            message={message}
            onRetry={() => retryMessage(conversation.id, message.id)}
            onAttachmentRetry={(attachmentId) => retryAttachment(conversation.id, attachmentId)}
          />
        </div>
      ))}
    </div>
  );
}

function MessageBubble({
  message,
  onRetry,
  onAttachmentRetry,
}: {
  message: Message;
  onRetry: () => void;
  onAttachmentRetry: (attachmentId: string) => void;
}) {
  if (message.direction === "system") {
    return <div className="eco-messenger-system-message">{message.text}</div>;
  }
  const text = safeMessageText(message.text);
  const autoNotification = autoNotificationParts(text);
  const errorText = message.status === "failed" ? normalizeMessengerError(message.errorMessage) : "";
  return (
    <div className={cx("eco-messenger-message", message.direction === "outbound" ? "is-outbound" : "is-inbound", message.status === "failed" && "is-failed")}>
      <div className="eco-messenger-message__bubble">
        {autoNotification ? (
          <div className="eco-messenger-auto-note">
            <span>
              <b>Автоуведомление</b>
              <em>{autoNotification.event}</em>
            </span>
            {autoNotification.body && <p>{autoNotification.body}</p>}
          </div>
        ) : (
          text && <p>{text}</p>
        )}
        {!!message.attachments.length && <MessageAttachments attachments={message.attachments} onRetry={onAttachmentRetry} />}
        <span className="eco-messenger-message__meta">
          {formatMessengerTime(message.createdAt)}
          <span className={message.status === "failed" ? "is-danger" : ""}>{message.status === "failed" ? "не отправлено" : statusLabels[message.status]}</span>
        </span>
        {errorText && <span className="eco-messenger-message__error">{errorText}</span>}
      </div>
      {message.status === "failed" && (
        <button type="button" className="eco-messenger-retry" onClick={onRetry}>
          <RefreshCw aria-hidden className="eco-icon" />
          Повторить
        </button>
      )}
    </div>
  );
}

function MessageAttachments({ attachments, onRetry }: { attachments: Attachment[]; onRetry: (attachmentId: string) => void }) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const viewableMedia = attachments.filter(
    (attachment) =>
      (isPhotoAttachment(attachment) || isVideoAttachment(attachment)) &&
      isAttachmentReady(attachment) &&
      (attachment.url || attachment.previewUrl)
  );
  const activeLightboxIndex = lightboxIndex !== null && lightboxIndex < viewableMedia.length ? lightboxIndex : null;

  return (
    <>
      <div className="eco-messenger-attachments">
        {attachments.map((attachment) => {
          if (isPhotoAttachment(attachment)) {
            const photoIndex = viewableMedia.findIndex((item) => item.id === attachment.id);
            return (
              <PhotoAttachment
                key={attachment.id}
                attachment={attachment}
                onOpen={() => photoIndex >= 0 && setLightboxIndex(photoIndex)}
                onRetry={() => onRetry(attachment.id)}
              />
            );
          }
          if (isVideoAttachment(attachment)) {
            const videoIndex = viewableMedia.findIndex((item) => item.id === attachment.id);
            return (
              <VideoAttachment
                key={attachment.id}
                attachment={attachment}
                onOpen={() => videoIndex >= 0 && setLightboxIndex(videoIndex)}
                onRetry={() => onRetry(attachment.id)}
              />
            );
          }
          if (isAudioAttachment(attachment)) {
            return <AudioAttachment key={attachment.id} attachment={attachment} onRetry={() => onRetry(attachment.id)} />;
          }
          return <FileAttachment key={attachment.id} attachment={attachment} onRetry={() => onRetry(attachment.id)} />;
        })}
      </div>
      {activeLightboxIndex !== null && viewableMedia[activeLightboxIndex] && (
        <AttachmentLightbox
          attachments={viewableMedia}
          index={activeLightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={(nextIndex) => setLightboxIndex(nextIndex)}
        />
      )}
    </>
  );
}

function AttachmentStatus({
  attachment,
  icon,
  onRetry,
}: {
  attachment: Attachment;
  icon: React.ReactNode;
  onRetry: () => void;
}) {
  const failed = isAttachmentFailed(attachment);
  const retryable = attachment.status === "failed";
  const text =
    attachment.status === "too_large"
      ? "Файл слишком большой для автозагрузки"
      : attachment.status === "unsupported"
        ? "Этот тип вложения пока не поддерживается"
        : failed
          ? attachment.errorMessage || "Не удалось загрузить вложение"
          : pendingAttachmentText(attachment);
  return (
    <div className={cx("eco-messenger-attachment", failed && "is-failed", !failed && "is-pending")}>
      {icon}
      <span>
        <strong>{displayAttachmentName(attachment)}</strong>
        <small>{text}</small>
      </span>
      {retryable && (
        <button type="button" className="eco-messenger-attachment__mini-btn" onClick={onRetry}>
          <RefreshCw aria-hidden className="eco-icon" />
          Повторить
        </button>
      )}
    </div>
  );
}

function AttachmentDownload({ attachment, label = "Скачать" }: { attachment: Attachment; label?: string }) {
  if (!attachment.url) return null;
  return (
    <a className="eco-messenger-attachment__download" href={attachment.url} download={displayAttachmentName(attachment)}>
      <Download aria-hidden className="eco-icon" />
      <span>{label}</span>
    </a>
  );
}

function PhotoAttachment({ attachment, onOpen, onRetry }: { attachment: Attachment; onOpen: () => void; onRetry: () => void }) {
  const [failed, setFailed] = useState(false);
  const src = attachment.previewUrl || attachment.url || "";
  if (!isAttachmentReady(attachment) || !src || failed) {
    return (
      <AttachmentStatus
        attachment={{ ...attachment, errorMessage: failed ? "Не удалось загрузить фото" : attachment.errorMessage }}
        icon={<ImageIcon aria-hidden className="eco-icon" />}
        onRetry={onRetry}
      />
    );
  }
  return (
    <figure className={cx("eco-messenger-media", "is-photo", attachment.type === "sticker" && "is-sticker", attachment.type === "animation" && "is-animation")}>
      <button type="button" onClick={onOpen} aria-label="Открыть фото">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={displayAttachmentName(attachment)} loading="lazy" onError={() => setFailed(true)} />
      </button>
      {attachment.caption && <figcaption>{attachment.caption}</figcaption>}
    </figure>
  );
}

function VideoAttachment({ attachment, onOpen, onRetry }: { attachment: Attachment; onOpen: () => void; onRetry: () => void }) {
  if (!isAttachmentReady(attachment) || !attachment.url) {
    return <AttachmentStatus attachment={attachment} icon={<FileVideo aria-hidden className="eco-icon" />} onRetry={onRetry} />;
  }
  return (
    <div className={cx("eco-messenger-media", "is-video", attachment.type === "video_note" && "is-video-note")}>
      <div className="eco-messenger-video-preview">
        <video src={attachment.url} poster={attachment.previewUrl} controls playsInline preload="metadata" />
        <button type="button" onClick={onOpen} aria-label="Открыть видео">
          <Expand aria-hidden className="eco-icon" />
        </button>
      </div>
      <div className="eco-messenger-media__caption">
        <FileVideo aria-hidden className="eco-icon" />
        <span>
          <strong title={attachment.name || displayAttachmentName(attachment)}>{displayAttachmentName(attachment)}</strong>
          <small>{attachmentMetaLine(attachment) || "Видео"}</small>
        </span>
        <AttachmentDownload attachment={attachment} label="Скачать" />
      </div>
    </div>
  );
}

function AudioAttachment({ attachment, onRetry }: { attachment: Attachment; onRetry: () => void }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(attachment.duration ?? 0);
  const [current, setCurrent] = useState(0);
  const [rate, setRate] = useState(1);

  if (!isAttachmentReady(attachment) || !attachment.url) {
    return <AttachmentStatus attachment={attachment} icon={<FileAudio aria-hidden className="eco-icon" />} onRetry={onRetry} />;
  }

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play();
      return;
    }
    audio.pause();
  }

  function cycleRate() {
    const next = rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1;
    setRate(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  }

  function seek(value: number) {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(value)) return;
    audio.currentTime = value;
    setCurrent(value);
  }

  const rangeMax = duration || attachment.duration || 0;

  return (
    <div className={cx("eco-messenger-audio", attachment.type === "voice" && "is-voice")}>
      <button type="button" className="eco-messenger-audio__play" onClick={togglePlay} aria-label={playing ? "Пауза" : "Воспроизвести"}>
        {playing ? <Pause aria-hidden className="eco-icon" /> : <Play aria-hidden className="eco-icon" />}
      </button>
      <div className="eco-messenger-audio__body">
        <div className="eco-messenger-audio__top">
          <strong>{displayAttachmentName(attachment)}</strong>
          <small>{formatDuration(current) || "0:00"} / {formatDuration(duration || attachment.duration) || "..."}</small>
        </div>
        <input
          type="range"
          min={0}
          max={rangeMax}
          step={0.1}
          value={rangeMax ? Math.min(current, rangeMax) : 0}
          onChange={(event) => seek(Number(event.target.value))}
          aria-label="Позиция аудио"
        />
        <div className="eco-messenger-audio__meta">
          <span>{audioMetaLine(attachment)}</span>
          <button type="button" onClick={cycleRate}>{rate}x</button>
          <AttachmentDownload attachment={attachment} label="Скачать" />
        </div>
      </div>
      <audio
        ref={audioRef}
        src={attachment.url}
        preload="metadata"
        onLoadedMetadata={(event) => {
          const nextDuration = event.currentTarget.duration;
          if (Number.isFinite(nextDuration)) setDuration(nextDuration);
          event.currentTarget.playbackRate = rate;
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)}
      />
    </div>
  );
}

function FileAttachment({ attachment, onRetry }: { attachment: Attachment; onRetry: () => void }) {
  const failed = isAttachmentFailed(attachment);
  const ready = isAttachmentReady(attachment);
  if (!ready || failed) {
    return <AttachmentStatus attachment={attachment} icon={<FileText aria-hidden className="eco-icon" />} onRetry={onRetry} />;
  }
  return (
    <div className="eco-messenger-attachment">
      <FileText aria-hidden className="eco-icon" />
      <span>
        <strong title={attachment.name || displayAttachmentName(attachment)}>{displayAttachmentName(attachment)}</strong>
        <small>{attachmentMetaLine(attachment) || "Документ"}</small>
      </span>
      <AttachmentDownload attachment={attachment} />
    </div>
  );
}

function AttachmentLightbox({
  attachments,
  index,
  onClose,
  onNavigate,
}: {
  attachments: Attachment[];
  index: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
}) {
  const touchStartRef = useRef<number | null>(null);
  const attachment = attachments[index];
  const src = attachment.url || attachment.previewUrl || "";
  const hasPrevious = index > 0;
  const hasNext = index < attachments.length - 1;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft" && hasPrevious) onNavigate(index - 1);
      if (event.key === "ArrowRight" && hasNext) onNavigate(index + 1);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [hasNext, hasPrevious, index, onClose, onNavigate]);

  return (
    <div
      className="eco-messenger-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={displayAttachmentName(attachment)}
      onTouchStart={(event) => {
        touchStartRef.current = event.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(event) => {
        const start = touchStartRef.current;
        const end = event.changedTouches[0]?.clientX;
        touchStartRef.current = null;
        if (start === null || end === undefined || Math.abs(start - end) < 42) return;
        if (start < end && hasPrevious) onNavigate(index - 1);
        if (start > end && hasNext) onNavigate(index + 1);
      }}
    >
      <button type="button" className="eco-messenger-lightbox__backdrop" onClick={onClose} aria-label="Закрыть просмотр" />
      <div className="eco-messenger-lightbox__stage">
        <div className="eco-messenger-lightbox__toolbar">
          <strong>{displayAttachmentName(attachment)}</strong>
          <span>
            <AttachmentDownload attachment={attachment} />
            <button type="button" onClick={onClose} aria-label="Закрыть">
              <X aria-hidden className="eco-icon" />
            </button>
          </span>
        </div>
        {hasPrevious && (
          <button type="button" className="eco-messenger-lightbox__nav is-prev" onClick={() => onNavigate(index - 1)} aria-label="Предыдущее медиа">
            <ChevronLeft aria-hidden className="eco-icon" />
          </button>
        )}
        {isVideoAttachment(attachment) && attachment.url ? (
          <video
            className={cx("eco-messenger-lightbox__video", attachment.type === "video_note" && "is-video-note")}
            src={attachment.url}
            poster={attachment.previewUrl}
            controls
            playsInline
            autoPlay
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={displayAttachmentName(attachment)} />
        )}
        {hasNext && (
          <button type="button" className="eco-messenger-lightbox__nav is-next" onClick={() => onNavigate(index + 1)} aria-label="Следующее медиа">
            <ChevronRight aria-hidden className="eco-icon" />
          </button>
        )}
      </div>
    </div>
  );
}

export function MessengerComposer({ conversation, compact = false }: { conversation: Conversation; compact?: boolean }) {
  const { selectedContext, sendMessage, sendAttachment, channelStatuses } = useMessenger();
  const [text, setText] = useState("");
  const [quickOpen, setQuickOpen] = useState(false);
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const [mockNotice, setMockNotice] = useState("");
  const [uploading, setUploading] = useState(false);
  const [templates, setTemplates] = useState<QuickReplyTemplate[]>(quickReplyTemplates);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let alive = true;
    async function loadTemplates() {
      try {
        const res = await fetch("/api/messenger/templates", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as TemplatesResponse;
        if (alive && Array.isArray(data.templates) && data.templates.length > 0) {
          setTemplates(data.templates.filter((template) => template.text.trim().length > 0));
        }
      } catch {
        // Local fallback templates keep quick replies available during gateway setup.
      }
    }
    void loadTemplates();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const draft = window.localStorage.getItem("eco:crm-draft");
    if (!draft) return;
    setText(draft);
    window.localStorage.removeItem("eco:crm-draft");
  }, [conversation.id]);

  const knownChannelStatus = channelStatuses[conversation.channel];
  const disabled = conversation.channel !== "mock" && Boolean(knownChannelStatus) && knownChannelStatus !== "connected";
  const canSend = text.trim().length > 0 && !disabled && !uploading;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSend) return;
    sendMessage(conversation.id, text);
    setText("");
  }

  function attachmentAction(label: string) {
    setAttachmentsOpen(false);
    if (label === "Отправить фото" || label === "Фото") {
      imageInputRef.current?.click();
      return;
    }
    if (label === "Отправить файл") {
      fileInputRef.current?.click();
      return;
    }
    if (label === "Быстрый ответ") {
      setQuickOpen(true);
      return;
    }
    const helperText =
      label === "Отправить отчёт диагностики"
        ? "Выберите диагностику в правой панели: отправим публичную ссылку отчёта."
        : label === "Отправить предчек"
          ? "Предчек можно отправить после привязки отгрузки к диалогу."
          : label === "Отправить ссылку на запись"
            ? "Ссылка на запись появится после привязки записи клиента."
            : label === "Отправить карточку отгрузки"
              ? "Карточка отгрузки появится после привязки отгрузки."
              : `${label}: действие требует связанного объекта.`;
    setMockNotice(helperText);
  }

  async function handlePickedFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || uploading || disabled) return;
    setMockNotice("");
    setUploading(true);
    try {
      await sendAttachment(conversation.id, file, text);
      setText("");
    } finally {
      setUploading(false);
    }
  }

  return (
    <form className={cx("eco-messenger-composer", compact && "is-compact")} onSubmit={handleSubmit}>
      <input ref={imageInputRef} type="file" accept="image/*" hidden onChange={handlePickedFile} />
      <input ref={fileInputRef} type="file" hidden onChange={handlePickedFile} />
      {mockNotice && <div className="eco-messenger-mock-notice">{mockNotice}</div>}
      <div className="eco-messenger-composer__menus">
        {attachmentsOpen && (
          <div className="eco-messenger-menu">
            {attachmentActions.map((action) => (
              <button type="button" key={action} onClick={() => attachmentAction(action)} disabled={disabled || uploading}>
                {action}
              </button>
            ))}
          </div>
        )}
        {quickOpen && (
          <div className="eco-messenger-menu is-quick">
            {templates.map((template) => (
              <button
                type="button"
                key={template.key}
                onClick={() => {
                  const rendered = renderTemplateText(template, conversation, selectedContext?.client ?? null);
                  setText((value) => (value ? `${value}\n\n${rendered}` : rendered));
                  setQuickOpen(false);
                }}
              >
                <strong>{template.title}</strong>
                {!!template.variablesJson.length && <small>{template.variablesJson.map((item) => `{{${item}}}`).join(" ")}</small>}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="eco-messenger-composer__bar">
        <button type="button" onClick={() => setAttachmentsOpen((value) => !value)} aria-label="Вложения">
          <Plus aria-hidden className="eco-icon" />
        </button>
        <button type="button" onClick={() => attachmentAction("Фото")} aria-label="Фото" disabled={disabled || uploading}>
          <ImageIcon aria-hidden className="eco-icon" />
        </button>
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              if (canSend) {
                sendMessage(conversation.id, text);
                setText("");
              }
            }
          }}
          rows={1}
          disabled={disabled}
          placeholder={disabled ? "Канал не подключён" : uploading ? "Загружаем вложение..." : "Напишите сообщение..."}
        />
        <button type="button" onClick={() => setQuickOpen((value) => !value)} aria-label="Быстрые ответы">
          <Sparkles aria-hidden className="eco-icon" />
        </button>
        <button type="button" onClick={() => setMockNotice("Голосовые сообщения подключим после текстов, фото и документов.")} aria-label="Голосовое сообщение">
          <Mic aria-hidden className="eco-icon" />
        </button>
        <button type="submit" className="is-send" aria-label="Отправить" disabled={!canSend}>
          <Send aria-hidden className="eco-icon" />
        </button>
      </div>
    </form>
  );
}

export function ContextPanel({ conversation, context }: { conversation: Conversation | null; context: MessengerConversationContext | null }) {
  const { toggleImportant, loading, errorMode } = useMessenger();
  const clientContext = context?.client ?? null;

  if (!conversation) {
    return (
      <aside className="eco-messenger-context">
        <MessengerState title="Диалог не выбран" body="Выберите переписку слева, чтобы увидеть клиента, авто и действия." />
      </aside>
    );
  }

  if (loading || context?.state === "loading") {
    return (
      <aside className="eco-messenger-context">
        <MessengerState title="Загрузка контекста" body="Обновляем клиента, последние документы и доступные действия." />
      </aside>
    );
  }

  if (errorMode || context?.state === "error") {
    return (
      <aside className="eco-messenger-context">
        <MessengerState title="Ошибка загрузки контекста" body="Не удалось получить диалоги Messenger. Проверьте подключение и обновите экран." danger />
      </aside>
    );
  }

  if (conversation.status === "archived" || context?.state === "archived") {
    return (
      <aside className="eco-messenger-context">
        <ContextHeader conversation={conversation} context={clientContext} state="Архив" />
        <MessengerState title="Диалог архивирован" body="Действия скрыты, чтобы случайно не менять закрытую переписку." />
      </aside>
    );
  }

  if (conversation.kind === "supplier" || conversation.kind === "employee" || context?.state === "supplier" || context?.state === "employee") {
    const kind = context?.state === "supplier" || context?.state === "employee" ? context.state : conversation.kind;
    return (
      <aside className="eco-messenger-context">
        <ContextHeader conversation={conversation} context={clientContext} state={kind === "supplier" ? "Поставщик" : "Сотрудник"} />
        <NonClientContext conversation={conversation} toggleImportant={() => toggleImportant(conversation.id)} />
      </aside>
    );
  }

  return (
    <aside className="eco-messenger-context">
      <ContextHeader conversation={conversation} context={clientContext} state={clientContext ? "Клиент привязан" : "Клиент не привязан"} />

      {clientContext ? (
        <LinkedClientContext conversation={conversation} context={clientContext} />
      ) : (
        <ClientBindingPanel conversation={conversation} context={context} />
      )}

      <ContextActions conversation={conversation} context={clientContext} toggleImportant={() => toggleImportant(conversation.id)} />
    </aside>
  );
}

function ContextHeader({
  conversation,
  context,
  state,
}: {
  conversation: Conversation;
  context: MessengerClientContext | null;
  state: string;
}) {
  const channel = channelConfigs[conversation.channel];
  const Icon = channel.Icon;
  return (
    <div className="eco-messenger-context__header">
      <div className="eco-messenger-context__identity">
        <span
          className="eco-messenger-context__avatar"
          style={avatarStyle(conversation.participantName || conversation.title, channel.tint, channel.color)}
        >
          {getInitials(context?.name || conversation.participantName || conversation.title)}
        </span>
        <span>
          <strong>{context?.name || conversation.participantName || conversation.title}</strong>
          <small>
            <Icon aria-hidden className="eco-icon" />
            {channel.label} · {state}
          </small>
        </span>
      </div>
      {conversation.isImportant && (
        <span className="eco-messenger-context__badge">
          <Star aria-hidden className="eco-icon" />
          важный
        </span>
      )}
    </div>
  );
}

function LinkedClientContext({ conversation, context }: { conversation: Conversation; context: MessengerClientContext }) {
  const historyRows = [
    ...context.shipments.map((item) => ({
      id: item.id,
      title: item.title,
      meta: item.amount || item.status,
      href: `/shipment/${encodeURIComponent(item.id)}`,
      icon: <Package aria-hidden className="eco-icon" />,
    })),
    ...context.diagnostics.map((item) => ({
      id: item.id,
      title: item.title,
      meta: item.status,
      href: item.publicReportUrl || `/diagnostics?diagnostic=${encodeURIComponent(item.id)}`,
      icon: <Wrench aria-hidden className="eco-icon" />,
    })),
  ];

  return (
    <>
      <section className="eco-messenger-context__section is-client">
        <div className="eco-messenger-context__title">
          <UserCheck aria-hidden className="eco-icon" />
          <h3>Клиент</h3>
        </div>
        <dl className="eco-messenger-dl">
          <div>
            <dt>Телефон</dt>
            <dd>{context.phone || conversation.participantPhone || "не указан"}</dd>
          </div>
          <div>
            <dt>Тип</dt>
            <dd>{context.type}</dd>
          </div>
          <div>
            <dt>Telegram</dt>
            <dd>{conversation.channel === "telegram" ? conversation.participantName : channelConfigs[conversation.channel].label}</dd>
          </div>
        </dl>
        <Link href={clientCardHref({ id: context.id, name: context.name, phone: context.phone })} className="eco-messenger-context__inline-link">
          <ExternalLink aria-hidden className="eco-icon" />
          Открыть карточку клиента
        </Link>
      </section>

      <ContextSection title="Автомобиль в диалоге" icon={<Car aria-hidden className="eco-icon" />}>
        {context.vehicle ? (
          <>
            <strong className="eco-messenger-context__main-value">{context.vehicle.label}</strong>
            <dl className="eco-messenger-dl">
              <div>
                <dt>Госномер</dt>
                <dd>{context.vehicle.plate || "не указан"}</dd>
              </div>
              <div>
                <dt>VIN</dt>
                <dd>{context.vehicle.vin || "не указан"}</dd>
              </div>
            </dl>
          </>
        ) : (
          <EmptyContextHint
            title="Авто не выбрано"
            body="Для записи, диагностики и отгрузки можно продолжить без VIN, но лучше выбрать автомобиль в карточке клиента."
          />
        )}
      </ContextSection>

      <ContextSection title="Активная работа" icon={<BriefcaseBusiness aria-hidden className="eco-icon" />}>
        {context.activeCase ? (
          <ContextEntityRow
            icon={<Clock3 aria-hidden className="eco-icon" />}
            title={context.activeCase.title}
            meta={`${context.activeCase.status} · ${context.activeCase.responsible}`}
            aside={context.activeCase.deadline}
            href={buildCaseHref(conversation, context)}
            danger={context.activeCase.overdue}
          />
        ) : (
          <EmptyContextHint title="Открытых дел нет" body="Создайте дело из переписки, чтобы закрепить следующий шаг и дедлайн." />
        )}
        {context.appointment && (
          <ContextEntityRow
            icon={<CalendarClock aria-hidden className="eco-icon" />}
            title={context.appointment.service}
            meta={context.appointment.status}
            aside={context.appointment.date}
            href={buildAppointmentHref(conversation, context)}
          />
        )}
      </ContextSection>

      <ContextSection title="Документы и диагностика" icon={<ClipboardList aria-hidden className="eco-icon" />}>
        {historyRows.length ? (
          historyRows.map((item) => (
            <ContextEntityRow key={`${item.href}-${item.id}`} icon={item.icon} title={item.title} meta={item.id} aside={item.meta} href={item.href} />
          ))
        ) : (
          <EmptyContextHint title="Связанных документов нет" body="Созданные отгрузки, диагностики и клиентские ссылки появятся здесь." />
        )}
      </ContextSection>

      <ContextSection title="Открытые задачи" icon={<StickyNote aria-hidden className="eco-icon" />}>
        {context.tasks.length ? (
          context.tasks.map((task) => (
            <ContextEntityRow
              key={task.id}
              icon={<FileText aria-hidden className="eco-icon" />}
              title={task.title}
              meta={task.id}
              aside={task.status}
              href={`/notifications?task=${encodeURIComponent(task.id)}`}
            />
          ))
        ) : (
          <EmptyContextHint title="Задач нет" body="Внутренние задачи по этому диалогу появятся в этом блоке." />
        )}
      </ContextSection>
    </>
  );
}

function NonClientContext({ conversation, toggleImportant }: { conversation: Conversation; toggleImportant: () => void }) {
  const label = conversation.kind === "supplier" ? "поставщиком" : "сотрудником";
  return (
    <>
      <section className="eco-messenger-context__section">
        <div className="eco-messenger-context__title">
          <ShieldQuestion aria-hidden className="eco-icon" />
          <h3>Не клиентский диалог</h3>
        </div>
        <p>Переписка классифицирована как диалог с {label}. Клиентские действия скрыты, чтобы не создать неверную карточку.</p>
      </section>
      <div className="eco-messenger-context__actions">
        <button type="button" onClick={toggleImportant}>
          <Star aria-hidden className="eco-icon" />
          {conversation.isImportant ? "Снять важность" : "Пометить важным"}
        </button>
      </div>
    </>
  );
}

function ContextSection({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="eco-messenger-context__section">
      <div className="eco-messenger-context__title">
        {icon}
        <h3>{title}</h3>
      </div>
      <div className="eco-messenger-context__body">{children}</div>
    </section>
  );
}

function ContextEntityRow({
  icon,
  title,
  meta,
  aside,
  href,
  danger,
}: {
  icon: React.ReactNode;
  title: string;
  meta: string;
  aside: string;
  href: string;
  danger?: boolean;
}) {
  return (
    <Link href={href} className={cx("eco-messenger-context-row", danger && "is-danger")}>
      {icon}
      <span>
        <strong>{title}</strong>
        <small>{meta}</small>
      </span>
      <em>{aside}</em>
    </Link>
  );
}

function EmptyContextHint({ title, body }: { title: string; body: string }) {
  return (
    <div className="eco-messenger-context__empty">
      <strong>{title}</strong>
      <span>{body}</span>
    </div>
  );
}

function ClientBindingPanel({ conversation, context }: { conversation: Conversation; context: MessengerConversationContext | null }) {
  const { refreshConversation } = useMessenger();
  const [dialogMode, setDialogMode] = useState<"search" | "create" | null>(null);
  const contextSuggestions = useMemo(
    () => (context?.suggestions?.length ? context.suggestions.map(suggestionToClientSearchResult) : []),
    [context]
  );
  const [fetchedSuggestions, setFetchedSuggestions] = useState<ClientSearchResult[]>([]);
  const [notice, setNotice] = useState("");
  const suggestions = contextSuggestions.length ? contextSuggestions : fetchedSuggestions;

  useEffect(() => {
    if (contextSuggestions.length) return;
    let alive = true;
    const controller = new AbortController();
    fetch(`/api/messenger/conversations/${encodeURIComponent(conversation.id)}/client-suggestions`, { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error("Не удалось получить подсказки клиентов");
        return (await res.json()) as ClientSearchResponse;
      })
      .then((data) => {
        if (alive) setFetchedSuggestions((data.clients ?? data.counterparties ?? []).map((item) => "score" in item ? suggestionToClientSearchResult(item) : item));
      })
      .catch(() => {
        if (alive) setFetchedSuggestions([]);
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [contextSuggestions.length, conversation.id]);

  return (
    <section className="eco-messenger-context__section is-unlinked">
      <div className="eco-messenger-context__title">
        <UserSearch aria-hidden className="eco-icon" />
        <h3>Клиент не привязан</h3>
      </div>
      <p>Telegram-имя не считается клиентом CRM. Выберите существующую карточку или создайте новую из диалога.</p>
      {context?.state === "conflict" && (
        <div className="eco-messenger-context__warning">
          <AlertTriangle aria-hidden className="eco-icon" />
          У Telegram-профиля уже есть подтверждённая связь с другим клиентом. Проверьте карточку перед сменой привязки.
        </div>
      )}
      {conversation.channel === "telegram" && !conversation.participantPhone && (
        <div className="eco-messenger-context__warning">
          <AlertTriangle aria-hidden className="eco-icon" />
          Telegram не передал телефон. Привязка будет опираться на выбранную карточку клиента.
        </div>
      )}
      {notice && <div className="eco-messenger-context__notice">{notice}</div>}
      <div className="eco-messenger-context__actions">
        <button type="button" className="is-primary" onClick={() => setDialogMode("search")}>
          <Link2 aria-hidden className="eco-icon" />
          Найти и привязать клиента
        </button>
        <button type="button" onClick={() => setDialogMode("create")}>
          <UserPlus aria-hidden className="eco-icon" />
          Создать нового клиента
        </button>
      </div>

      <div className="eco-messenger-suggestions">
        <div className="eco-messenger-context__subhead">
          <span>Возможные совпадения</span>
        </div>
        {suggestions.length ? (
          suggestions.map((client) => (
            <ClientSuggestionCard
              key={client.id}
              conversation={conversation}
              client={client}
              onLinked={(message) => {
                refreshConversation(conversation.id);
                setNotice(message);
              }}
            />
          ))
        ) : (
          <EmptyContextHint title="Совпадений не найдено" body="По имени клиента система только подсказывает варианты и не привязывает автоматически." />
        )}
      </div>

      {dialogMode && (
        <ClientLinkDialog
          conversation={conversation}
          initialMode={dialogMode}
          onClose={() => setDialogMode(null)}
          onLinked={(message) => {
            refreshConversation(conversation.id);
            setNotice(message);
            setDialogMode(null);
          }}
        />
      )}
    </section>
  );
}

function ClientSuggestionCard({
  conversation,
  client,
  onLinked,
}: {
  conversation: Conversation;
  client: ClientSearchResult;
  onLinked: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function linkClient() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/messenger/conversations/${encodeURIComponent(conversation.id)}/link-client`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: client.id }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(data?.error || "Не удалось привязать клиента");
      onLinked("Клиент привязан к диалогу");
    } catch (linkError) {
      setError(linkError instanceof Error ? linkError.message : "Не удалось привязать клиента");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="eco-messenger-client-card">
      <div>
        <strong>{client.name}</strong>
        <small>{[client.phone || "телефон не указан", clientTypeLabel(client.companyType), client.vehicleLabel].filter(Boolean).join(" · ")}</small>
        <em>{clientMatchReason(conversation, client)}</em>
        {error && <b>{error}</b>}
      </div>
      <div className="eco-messenger-client-card__actions">
        <Link href={clientCardHref(client)} aria-label="Открыть карточку клиента">
          <ExternalLink aria-hidden className="eco-icon" />
        </Link>
        <button type="button" onClick={linkClient} disabled={busy}>
          {busy ? "..." : "Привязать"}
        </button>
      </div>
    </div>
  );
}

function ClientLinkDialog({
  conversation,
  initialMode,
  onClose,
  onLinked,
}: {
  conversation: Conversation;
  initialMode: "search" | "create";
  onClose: () => void;
  onLinked: (message: string) => void;
}) {
  const [mode, setMode] = useState<"search" | "create">(initialMode);
  const [query, setQuery] = useState(bestClientSearchSeed(conversation));
  const [results, setResults] = useState<ClientSearchResult[]>([]);
  const [selectedClient, setSelectedClient] = useState<ClientSearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<ClientCreateForm>(() => emptyCreateClientForm(conversation));

  useEffect(() => {
    const cleanQuery = query.trim();
    if (mode !== "search" || cleanQuery.length < 2) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setSearching(true);
      setError("");
      const params = new URLSearchParams({ q: cleanQuery });
      fetch(`/api/messenger/conversations/${encodeURIComponent(conversation.id)}/client-search?${params.toString()}`, { cache: "no-store", signal: controller.signal })
        .then(async (res) => {
          const data = (await res.json().catch(() => null)) as ClientSearchResponse | null;
          if (!res.ok) throw new Error(data?.error || "Не удалось выполнить поиск клиентов");
          setResults((data?.clients ?? data?.counterparties ?? []).map((item) => "score" in item ? suggestionToClientSearchResult(item) : item));
        })
        .catch((searchError) => {
          if (!controller.signal.aborted) setError(searchError instanceof Error ? searchError.message : "Не удалось выполнить поиск клиентов");
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, 220);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [conversation.id, mode, query]);

  async function linkClient(client: ClientSearchResult) {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/messenger/conversations/${encodeURIComponent(conversation.id)}/link-client`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: client.id }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(data?.error || "Не удалось привязать клиента");
      onLinked(`Диалог связан с клиентом «${client.name}»`);
    } catch (linkError) {
      setError(linkError instanceof Error ? linkError.message : "Не удалось привязать клиента");
    } finally {
      setSaving(false);
    }
  }

  async function createAndLinkClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = form.name.trim();
    if (!name) {
      setError("Укажите имя или название клиента");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const createRes = await fetch(`/api/messenger/conversations/${encodeURIComponent(conversation.id)}/create-and-link-client`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          phone: form.phone.trim(),
          vehicle: {
            label: form.vehicleModel.trim(),
            plate: form.vehiclePlate.trim(),
            vin: form.vehicleVin.trim(),
            year: form.vehicleYear.trim(),
          },
        }),
      });
      const created = (await createRes.json().catch(() => null)) as { error?: string; context?: MessengerConversationContext } | null;
      if (!createRes.ok) throw new Error(created?.error || "Не удалось создать клиента");
      onLinked(`Диалог связан с клиентом «${created?.context?.client?.name ?? name}»`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Не удалось создать клиента");
    } finally {
      setSaving(false);
    }
  }

  function updateForm<Key extends keyof ClientCreateForm>(key: Key, value: ClientCreateForm[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className="eco-messenger-context-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="eco-messenger-context-modal" role="dialog" aria-modal="true" aria-labelledby="messenger-client-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="eco-messenger-context-modal__head">
          <div>
            <small>{channelConfigs[conversation.channel].label} · {conversation.participantName}</small>
            <h3 id="messenger-client-dialog-title">{mode === "search" ? "Найти и привязать клиента" : "Создать нового клиента"}</h3>
          </div>
          <button type="button" onClick={onClose} aria-label="Закрыть">
            <X aria-hidden className="eco-icon" />
          </button>
        </header>

        <div className="eco-messenger-context-modal__tabs">
          <button type="button" className={mode === "search" ? "is-active" : ""} onClick={() => setMode("search")}>
            <UserSearch aria-hidden className="eco-icon" />
            Поиск
          </button>
          <button type="button" className={mode === "create" ? "is-active" : ""} onClick={() => setMode("create")}>
            <UserPlus aria-hidden className="eco-icon" />
            Новый клиент
          </button>
        </div>

        {error && <div className="eco-messenger-context__notice is-error">{error}</div>}

        {mode === "search" ? (
          <div className="eco-messenger-client-search">
            <label className="eco-messenger-context-field">
              <span>Поиск по имени, телефону, ИНН, авто, госномеру или VIN</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} autoFocus />
            </label>
            <div className="eco-messenger-client-results">
              {searching && <MessengerState title="Ищем клиентов" body="Проверяем локальную CRM и историю отгрузок." />}
              {!searching && results.length === 0 && (
                <MessengerState title="Ничего не найдено" body="Попробуйте телефон без скобок, госномер, VIN или создайте нового клиента." />
              )}
              {!searching &&
                results.map((client) => (
                  <button
                    type="button"
                    key={client.id}
                    className={cx("eco-messenger-client-result", selectedClient?.id === client.id && "is-selected")}
                    onClick={() => setSelectedClient(client)}
                  >
                    <span>
                      <strong>{client.name}</strong>
                      <small>{[client.phone || "телефон не указан", clientTypeLabel(client.companyType), client.vehicleLabel].filter(Boolean).join(" · ")}</small>
                      <em>{clientMatchReason(conversation, client)}</em>
                    </span>
                    {client.archived && <b>архив</b>}
                  </button>
                ))}
            </div>
            {selectedClient && (
              <div className="eco-messenger-client-confirm">
                <CheckCircle2 aria-hidden className="eco-icon" />
                <span>
                  Telegram-диалог “{conversation.participantName}” будет связан с клиентом “{selectedClient.name}”.
                  Новые сообщения этого контакта будут видны в карточке клиента.
                </span>
                <button type="button" onClick={() => linkClient(selectedClient)} disabled={saving}>
                  {saving ? "Привязываем..." : "Подтвердить привязку"}
                </button>
              </div>
            )}
          </div>
        ) : (
          <form className="eco-messenger-client-form" onSubmit={createAndLinkClient}>
            <div className="eco-messenger-form-grid">
              <label className="eco-messenger-context-field">
                <span>Тип</span>
                <select value={form.companyType} onChange={(event) => updateForm("companyType", event.target.value as ClientCreateForm["companyType"])}>
                  <option value="individual">Физлицо</option>
                  <option value="entrepreneur">ИП</option>
                  <option value="legal">Компания</option>
                </select>
              </label>
              <label className="eco-messenger-context-field is-wide">
                <span>Имя или название</span>
                <input value={form.name} onChange={(event) => updateForm("name", event.target.value)} />
              </label>
              <label className="eco-messenger-context-field">
                <span>Основной телефон</span>
                <input value={form.phone} onChange={(event) => updateForm("phone", event.target.value)} placeholder="+7..." />
              </label>
              <label className="eco-messenger-context-field">
                <span>Дополнительный телефон</span>
                <input value={form.additionalPhone} onChange={(event) => updateForm("additionalPhone", event.target.value)} />
              </label>
              <label className="eco-messenger-context-field">
                <span>Email</span>
                <input value={form.email} onChange={(event) => updateForm("email", event.target.value)} />
              </label>
              <label className="eco-messenger-context-field">
                <span>Автомобиль</span>
                <input value={form.vehicleModel} onChange={(event) => updateForm("vehicleModel", event.target.value)} placeholder="Марка и модель" />
              </label>
              <label className="eco-messenger-context-field">
                <span>Госномер</span>
                <input value={form.vehiclePlate} onChange={(event) => updateForm("vehiclePlate", event.target.value)} />
              </label>
              <label className="eco-messenger-context-field">
                <span>VIN</span>
                <input value={form.vehicleVin} onChange={(event) => updateForm("vehicleVin", event.target.value.toUpperCase())} />
              </label>
              <label className="eco-messenger-context-field">
                <span>Год</span>
                <input value={form.vehicleYear} onChange={(event) => updateForm("vehicleYear", event.target.value)} />
              </label>
              <label className="eco-messenger-context-field is-wide">
                <span>Комментарий</span>
                <textarea value={form.comment} onChange={(event) => updateForm("comment", event.target.value)} rows={3} />
              </label>
            </div>
            {!form.phone.trim() && (
              <div className="eco-messenger-context__warning">
                <AlertTriangle aria-hidden className="eco-icon" />
                Telegram не передал телефон. Клиент будет создан без технического номера.
              </div>
            )}
            <footer className="eco-messenger-context-modal__footer">
              <button type="button" onClick={onClose}>
                Отмена
              </button>
              <button type="submit" className="is-primary" disabled={saving}>
                {saving ? "Создаём..." : "Создать и привязать"}
              </button>
            </footer>
          </form>
        )}
      </section>
    </div>
  );
}

function ContextActions({
  conversation,
  context,
  toggleImportant,
}: {
  conversation: Conversation;
  context: MessengerClientContext | null;
  toggleImportant: () => void;
}) {
  const { refreshConversation } = useMessenger();
  const [notice, setNotice] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const diagnostic = context?.diagnostics.find((item) => item.publicReportUrl) ?? context?.diagnostics[0] ?? null;
  const clientLinked = Boolean(context);
  const appointmentHref = buildAppointmentHref(conversation, context);
  const shipmentHref = buildShipmentHref(conversation, context);
  const hasShipment = Boolean(conversation.shipmentId || context?.shipments.length);
  const hasAppointment = Boolean(context?.appointment);

  async function runGatewayAction(action: string, request: () => Promise<Response>, success: string) {
    setBusyAction(action);
    setNotice("");
    try {
      const res = await request();
      const data = (await res.json().catch(() => null)) as { error?: string; reportUrl?: string } | null;
      if (!res.ok) throw new Error(data?.error || "Действие не выполнено");
      refreshConversation(conversation.id);
      setNotice(data?.reportUrl ? `${success}: ${data.reportUrl}` : success);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Действие не выполнено");
    } finally {
      setBusyAction(null);
    }
  }

  function createCase() {
    if (!clientLinked) {
      setNotice("Сначала найдите или создайте клиента для этого диалога");
      return;
    }
    void runGatewayAction(
      "case",
      () =>
        fetch(`/api/messenger/conversations/${encodeURIComponent(conversation.id)}/create-case`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: conversation.title || `Диалог ${conversation.participantName}` }),
        }),
      "Дело клиента создано"
    );
  }

  function createShipment() {
    if (!clientLinked) {
      setNotice("Сначала найдите или создайте клиента для этого диалога");
      return;
    }
    void runGatewayAction(
      "shipment",
      () =>
        fetch(`/api/messenger/conversations/${encodeURIComponent(conversation.id)}/create-shipment`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ description: `Черновик из диалога ${conversation.participantName}` }),
        }),
      "Черновик отгрузки создан"
    );
  }

  function createTask() {
    void runGatewayAction(
      "task",
      () =>
        fetch(`/api/messenger/conversations/${encodeURIComponent(conversation.id)}/create-task`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: `Ответить клиенту: ${conversation.participantName || conversation.title}`,
            responsibleLogin: conversation.assignedTo,
          }),
        }),
      "Задача создана в CRM"
    );
  }

  function unlinkClient() {
    if (!context) return;
    const ok = window.confirm(
      `Отвязать клиента «${context.name}» от диалога? Переписка, дела, записи и отгрузки не будут удалены.`
    );
    if (!ok) return;
    void runGatewayAction(
      "unlink",
      () =>
        fetch(`/api/messenger/conversations/${encodeURIComponent(conversation.id)}/unlink-client`, {
          method: "DELETE",
        }),
      "Клиент отвязан от диалога"
    );
  }

  function sendDiagnosticReport() {
    if (!diagnostic) {
      setNotice("Нет завершённой диагностики с публичной ссылкой для этого клиента");
      return;
    }
    void runGatewayAction(
      "diagnostic",
      () =>
        fetch(`/api/messenger/conversations/${encodeURIComponent(conversation.id)}/send-diagnostic-report`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            diagnosticId: diagnostic.id || conversation.diagnosticId,
            publicReportUrl: diagnostic.publicReportUrl,
          }),
        }),
      "Отчёт диагностики поставлен в отправку"
    );
  }

  function sendPrecheck() {
    void runGatewayAction(
      "precheck",
      () => fetch(`/api/messenger/conversations/${encodeURIComponent(conversation.id)}/send-precheck`, { method: "POST" }),
      "Предчек поставлен в отправку"
    );
  }

  function sendAppointmentLink() {
    void runGatewayAction(
      "appointment-link",
      () => fetch(`/api/messenger/conversations/${encodeURIComponent(conversation.id)}/send-appointment-link`, { method: "POST" }),
      "Подтверждение записи поставлено в отправку"
    );
  }

  function sendShipmentCard() {
    void runGatewayAction(
      "shipment-card",
      () => fetch(`/api/messenger/conversations/${encodeURIComponent(conversation.id)}/send-shipment-card`, { method: "POST" }),
      "Карточка отгрузки поставлена в отправку"
    );
  }

  return (
    <section className="eco-messenger-context__section is-actions">
      <div className="eco-messenger-context__title">
        <Sparkles aria-hidden className="eco-icon" />
        <h3>Действия</h3>
      </div>
      {notice && <div className="eco-messenger-context__notice">{notice}</div>}

      {context ? (
        <>
          <div className="eco-messenger-context__action-group">
            <span>Работа</span>
            <div className="eco-messenger-context__actions">
              <button type="button" onClick={createCase} disabled={busyAction === "case"}>
                <BriefcaseBusiness aria-hidden className="eco-icon" />
                {busyAction === "case" ? "Создаём дело..." : context.activeCase ? "Создать ещё дело" : "Создать дело"}
              </button>
              <Link href={appointmentHref}>
                <CalendarClock aria-hidden className="eco-icon" />
                {context.appointment ? "Открыть запись" : "Создать запись"}
              </Link>
              {hasShipment ? (
                <Link href={shipmentHref}>
                  <Truck aria-hidden className="eco-icon" />
                  Открыть отгрузку
                </Link>
              ) : (
                <button type="button" onClick={createShipment} disabled={busyAction === "shipment"}>
                  <Truck aria-hidden className="eco-icon" />
                  {busyAction === "shipment" ? "Создаём..." : "Создать отгрузку"}
                </button>
              )}
              <button type="button" onClick={createTask} disabled={busyAction === "task"}>
                <StickyNote aria-hidden className="eco-icon" />
                {busyAction === "task" ? "Ставим задачу..." : "Поставить задачу"}
              </button>
            </div>
          </div>

          <div className="eco-messenger-context__action-group">
            <span>Отправить</span>
            <div className="eco-messenger-context__actions">
              <button type="button" onClick={sendDiagnosticReport} disabled={busyAction === "diagnostic" || !diagnostic} title={!diagnostic ? "Нет завершённых диагностик с публичной ссылкой" : undefined}>
                <Wrench aria-hidden className="eco-icon" />
                {busyAction === "diagnostic" ? "Отправляем отчёт..." : "Отправить отчёт диагностики"}
              </button>
              <button type="button" onClick={sendPrecheck} disabled={busyAction === "precheck" || !hasShipment} title={!hasShipment ? "Сначала создайте или привяжите отгрузку" : undefined}>
                <FileText aria-hidden className="eco-icon" />
                {busyAction === "precheck" ? "Отправляем..." : "Отправить предчек"}
              </button>
              {hasAppointment ? (
                <button type="button" onClick={sendAppointmentLink} disabled={busyAction === "appointment-link"}>
                  <MessageCircle aria-hidden className="eco-icon" />
                  {busyAction === "appointment-link" ? "Отправляем..." : "Отправить запись"}
                </button>
              ) : (
                <Link href={appointmentHref}>
                  <MessageCircle aria-hidden className="eco-icon" />
                  Создать запись для ссылки
                </Link>
              )}
              <button type="button" onClick={sendShipmentCard} disabled={busyAction === "shipment-card" || !hasShipment} title={!hasShipment ? "Сначала создайте или привяжите отгрузку" : undefined}>
                <Truck aria-hidden className="eco-icon" />
                {busyAction === "shipment-card" ? "Отправляем..." : "Отправить отгрузку"}
              </button>
            </div>
          </div>

          <div className="eco-messenger-context__action-group">
            <span>Связь</span>
            <div className="eco-messenger-context__actions">
              <Link href={clientCardHref({ id: context.id, name: context.name, phone: context.phone })}>
                <ExternalLink aria-hidden className="eco-icon" />
                Открыть клиента
              </Link>
              <button type="button" onClick={() => setLinkDialogOpen(true)}>
                <Link2 aria-hidden className="eco-icon" />
                Изменить привязку
              </button>
              <button type="button" onClick={unlinkClient} disabled={busyAction === "unlink"}>
                <Unlink aria-hidden className="eco-icon" />
                {busyAction === "unlink" ? "Отвязываем..." : "Отвязать клиента"}
              </button>
            </div>
          </div>
        </>
      ) : (
        <div className="eco-messenger-context__action-group">
          <span>Без клиента</span>
          <div className="eco-messenger-context__actions">
            <button type="button" onClick={createTask} disabled={busyAction === "task"}>
              <StickyNote aria-hidden className="eco-icon" />
              {busyAction === "task" ? "Ставим..." : "Создать CRM-задачу"}
            </button>
          </div>
        </div>
      )}

      <div className="eco-messenger-context__action-group">
        <span>Диалог</span>
        <div className="eco-messenger-context__actions">
          <button type="button" onClick={toggleImportant}>
            <Star aria-hidden className="eco-icon" />
            {conversation.isImportant ? "Снять важность" : "Пометить важным"}
          </button>
        </div>
      </div>

      {linkDialogOpen && (
        <ClientLinkDialog
          conversation={conversation}
          initialMode="search"
          onClose={() => setLinkDialogOpen(false)}
          onLinked={(message) => {
            refreshConversation(conversation.id);
            setNotice(message);
            setLinkDialogOpen(false);
          }}
        />
      )}
    </section>
  );
}

export function MessengerState({ title, body, danger = false }: { title: string; body: string; danger?: boolean }) {
  return (
    <div className={cx("eco-messenger-state", danger && "is-danger")}>
      <strong>{title}</strong>
      <span>{body}</span>
    </div>
  );
}

export function ChannelStatusStrip() {
  const [channels, setChannels] = useState<ApiChannel[] | null>(null);

  useEffect(() => {
    let alive = true;
    async function loadChannels() {
      try {
        const res = await fetch("/api/messenger/channels", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { channels?: ApiChannel[] };
        if (alive && Array.isArray(data.channels)) setChannels(data.channels);
      } catch {
        // Static channel catalog remains visible if the gateway is unavailable.
      }
    }
    void loadChannels();
    return () => {
      alive = false;
    };
  }, []);

  const items = channels?.length
    ? channels.map((channel) => ({ ...channelConfigs[channel.key], ...channel }))
    : Object.values(channelConfigs);
  const visibleItems = items.filter((channel) => MESSENGER_DEV_TOOLS_ENABLED || channel.id !== "mock");

  return (
    <div className="eco-messenger-channel-strip">
      {visibleItems.map((channel) => {
        const Icon = channel.Icon;
        const label = connectionStatusLabel(channel.connectionStatus);
        return (
          <span
            key={channel.id}
            className={channel.connectionStatus === "connected" ? "is-connected" : "is-muted"}
            style={{ "--channel": channel.color, "--channel-bg": channel.tint } as React.CSSProperties}
          >
            <Icon aria-hidden className="eco-icon" />
            {channel.label} · {label}
          </span>
        );
      })}
    </div>
  );
}

export function GatewayApiCard() {
  if (!MESSENGER_DEV_TOOLS_ENABLED) return null;
  return (
    <div className="eco-messenger-gateway">
      <div>
        <strong>MessengerGateway API</strong>
        <span>Frontend уже работает через абстракцию, без привязки к Telegram/VK/WhatsApp.</span>
      </div>
      <div>
        {gatewayEndpoints.map((endpoint) => (
          <code key={endpoint}>{endpoint}</code>
        ))}
      </div>
    </div>
  );
}

export function FullPageStateControls() {
  const {
    loading,
    errorMode,
    emptyMode,
    setLoadingMode,
    setErrorMode,
    setEmptyMode,
    simulateIncoming,
    responsible,
    setResponsible,
    conversations,
  } = useMessenger();
  const responsibles = useMemo(
    () => [
      "all",
      ...Array.from(
        new Set(
          [responsible !== "all" ? responsible : null, ...conversations.map((item) => item.assignedTo)].filter(
            (item): item is string => typeof item === "string" && item.length > 0
          )
        )
      ),
    ],
    [conversations, responsible]
  );
  if (!MESSENGER_DEV_TOOLS_ENABLED) return null;
  return (
    <div className="eco-messenger-dev-controls">
      <button type="button" className={loading ? "is-active" : ""} onClick={() => setLoadingMode(!loading)}>
        loading
      </button>
      <button type="button" className={emptyMode ? "is-active" : ""} onClick={() => setEmptyMode(!emptyMode)}>
        empty
      </button>
      <button type="button" className={errorMode ? "is-active" : ""} onClick={() => setErrorMode(!errorMode)}>
        error
      </button>
      <button type="button" onClick={simulateIncoming}>
        mock-event
      </button>
      <label>
        Ответственный
        <select value={responsible} onChange={(event) => setResponsible(event.target.value)}>
          {responsibles.map((item) => (
            <option key={item} value={item}>
              {item === "all" ? "Все" : item}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

export function EmptySelection() {
  return (
    <div className="eco-messenger-empty-selection">
      <MessageCircle aria-hidden />
      <strong>Выберите диалог</strong>
      <span>Переписка, действия и связанный контекст появятся в рабочей области.</span>
    </div>
  );
}
