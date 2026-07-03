"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  channelConfigs,
  connectionStatusLabel,
  safeMessageText,
  type Conversation,
  type Message,
  type MessengerConversationContext,
  type MessengerChannel,
  type ChannelConnectionStatus,
} from "./messenger-data";

type MessengerView = "collapsed" | "inbox" | "chat";
export type MessengerFilter =
  | "all"
  | "unread"
  | "important"
  | "clients"
  | "suppliers"
  | "employees"
  | "withoutClient"
  | "openCases";

type Toast = {
  id: string;
  text: string;
};

type ApiChannel = {
  key: MessengerChannel;
  label: string;
  enabled: boolean;
  connectionStatus: ChannelConnectionStatus;
};

type ConversationsResponse = {
  conversations?: Conversation[];
};

type MessagesResponse = {
  messages?: Message[];
};

type ContextResponse = {
  context?: MessengerConversationContext;
  error?: string;
};

type SendMessageResponse = {
  ok?: boolean;
  message?: Message;
  error?: string;
};

type SendAttachmentResponse = SendMessageResponse;

type MessengerContextValue = {
  conversations: Conversation[];
  messagesByConversation: Record<string, Message[]>;
  selectedConversationId: string | null;
  selectedConversation: Conversation | null;
  selectedContext: MessengerConversationContext | null;
  widgetView: MessengerView;
  filter: MessengerFilter;
  channel: MessengerChannel | "all";
  search: string;
  responsible: string;
  loading: boolean;
  errorMode: boolean;
  emptyMode: boolean;
  toast: Toast | null;
  channelStatuses: Partial<Record<MessengerChannel, ChannelConnectionStatus>>;
  channelLabels: Partial<Record<MessengerChannel, string>>;
  unreadTotal: number;
  filteredConversations: Conversation[];
  setWidgetView: (view: MessengerView) => void;
  openInbox: () => void;
  closeWidget: () => void;
  selectConversation: (id: string, openChat?: boolean) => void;
  setFilter: (filter: MessengerFilter) => void;
  setChannel: (channel: MessengerChannel | "all") => void;
  setSearch: (query: string) => void;
  setResponsible: (responsible: string) => void;
  sendMessage: (conversationId: string, text: string) => void;
  sendAttachment: (conversationId: string, file: File, caption?: string) => Promise<void>;
  refreshConversation: (conversationId: string) => void;
  retryMessage: (conversationId: string, messageId: string) => void;
  retryAttachment: (conversationId: string, attachmentId: string) => void;
  simulateIncoming: () => void;
  toggleImportant: (conversationId: string) => void;
  markAsRead: (conversationId: string) => void;
  setLoadingMode: (enabled: boolean) => void;
  setErrorMode: (enabled: boolean) => void;
  setEmptyMode: (enabled: boolean) => void;
  clearToast: () => void;
};

const MessengerContext = createContext<MessengerContextValue | null>(null);
const MESSENGER_POLL_INTERVAL_MS = 12_000;

function sortConversations(items: Conversation[]) {
  return [...items].sort((a, b) => {
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
    return new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime();
  });
}

function latestInboundMessage(previous: Message[] | undefined, next: Message[]) {
  if (!previous) return null;
  const previousIds = new Set(previous.map((message) => message.id));
  return next.find((message) => message.direction === "inbound" && !previousIds.has(message.id)) ?? null;
}

function toastTextForConversation(conversation: Conversation) {
  return `${channelConfigs[conversation.channel].label}: ${conversation.participantName}`;
}

function toastTextForMessage(message: Message) {
  const text = safeMessageText(message.text);
  return text || "Новое вложение";
}

function isMessagesPagePath(pathname: string) {
  return pathname === "/messages" || pathname === "/crm/messages";
}

export function MessengerProvider({ children }: { children: ReactNode }) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messagesByConversation, setMessagesByConversation] = useState<Record<string, Message[]>>({});
  const [selectedContext, setSelectedContext] = useState<MessengerConversationContext | null>(null);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [widgetView, setWidgetView] = useState<MessengerView>("collapsed");
  const [filter, setFilter] = useState<MessengerFilter>("all");
  const [channel, setChannel] = useState<MessengerChannel | "all">("all");
  const [search, setSearch] = useState("");
  const [responsible, setResponsible] = useState("all");
  const [loading, setLoadingMode] = useState(false);
  const [errorMode, setErrorMode] = useState(false);
  const [emptyMode, setEmptyMode] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [channelStatuses, setChannelStatuses] = useState<Partial<Record<MessengerChannel, ChannelConnectionStatus>>>({});
  const [channelLabels, setChannelLabels] = useState<Partial<Record<MessengerChannel, string>>>({});
  const conversationsRef = useRef<Conversation[]>([]);
  const messagesByConversationRef = useRef<Record<string, Message[]>>({});
  const selectedConversationIdRef = useRef<string | null>(null);
  const hasLoadedConversationsRef = useRef(false);
  const appliedUrlConversationRef = useRef<string | null>(null);
  const pollInFlightRef = useRef(false);
  const telegramSyncInFlightRef = useRef(false);
  const contextRequestIdRef = useRef(0);
  const toastIdsRef = useRef(new Set<string>());

  const showToast = useCallback((next: Toast) => {
    if (toastIdsRef.current.has(next.id)) return;
    toastIdsRef.current.add(next.id);
    if (toastIdsRef.current.size > 120) toastIdsRef.current = new Set(Array.from(toastIdsRef.current).slice(-80));
    setToast(next);
  }, []);

  const loadChannelStatuses = useCallback(async () => {
    try {
      const res = await fetch("/api/messenger/channels", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { channels?: ApiChannel[] };
      const statuses: Partial<Record<MessengerChannel, ChannelConnectionStatus>> = {};
      const labels: Partial<Record<MessengerChannel, string>> = {};
      for (const item of data.channels ?? []) {
        if (!item?.key || !(item.key in channelConfigs)) continue;
        statuses[item.key] = item.connectionStatus;
        labels[item.key] = connectionStatusLabel(item.connectionStatus);
      }
      setChannelStatuses(statuses);
      setChannelLabels(labels);
    } catch {
      // Channel status is cosmetic in the inbox; conversation polling remains the source of truth.
    }
  }, []);

  const syncTelegramUserSession = useCallback(async () => {
    if (channel !== "all" && channel !== "telegram") return;
    if (telegramSyncInFlightRef.current) return;
    telegramSyncInFlightRef.current = true;
    try {
      await fetch("/api/messenger/telegram-user/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 30 }),
      }).catch(() => {});
    } finally {
      telegramSyncInFlightRef.current = false;
    }
  }, [channel]);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  useEffect(() => {
    messagesByConversationRef.current = messagesByConversation;
  }, [messagesByConversation]);

  useEffect(() => {
    selectedConversationIdRef.current = selectedConversationId;
  }, [selectedConversationId]);

  const loadConversations = useCallback(async (options?: { silent?: boolean }) => {
    if (emptyMode) return;
    if (!options?.silent) setLoadingMode(true);
    try {
      void loadChannelStatuses();
      void syncTelegramUserSession();
      const params = new URLSearchParams({ limit: "100" });
      if (filter !== "all") params.set("filter", filter);
      if (channel !== "all") params.set("channel", channel);
      if (search.trim()) params.set("search", search.trim());
      if (responsible !== "all") params.set("assignedTo", responsible);
      const res = await fetch(`/api/messenger/conversations?${params.toString()}`, { cache: "no-store" });
      if (!res.ok) throw new Error("messenger conversations failed");
      const data = (await res.json()) as ConversationsResponse;
      const next = Array.isArray(data.conversations) ? sortConversations(data.conversations) : [];
      if (options?.silent && hasLoadedConversationsRef.current) {
        const previousById = new Map(conversationsRef.current.map((conversation) => [conversation.id, conversation]));
        const updated = next.find((conversation) => {
          const previous = previousById.get(conversation.id);
          if (!previous) return conversation.unreadCount > 0;
          return (
            conversation.unreadCount > previous.unreadCount ||
            (conversation.lastMessageAt !== previous.lastMessageAt && conversation.lastMessageText !== previous.lastMessageText)
          );
        });
        if (updated && updated.id !== selectedConversationIdRef.current) {
          showToast({
            id: `poll-${updated.id}-${updated.lastMessageAt}`,
            text: toastTextForConversation(updated),
          });
        }
      }
      setConversations(next);
      setSelectedConversationId((current) => (current && next.some((item) => item.id === current) ? current : next[0]?.id ?? null));
      hasLoadedConversationsRef.current = true;
      setErrorMode(false);
    } catch {
      setErrorMode(true);
    } finally {
      if (!options?.silent) setLoadingMode(false);
    }
  }, [channel, emptyMode, filter, loadChannelStatuses, responsible, search, showToast, syncTelegramUserSession]);

  const loadMessages = useCallback(async (conversationId: string, options?: { silent?: boolean }) => {
    try {
      const res = await fetch(`/api/messenger/conversations/${encodeURIComponent(conversationId)}/messages`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("messenger messages failed");
      const data = (await res.json()) as MessagesResponse;
      if (!Array.isArray(data.messages)) return;
      const incoming = options?.silent
        ? latestInboundMessage(messagesByConversationRef.current[conversationId], data.messages)
        : null;
      setMessagesByConversation((map) => ({ ...map, [conversationId]: data.messages ?? [] }));
      if (incoming && selectedConversationIdRef.current !== conversationId) {
        showToast({ id: `msg-${incoming.id}`, text: toastTextForMessage(incoming) });
      }
    } catch {
      setMessagesByConversation((map) => ({ ...map, [conversationId]: map[conversationId] ?? [] }));
    }
  }, [showToast]);

  const loadContext = useCallback(async (conversationId: string, options?: { silent?: boolean }) => {
    const requestId = ++contextRequestIdRef.current;
    if (!options?.silent) {
      setSelectedContext((current) => ({
        state: "loading",
        conversationId,
        organizationId: current?.organizationId,
        expectedUpdatedAt: current?.expectedUpdatedAt,
        client: current?.conversationId === conversationId ? current.client : null,
        suggestions: current?.conversationId === conversationId ? current.suggestions : [],
        selectedVehicle: current?.conversationId === conversationId ? current.selectedVehicle : null,
        vehicles: current?.conversationId === conversationId ? current.vehicles : [],
        actions: current?.conversationId === conversationId ? current.actions : [],
      }));
    }
    try {
      const res = await fetch(`/api/messenger/conversations/${encodeURIComponent(conversationId)}/context`, {
        cache: "no-store",
      });
      const data = (await res.json().catch(() => null)) as ContextResponse | null;
      if (!res.ok || !data?.context) throw new Error(data?.error || "context failed");
      if (contextRequestIdRef.current === requestId && selectedConversationIdRef.current === conversationId) {
        setSelectedContext(data.context);
      }
    } catch {
      if (contextRequestIdRef.current === requestId && selectedConversationIdRef.current === conversationId) {
        setSelectedContext({
          state: "error",
          conversationId,
          client: null,
          suggestions: [],
          reason: "Не удалось загрузить CRM-контекст диалога",
        });
      }
    }
  }, []);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    const pollMessenger = async () => {
      if (document.visibilityState === "hidden" || emptyMode || pollInFlightRef.current) return;
      pollInFlightRef.current = true;
      try {
        await loadConversations({ silent: true });
        const activeConversationId = selectedConversationIdRef.current;
        if (activeConversationId) {
          await loadMessages(activeConversationId, { silent: true });
          await loadContext(activeConversationId, { silent: true });
        }
      } finally {
        pollInFlightRef.current = false;
      }
    };

    const intervalId = window.setInterval(() => {
      void pollMessenger();
    }, MESSENGER_POLL_INTERVAL_MS);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void pollMessenger();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [emptyMode, loadContext, loadConversations, loadMessages]);

  const unreadTotal = useMemo(
    () => conversations.reduce((sum, conversation) => sum + conversation.unreadCount, 0),
    [conversations]
  );

  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedConversationId) ?? null,
    [conversations, selectedConversationId]
  );

  useEffect(() => {
    if (!selectedConversationId) {
      setSelectedContext(null);
      return;
    }
    void loadContext(selectedConversationId);
  }, [loadContext, selectedConversationId]);

  useEffect(() => {
    if (typeof window === "undefined" || !("EventSource" in window)) return;
    const params = new URLSearchParams();
    if (selectedConversationId) params.set("conversationId", selectedConversationId);
    const source = new EventSource(`/api/messenger/events${params.toString() ? `?${params.toString()}` : ""}`);
    const refreshActive = () => {
      void loadConversations({ silent: true });
      const activeConversationId = selectedConversationIdRef.current;
      if (activeConversationId) {
        void loadMessages(activeConversationId, { silent: true });
        void loadContext(activeConversationId, { silent: true });
      }
    };
    source.addEventListener("conversation.created", refreshActive);
    source.addEventListener("conversation.updated", refreshActive);
    source.addEventListener("message.created", refreshActive);
    source.addEventListener("message.status_updated", refreshActive);
    source.addEventListener("unread.updated", refreshActive);
    source.onerror = () => {
      source.close();
    };
    return () => source.close();
  }, [loadContext, loadConversations, loadMessages, selectedConversationId]);

  const filteredConversations = useMemo(() => {
    if (emptyMode) return [];
    return sortConversations(conversations);
  }, [conversations, emptyMode]);

  const markAsRead = useCallback((conversationId: string) => {
    setConversations((items) =>
      items.map((conversation) =>
        conversation.id === conversationId ? { ...conversation, unreadCount: 0, status: "open" } : conversation
      )
    );
    void fetch(`/api/messenger/conversations/${encodeURIComponent(conversationId)}/read`, { method: "POST" })
      .then((res) => {
        if (res.ok) void loadConversations({ silent: true });
      })
      .catch(() => {});
  }, [loadConversations]);

  const selectConversation = useCallback(
    (conversationId: string, openChat = true) => {
      setSelectedConversationId(conversationId);
      markAsRead(conversationId);
      void loadMessages(conversationId);
      void loadContext(conversationId);
      if (typeof window !== "undefined" && isMessagesPagePath(window.location.pathname)) {
        const url = new URL(window.location.href);
        url.searchParams.set("conversationId", conversationId);
        window.history.replaceState(null, "", url.toString());
        appliedUrlConversationRef.current = conversationId;
      }
      if (openChat) {
        setWidgetView("chat");
      } else {
        setWidgetView("collapsed");
      }
    },
    [loadContext, loadMessages, markAsRead]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const conversationId = new URLSearchParams(window.location.search).get("conversationId");
    if (!conversationId || appliedUrlConversationRef.current === conversationId || selectedConversationIdRef.current === conversationId) return;
    if (conversations.length && !conversations.some((conversation) => conversation.id === conversationId)) return;
    appliedUrlConversationRef.current = conversationId;
    selectConversation(conversationId, !isMessagesPagePath(window.location.pathname));
  }, [conversations, selectConversation]);

  const openInbox = useCallback(() => {
    setWidgetView((view) => (view === "collapsed" ? "inbox" : "collapsed"));
  }, []);

  const closeWidget = useCallback(() => {
    setWidgetView("collapsed");
  }, []);

  const sendMessage = useCallback((conversationId: string, text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const id = `msg-${Date.now()}`;
    const createdAt = new Date().toISOString();
    const message: Message = {
      id,
      conversationId,
      direction: "outbound",
      authorName: "Анна Лебедева",
      authorType: "employee",
      text: trimmed,
      attachments: [],
      createdAt,
      status: "sending",
    };

    setMessagesByConversation((map) => ({
      ...map,
      [conversationId]: [...(map[conversationId] ?? []), message],
    }));
    setConversations((items) =>
      sortConversations(
        items.map((conversation) =>
          conversation.id === conversationId
            ? { ...conversation, lastMessageText: trimmed, lastMessageAt: createdAt, status: "waiting", unreadCount: 0 }
            : conversation
        )
      )
    );

    void fetch(`/api/messenger/conversations/${encodeURIComponent(conversationId)}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: trimmed }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error("send failed");
        return (await res.json()) as SendMessageResponse;
      })
      .then((data) => {
        setMessagesByConversation((map) => ({
          ...map,
          [conversationId]: (map[conversationId] ?? []).map((item) =>
            item.id === id && data.message ? data.message : item.id === id ? { ...item, status: "sent" } : item
          ),
        }));
        if (data.error) showToast({ id: `send-${Date.now()}`, text: data.error });
        void loadConversations({ silent: true });
      })
      .catch(() => {
        setMessagesByConversation((map) => ({
          ...map,
          [conversationId]: (map[conversationId] ?? []).map((item) =>
            item.id === id ? { ...item, status: "failed" } : item
          ),
        }));
        showToast({ id: `send-failed-${Date.now()}`, text: "Не удалось поставить сообщение в очередь" });
      });
  }, [loadConversations, showToast]);

  const sendAttachment = useCallback(async (conversationId: string, file: File, caption = "") => {
    const createdAt = new Date().toISOString();
    const optimisticType = file.type.startsWith("image/")
      ? "photo"
      : file.type.startsWith("video/")
        ? "video"
        : file.type.startsWith("audio/")
          ? "audio"
          : "document";
    const optimisticId = `upload-${Date.now()}`;
    const objectUrl = optimisticType === "photo" || optimisticType === "video" || optimisticType === "audio" ? URL.createObjectURL(file) : "";
    const optimistic: Message = {
      id: optimisticId,
      conversationId,
      direction: "outbound",
      authorName: "ИП ЕЛИСЕЕНКО ИЛЬЯ СЕРГЕЕВИЧ",
      authorType: "employee",
      text: caption,
      attachments: [
        {
          id: `${optimisticId}-attachment`,
          type: optimisticType,
          name: file.name,
          size: file.size,
          mimeType: file.type || undefined,
          status: "downloading",
          url: objectUrl || undefined,
          previewUrl: objectUrl || undefined,
        },
      ],
      createdAt,
      status: "sending",
    };
    setMessagesByConversation((map) => ({
      ...map,
      [conversationId]: [...(map[conversationId] ?? []), optimistic],
    }));
    const form = new FormData();
    form.set("file", file);
    if (caption.trim()) form.set("caption", caption.trim());
    try {
      const res = await fetch(`/api/messenger/conversations/${encodeURIComponent(conversationId)}/attachments`, {
        method: "POST",
        body: form,
      });
      const data = (await res.json().catch(() => ({}))) as SendAttachmentResponse;
      if (!res.ok) throw new Error(data.error || "attachment upload failed");
      setMessagesByConversation((map) => ({
        ...map,
        [conversationId]: (map[conversationId] ?? []).map((item) =>
          item.id === optimisticId && data.message ? data.message : item.id === optimisticId ? { ...item, status: "sent" } : item
        ),
      }));
      if (data.error) showToast({ id: `attachment-${Date.now()}`, text: data.error });
      void loadConversations({ silent: true });
    } catch (error) {
      setMessagesByConversation((map) => ({
        ...map,
        [conversationId]: (map[conversationId] ?? []).map((item) =>
          item.id === optimisticId
            ? {
                ...item,
                status: "failed",
                attachments: item.attachments.map((attachment) => ({
                  ...attachment,
                  status: "failed",
                  errorMessage: error instanceof Error ? error.message : "Не удалось отправить вложение",
                })),
              }
            : item
        ),
      }));
      showToast({
        id: `attachment-failed-${Date.now()}`,
        text: error instanceof Error ? error.message : "Не удалось отправить вложение",
      });
    } finally {
      if (objectUrl) window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
    }
  }, [loadConversations, showToast]);

  const refreshConversation = useCallback((conversationId: string) => {
    void loadConversations({ silent: true });
    void loadMessages(conversationId, { silent: true });
    void loadContext(conversationId, { silent: true });
  }, [loadContext, loadConversations, loadMessages]);

  const retryMessage = useCallback((conversationId: string, messageId: string) => {
    setMessagesByConversation((map) => ({
      ...map,
      [conversationId]: (map[conversationId] ?? []).map((item) =>
        item.id === messageId ? { ...item, status: "sending" } : item
      ),
    }));
    window.setTimeout(() => {
      setMessagesByConversation((map) => ({
        ...map,
        [conversationId]: (map[conversationId] ?? []).map((item) =>
          item.id === messageId ? { ...item, status: "sent" } : item
        ),
      }));
    }, 600);
  }, []);

  const retryAttachment = useCallback((conversationId: string, attachmentId: string) => {
    setMessagesByConversation((map) => ({
      ...map,
      [conversationId]: (map[conversationId] ?? []).map((message) => ({
        ...message,
        attachments: message.attachments.map((attachment) =>
          attachment.id === attachmentId
            ? { ...attachment, status: "downloading", progress: 0, errorMessage: undefined }
            : attachment
        ),
      })),
    }));
    void fetch(`/api/messenger/attachments/${encodeURIComponent(attachmentId)}/retry`, { method: "POST" })
      .then(async (res) => {
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(data?.error || "Не удалось повторить загрузку вложения");
        }
        window.setTimeout(() => refreshConversation(conversationId), 500);
        window.setTimeout(() => refreshConversation(conversationId), 2500);
      })
      .catch((error) => {
        setMessagesByConversation((map) => ({
          ...map,
          [conversationId]: (map[conversationId] ?? []).map((message) => ({
            ...message,
            attachments: message.attachments.map((attachment) =>
              attachment.id === attachmentId
                ? {
                    ...attachment,
                    status: "failed",
                    errorMessage: error instanceof Error ? error.message : "Не удалось повторить загрузку вложения",
                  }
                : attachment
            ),
          })),
        }));
      });
  }, [refreshConversation]);

  const simulateIncoming = useCallback(() => {
    const targetId = selectedConversationId ?? conversations[0]?.id;
    const target = conversations.find((conversation) => conversation.id === targetId) ?? conversations[0];
    if (!target) return;
    const createdAt = new Date().toISOString();
    const message: Message = {
      id: `incoming-${Date.now()}`,
      conversationId: target.id,
      direction: "inbound",
      authorName: target.participantName,
      authorType: target.kind === "employee" ? "employee" : "client",
      text: "Новое mock-сообщение: прошу подсказать ближайшее свободное время.",
      attachments: [],
      createdAt,
      status: "delivered",
      channelMessageId: `${target.channel}-${Date.now()}`,
    };
    setMessagesByConversation((map) => ({
      ...map,
      [target.id]: [...(map[target.id] ?? []), message],
    }));
    setConversations((items) =>
      sortConversations(
        items.map((conversation) =>
          conversation.id === target.id
            ? {
                ...conversation,
                lastMessageText: message.text,
                lastMessageAt: createdAt,
                unreadCount: widgetView === "chat" && selectedConversationId === target.id ? 0 : conversation.unreadCount + 1,
                status: "needs_reply",
              }
            : conversation
        )
      )
    );
    showToast({ id: message.id, text: toastTextForConversation(target) });
  }, [conversations, selectedConversationId, showToast, widgetView]);

  const toggleImportant = useCallback((conversationId: string) => {
    const current = conversations.find((conversation) => conversation.id === conversationId);
    const nextImportant = !current?.isImportant;
    setConversations((items) =>
      items.map((conversation) =>
        conversation.id === conversationId
          ? { ...conversation, isImportant: nextImportant }
          : conversation
      )
    );
    void fetch(`/api/messenger/conversations/${encodeURIComponent(conversationId)}/important`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ important: nextImportant }),
    }).catch(() => {});
  }, [conversations]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const value = useMemo<MessengerContextValue>(
    () => ({
      conversations,
      messagesByConversation,
      selectedConversationId,
      selectedConversation,
      selectedContext,
      widgetView,
      filter,
      channel,
      search,
      responsible,
      loading,
      errorMode,
      emptyMode,
      toast,
      channelStatuses,
      channelLabels,
      unreadTotal,
      filteredConversations,
      setWidgetView,
      openInbox,
      closeWidget,
      selectConversation,
      setFilter,
      setChannel,
      setSearch,
      setResponsible,
      sendMessage,
      sendAttachment,
      refreshConversation,
      retryMessage,
      retryAttachment,
      simulateIncoming,
      toggleImportant,
      markAsRead,
      setLoadingMode,
      setErrorMode,
      setEmptyMode,
      clearToast: () => setToast(null),
    }),
    [
      conversations,
      messagesByConversation,
      selectedConversationId,
      selectedConversation,
      selectedContext,
      widgetView,
      filter,
      channel,
      search,
      responsible,
      loading,
      errorMode,
      emptyMode,
      toast,
      channelStatuses,
      channelLabels,
      unreadTotal,
      filteredConversations,
      openInbox,
      closeWidget,
      selectConversation,
      sendMessage,
      sendAttachment,
      refreshConversation,
      retryMessage,
      retryAttachment,
      simulateIncoming,
      toggleImportant,
      markAsRead,
    ]
  );

  return <MessengerContext.Provider value={value}>{children}</MessengerContext.Provider>;
}

export function useMessenger() {
  const value = useContext(MessengerContext);
  if (!value) throw new Error("useMessenger must be used inside MessengerProvider");
  return value;
}
