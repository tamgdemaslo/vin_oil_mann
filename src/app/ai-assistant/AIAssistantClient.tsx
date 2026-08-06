"use client";

import { Archive, ArchiveRestore, Bot, Building2, ChevronRight, CircleStop, Clipboard, ExternalLink, FileSearch, LoaderCircle, MessageSquarePlus, Send, ShieldCheck, Sparkles, Wrench } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AIAssistantAnswerRenderer, { type AIServiceQuote } from "./AIAssistantAnswerRenderer";
import { parseAIAssistantStructuredResponse, type AIAssistantStructuredResponse } from "@/lib/ai-assistant/structured-response";

type Thread = { id: string; branchId: string; title: string; status: "active" | "archived"; createdById: string; lastMessageAt: string; createdAt: string; _count?: { messages: number } };
type Message = { id: string; role: "user" | "assistant"; content: string; citationsJson: Citation[]; attachmentsJson: unknown; createdAt: string; runId: string | null };
type Citation = { title: string | null; url: string };
type Quote = AIServiceQuote & { appliedRuleId: string | null; isSelected: boolean; createdAt: string };
type Run = { id: string; status: string; model: string; reasoning: string; errorMessage: string | null; inputTokens: number | null; outputTokens: number | null; durationMs: number | null; startedAt: string; completedAt: string | null; cancelledAt: string | null } | null;
type Source = { id: string; sourceType: string; title: string | null; url: string | null; excerpt: string | null; createdAt: string };
type ToolCall = { id: string; toolName: string; status: string; errorMessage: string | null; durationMs: number | null; resultSummary: unknown; startedAt: string };
type ThreadData = { thread: Thread | null; branch?: ActiveBranch; messages: Message[]; latestRun: Run; sources: Source[]; toolCalls: ToolCall[]; quotes: Quote[] };
type ActiveBranch = { id: string; name: string };
type BranchChoice = { id: string; name: string };
type OpenAIConnectionCheck = { ok: boolean; proxyConfigured: boolean; status?: number; timeoutMs: number; error?: string };

const starterPrompts = [
  "Сделай расчёт замены масла в АКПП по VIN и подготовь текст клиенту",
  "Подбери фильтры MANN и аналоги по автомобилю",
  "Проверь OEM-номер, наличие локально и предложения ROSSKO",
  "Собери предварительный расчёт обслуживания под ключ",
];

function formatTime(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function runLabel(run: Run) {
  if (!run) return "Готов к работе";
  if (run.status === "running" || run.status === "queued") return "Проверяем данные";
  if (run.status === "completed") return "Проверка завершена";
  if (run.status === "incomplete_research") return "Интернет-поиск не завершён";
  if (run.status === "cancelled") return "Остановлено";
  return "Нужна проверка";
}

function toolLabel(name: string) {
  const labels: Record<string, string> = {
    mandatory_technical_web_search: "Техническое web-исследование",
    lookup_vehicle: "Определение автомобиля",
    get_vehicle_service_history: "История автомобиля",
    find_mann_filters: "Применяемость MANN",
    search_local_catalog: "Локальный каталог",
    find_service_options: "Поиск стоимости работы",
    search_rossko: "ROSSKO",
    calculate_quote_preview: "Предварительный расчёт",
    calculate_service_quote_v2: "Расчёт материалов и работы",
  };
  return labels[name] || name;
}

function asError(value: unknown) {
  if (value && typeof value === "object" && "error" in value) {
    const data = value as { error?: unknown; code?: unknown };
    const code = String(data.code || "");
    if (code === "BRANCH_SELECTION_REQUIRED") return "Выберите филиал для нового диалога ИИ-помощника.";
    if (code === "ROSSKO_NOT_CONFIGURED") return "ROSSKO не подключён для этого филиала. Настройте его в Кабинете → Интеграции.";
    if (code === "ROSSKO_AUTH_FAILED") return "ROSSKO не принял ключи выбранного филиала.";
    if (code === "ROSSKO_TEMPORARILY_UNAVAILABLE") return "ROSSKO временно недоступен. Повторите попытку позже.";
    if (code === "ROSSKO_NO_RESULTS") return "ROSSKO не нашёл предложений по этому номеру.";
    return String(data.error || "Не удалось выполнить действие");
  }
  return "Не удалось выполнить действие";
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function attachmentKind(message: Message) {
  return String(asObject(message.attachmentsJson).kind || "");
}

function quoteIdsForMessage(message: Message) {
  const quoteIds = asObject(message.attachmentsJson).quoteIds;
  return Array.isArray(quoteIds) ? quoteIds.filter((item): item is string => typeof item === "string") : [];
}

function clientQuoteId(message: Message) {
  const quoteId = asObject(message.attachmentsJson).quoteId;
  return typeof quoteId === "string" ? quoteId : null;
}

function formatTokens(value: number) {
  return new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function structuredResponseForMessage(message: Message): AIAssistantStructuredResponse | undefined {
  const parsed = parseAIAssistantStructuredResponse(asObject(message.attachmentsJson).structuredResponse);
  if (parsed) return parsed;
  if (attachmentKind(message) !== "client_message") return undefined;
  return { summaryMarkdown: "", confirmed: [], assumptions: [], requiresVerification: [], recommendations: [], clientMessage: message.content };
}

export default function AIAssistantClient() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [archivedThreads, setArchivedThreads] = useState<Thread[]>([]);
  const [threadListMode, setThreadListMode] = useState<"active" | "archived">("active");
  const [activeBranch, setActiveBranch] = useState<ActiveBranch | null>(null);
  const [branchChoices, setBranchChoices] = useState<BranchChoice[]>([]);
  const [branchSelectionRequired, setBranchSelectionRequired] = useState(false);
  const [pendingBranchMessage, setPendingBranchMessage] = useState<string | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [data, setData] = useState<ThreadData | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientPreview, setClientPreview] = useState<string | null>(null);
  const [connectionCheck, setConnectionCheck] = useState<OpenAIConnectionCheck | null>(null);
  const [checkingConnection, setCheckingConnection] = useState(false);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  const loadThreads = useCallback(async () => {
    const response = await fetch("/api/ai-assistant/threads", { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (payload?.code === "BRANCH_SELECTION_REQUIRED") {
        setBranchSelectionRequired(true);
        setBranchChoices(Array.isArray(payload.branches) ? payload.branches.filter((branch: unknown): branch is BranchChoice => Boolean(branch && typeof branch === "object" && typeof (branch as BranchChoice).id === "string" && typeof (branch as BranchChoice).name === "string")) : []);
        setActiveBranch(null);
        setThreads([]);
        setArchivedThreads([]);
        return [];
      }
      throw new Error(asError(payload));
    }
    const next = (payload.threads ?? []) as Thread[];
    const nextArchived = (payload.archivedThreads ?? []) as Thread[];
    setActiveBranch(payload.branch && typeof payload.branch.name === "string" ? payload.branch as ActiveBranch : null);
    setBranchSelectionRequired(false);
    setBranchChoices([]);
    setThreads(next);
    setArchivedThreads(nextArchived);
    return next;
  }, []);

  const loadThread = useCallback(async (threadId: string) => {
    const response = await fetch(`/api/ai-assistant/threads/${encodeURIComponent(threadId)}`, { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(asError(payload));
    setData(payload as ThreadData);
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try { await loadThreads(); } catch (reason) { if (alive) setError(reason instanceof Error ? reason.message : "Не удалось загрузить ИИ-помощника"); } finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [loadThreads]);

  useEffect(() => {
    if (!activeThreadId) { setData(null); return; }
    void loadThread(activeThreadId).catch((reason) => setError(reason instanceof Error ? reason.message : "Не удалось открыть диалог"));
  }, [activeThreadId, loadThread]);

  useEffect(() => {
    const visibleThreads = threadListMode === "archived" ? archivedThreads : threads;
    setActiveThreadId((current) => current && visibleThreads.some((thread) => thread.id === current) ? current : visibleThreads[0]?.id ?? null);
  }, [archivedThreads, threadListMode, threads]);

  const working = sending || data?.latestRun?.status === "running" || data?.latestRun?.status === "queued";
  const visibleThreads = threadListMode === "archived" ? archivedThreads : threads;
  const activeThread = [...threads, ...archivedThreads].find((thread) => thread.id === activeThreadId) ?? null;
  const activeThreadIsArchived = activeThread?.status === "archived";
  const chatBranch = data?.branch ?? activeBranch;
  const chatBranchChanged = Boolean(data?.branch && activeBranch && data.branch.id !== activeBranch.id);
  useEffect(() => {
    if (!activeThreadId || !working) return;
    const timer = window.setInterval(() => { void loadThread(activeThreadId).catch(() => undefined); }, 2_000);
    return () => window.clearInterval(timer);
  }, [activeThreadId, loadThread, working]);

  useEffect(() => {
    const messagesElement = messagesRef.current;
    if (!messagesElement) return;
    messagesElement.scrollTo({ top: messagesElement.scrollHeight, behavior: "smooth" });
  }, [activeThreadId, data?.messages?.length, working]);

  const focusComposer = useCallback(() => {
    window.requestAnimationFrame(() => composerRef.current?.focus());
  }, []);

  const createThread = useCallback(async (branchId?: string) => {
    setError(null);
    try {
      const response = await fetch("/api/ai-assistant/threads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(branchId ? { branchId } : {}) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(asError(payload));
      const thread = payload.thread as Thread;
      setThreads((current) => [thread, ...current]);
      setThreadListMode("active");
      setActiveThreadId(thread.id);
      setData(null);
      setDraft("");
      focusComposer();
      return thread;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось создать диалог");
      return null;
    }
  }, [focusComposer]);

  const startThreadForBranch = useCallback(async (branch: BranchChoice) => {
    const message = pendingBranchMessage;
    setPendingBranchMessage(null);
    const thread = await createThread(branch.id);
    if (!thread || !message) return;
    setSending(true);
    try {
      const response = await fetch(`/api/ai-assistant/threads/${encodeURIComponent(thread.id)}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(asError(payload));
      await Promise.all([loadThread(thread.id), loadThreads()]);
    } catch (reason) {
      setDraft(message);
      setError(reason instanceof Error ? reason.message : "Не удалось отправить запрос");
    } finally {
      setSending(false);
    }
  }, [createThread, loadThread, loadThreads, pendingBranchMessage]);

  const send = useCallback(async () => {
    const message = draft.trim();
    if (!message || working || activeThreadIsArchived) return;
    if (!activeThreadId && branchSelectionRequired) {
      setPendingBranchMessage(message);
      setDraft("");
      return;
    }
    let requestedThreadId = activeThreadId;
    setSending(true);
    setError(null);
    setDraft("");
    try {
      const thread = activeThreadId ? { id: activeThreadId } : await createThread();
      if (!thread) {
        setDraft(message);
        return;
      }
      requestedThreadId = thread.id;
      const response = await fetch(`/api/ai-assistant/threads/${encodeURIComponent(thread.id)}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(asError(payload));
      await Promise.all([loadThread(thread.id), loadThreads()]);
    } catch (reason) {
      setDraft(message);
      setError(reason instanceof Error ? reason.message : "Не удалось отправить запрос");
      if (requestedThreadId) await loadThread(requestedThreadId).catch(() => undefined);
    } finally { setSending(false); }
  }, [activeThreadId, activeThreadIsArchived, branchSelectionRequired, createThread, draft, loadThread, loadThreads, working]);

  const requestClientMessage = useCallback(async (quoteId: string, mode: "short_with_price" | "short_without_price" | "detailed_with_price" | "only_final_price") => {
    if (!activeThreadId || working || activeThreadIsArchived) return;
    const labels = { short_with_price: "Короткое сообщение для клиента с расчётом", short_without_price: "Короткое сообщение для клиента без цены", detailed_with_price: "Подробное сообщение для клиента с расчётом", only_final_price: "Только итоговая цена для клиента" };
    setSending(true);
    setError(null);
    try {
      const response = await fetch(`/api/ai-assistant/threads/${encodeURIComponent(activeThreadId)}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: labels[mode], selectedQuoteId: quoteId, clientMessageMode: mode }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(asError(payload));
      await Promise.all([loadThread(activeThreadId), loadThreads()]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось подготовить клиентский текст");
    } finally { setSending(false); }
  }, [activeThreadId, activeThreadIsArchived, loadThread, loadThreads, working]);

  const copyText = useCallback(async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      setError("Не удалось скопировать текст. Выделите его вручную.");
    }
  }, []);

  const openCrmPreview = useCallback((value: string) => {
    setClientPreview(value);
  }, []);

  const openCrmDialog = useCallback(() => {
    if (!clientPreview) return;
    window.localStorage.setItem("eco:crm-draft", clientPreview);
    window.location.assign("/messages");
  }, [clientPreview]);

  const cancel = useCallback(async () => {
    if (!activeThreadId) return;
    try {
      await fetch(`/api/ai-assistant/threads/${encodeURIComponent(activeThreadId)}/cancel`, { method: "POST" });
      await loadThread(activeThreadId);
    } catch { setError("Не удалось остановить текущую проверку"); }
  }, [activeThreadId, loadThread]);

  const setThreadStatus = useCallback(async (thread: Thread, status: "active" | "archived") => {
    try {
      setError(null);
      const response = await fetch(`/api/ai-assistant/threads/${encodeURIComponent(thread.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(asError(payload));
      const updated = payload.thread as Thread;

      if (status === "archived") {
        const remainingThreads = threads.filter((item) => item.id !== thread.id);
        setThreads(remainingThreads);
        setArchivedThreads((current) => [updated, ...current.filter((item) => item.id !== thread.id)]);
        if (activeThreadId === thread.id) {
          setData(null);
          setActiveThreadId(remainingThreads[0]?.id ?? null);
        }
      } else {
        setArchivedThreads((current) => current.filter((item) => item.id !== thread.id));
        setThreads((current) => [updated, ...current.filter((item) => item.id !== thread.id)]);
        setThreadListMode("active");
        setData(null);
        setActiveThreadId(updated.id);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось изменить статус диалога");
    }
  }, [activeThreadId, threads]);

  const checkOpenAIConnection = useCallback(async () => {
    setCheckingConnection(true);
    setConnectionCheck(null);
    try {
      const response = await fetch("/api/ai-assistant/network-check", { cache: "no-store" });
      const payload = await response.json().catch(() => null) as OpenAIConnectionCheck | null;
      if (!response.ok || !payload) throw new Error("Не удалось проверить соединение");
      setConnectionCheck(payload);
    } catch (reason) {
      setConnectionCheck({ ok: false, proxyConfigured: false, timeoutMs: 8_000, error: reason instanceof Error ? reason.message : "Не удалось проверить соединение" });
    } finally {
      setCheckingConnection(false);
    }
  }, []);

  const sourceList = useMemo(() => data?.sources ?? [], [data?.sources]);
  const messages = data?.messages ?? [];
  const quotes = data?.quotes ?? [];
  const toolCalls = data?.toolCalls ?? [];

  return (
    <main className="eco-page eco-page--wide eco-aiw-page">
      <header className="eco-page-head eco-aiw-page__head">
        <div>
          <div className="eco-page-kicker">Рабочее пространство / ИИ-помощник</div>
          <h1 className="eco-page-title">ИИ-помощник</h1>
          <p className="eco-page-subtitle">Внутренний эксперт для поиска, проверки данных и предварительных расчётов. Ничего не отправляет клиентам и не меняет учёт.</p>
        </div>
        <div className="eco-aiw-guard"><ShieldCheck size={17} aria-hidden /> Только чтение · owner/admin</div>
      </header>

      {error && <div className="eco-aiw-error" role="alert">{error}<button type="button" onClick={() => setError(null)}>Закрыть</button></div>}

      <section className="eco-aiw-shell" aria-label="Рабочий чат ИИ-помощника">
        <aside className="eco-aiw-sidebar">
          <div className="eco-aiw-sidebar__head"><strong>Диалоги</strong><button type="button" className="eco-aiw-icon-button" onClick={() => branchSelectionRequired ? setError("Выберите филиал для нового диалога.") : void createThread()} title="Новый диалог" aria-label="Новый диалог"><MessageSquarePlus size={18} /></button></div>
          <button type="button" className="eco-aiw-new" onClick={() => branchSelectionRequired ? setError("Выберите филиал для нового диалога.") : void createThread()}><Sparkles size={17} /> Новый запрос</button>
          <div className="eco-aiw-list-tabs" role="tablist" aria-label="Список диалогов">
            <button type="button" role="tab" aria-selected={threadListMode === "active"} className={threadListMode === "active" ? "is-active" : ""} onClick={() => setThreadListMode("active")}>Активные <span>{threads.length}</span></button>
            <button type="button" role="tab" aria-selected={threadListMode === "archived"} className={threadListMode === "archived" ? "is-active" : ""} onClick={() => setThreadListMode("archived")}>Архив <span>{archivedThreads.length}</span></button>
          </div>
          <div className="eco-aiw-thread-list">
            {visibleThreads.map((thread) => <div key={thread.id} className="eco-aiw-thread-row">
              <button type="button" className={`eco-aiw-thread ${thread.id === activeThreadId ? "is-active" : ""}`} onClick={() => { setData(null); setActiveThreadId(thread.id); }}><span>{thread.title}</span><small>{formatTime(thread.lastMessageAt)} · {thread._count?.messages ?? 0}</small></button>
              <button type="button" className="eco-aiw-thread-action" onClick={() => void setThreadStatus(thread, thread.status === "archived" ? "active" : "archived")} disabled={thread.id === activeThreadId && working} title={thread.status === "archived" ? "Вернуть из архива" : "Архивировать"} aria-label={thread.status === "archived" ? `Вернуть «${thread.title}» из архива` : `Архивировать «${thread.title}»`}>
                {thread.status === "archived" ? <ArchiveRestore size={16} /> : <Archive size={16} />}
              </button>
            </div>)}
            {!loading && visibleThreads.length === 0 && <p className="eco-aiw-empty-list">{threadListMode === "archived" ? "Архив пока пуст." : "Напишите вопрос внизу — первый диалог создастся автоматически."}</p>}
          </div>
        </aside>

        <section className="eco-aiw-chat">
          <div className="eco-aiw-chat__head"><div><strong>{data?.thread?.title ?? activeThread?.title ?? "Новый диалог"}</strong><span><Bot size={15} /> {activeThreadIsArchived ? "В архиве" : runLabel(data?.latestRun ?? null)} · <Building2 size={14} /> {chatBranch?.name ?? "Филиал не выбран"}</span></div>{working && <button type="button" className="eco-aiw-stop" onClick={() => void cancel()}><CircleStop size={16} /> Остановить</button>}</div>
          <div ref={messagesRef} className="eco-aiw-messages">
            {loading && <div className="eco-aiw-loading"><LoaderCircle size={19} /> Загружаем рабочее пространство…</div>}
            {chatBranchChanged && <div className="eco-aiw-branch-notice"><Building2 size={16} /><span>Этот чат относится к филиалу «{data?.branch?.name}». Переключение в шапке не меняет его данные.</span>{activeBranch && <button type="button" onClick={() => void createThread()}>Новый чат в «{activeBranch.name}»</button>}</div>}
            {!loading && branchSelectionRequired && !activeThreadId && <div className="eco-aiw-welcome"><Building2 size={28} /><h2>Выберите филиал</h2><p>Новый чат и поиск ROSSKO будут закреплены за выбранным филиалом. Уже открытые диалоги не меняют свою привязку.</p><div className="eco-aiw-branch-choices">{branchChoices.map((branch) => <button key={branch.id} type="button" onClick={() => void startThreadForBranch(branch)}>{branch.name}<ChevronRight size={15} /></button>)}</div></div>}
            {!loading && !branchSelectionRequired && !activeThreadId && <div className="eco-aiw-welcome"><Bot size={28} /><h2>Задайте рабочий вопрос</h2><p>Помощник сам выберет нужные проверки, но сохранит их источники и журнал инструментов.</p></div>}
            {!loading && activeThreadId && !activeThreadIsArchived && messages.length === 0 && <div className="eco-aiw-welcome"><FileSearch size={28} /><h2>Новый внутренний диалог</h2><p>Например, найдите клиентскую историю, проверьте артикул, определите автомобиль или соберите предварительный расчёт.</p><div className="eco-aiw-starters">{starterPrompts.map((item) => <button key={item} type="button" onClick={() => { setDraft(item); focusComposer(); }}>{item}<ChevronRight size={15} /></button>)}</div></div>}
            {!loading && activeThreadId && activeThreadIsArchived && messages.length === 0 && <div className="eco-aiw-welcome"><Archive size={28} /><h2>Диалог в архиве</h2><p>Он сохранён для просмотра. Верните его из архива в списке слева, если нужно продолжить работу.</p></div>}
            {messages.map((message) => {
              const quoteIds = quoteIdsForMessage(message);
              const linkedQuotes = quoteIds.map((id) => quotes.find((quote) => quote.id === id)).filter((quote): quote is Quote => Boolean(quote));
              const isClientMessage = attachmentKind(message) === "client_message" && Boolean(clientQuoteId(message));
              const isMissingQuote = attachmentKind(message) === "missing_quote";
              const structuredResponse = structuredResponseForMessage(message);
              return <article key={message.id} className={`eco-aiw-message is-${message.role}`}>
                <div className="eco-aiw-message__meta">{message.role === "assistant" ? "ИИ-помощник" : "Вы"} · {formatTime(message.createdAt)}</div>
                {message.role === "assistant" ? <AIAssistantAnswerRenderer
                  content={message.content}
                  structuredResponse={structuredResponse}
                  status="completed"
                  sources={(message.citationsJson ?? []).map((citation) => ({ title: citation.title, url: citation.url, sourceType: "web" }))}
                  quote={linkedQuotes[0]}
                /> : <div className="eco-aiw-message__body">{message.content}</div>}
                {linkedQuotes.slice(1).map((quote) => <AIAssistantAnswerRenderer key={quote.id} content="" status="completed" quote={quote} />)}
                {linkedQuotes.map((quote) => <div className="eco-aiw-quote-actions" key={quote.id}>
                  {quote.status === "draft" ? <div className="eco-aiw-quote-actions__buttons">
                    <button type="button" onClick={() => void requestClientMessage(quote.id, "short_with_price")} disabled={working || activeThreadIsArchived}>Короткое сообщение</button>
                    <button type="button" onClick={() => void requestClientMessage(quote.id, "short_with_price")} disabled={working || activeThreadIsArchived}>С расчётом</button>
                    <button type="button" onClick={() => void requestClientMessage(quote.id, "short_without_price")} disabled={working || activeThreadIsArchived}>Без расчёта</button>
                    <button type="button" onClick={() => void requestClientMessage(quote.id, "detailed_with_price")} disabled={working || activeThreadIsArchived}>Подробное сообщение</button>
                    <button type="button" onClick={() => setDraft("Добавь рекомендацию к сообщению клиенту: ")} disabled={activeThreadIsArchived}>Добавить рекомендацию</button>
                  </div> : <p className="eco-aiw-quote-actions__missing">Для клиентского текста в этом расчёте нужно указать автомобиль и название работы.</p>}
                  {Array.isArray(quote.internalWarningsJson) && quote.internalWarningsJson.length > 0 && <p className="eco-aiw-quote-actions__warning">Внутреннее замечание — не включено в сообщение клиенту.</p>}
                </div>)}
                {isClientMessage && <div className="eco-aiw-client-message-actions"><button type="button" onClick={() => openCrmPreview(message.content)}>Открыть в CRM-диалоге</button></div>}
                {isMissingQuote && <div className="eco-aiw-client-message-actions"><button type="button" onClick={() => setDraft("Выполни технический подбор и предварительный расчёт по текущему запросу")}>Рассчитать</button></div>}
              </article>;
            })}
            {clientPreview && <section className="eco-aiw-client-preview" aria-label="Предпросмотр сообщения для CRM"><div><strong>Предпросмотр для CRM</strong><span>Текст ещё не отправлен клиенту.</span></div><textarea value={clientPreview} onChange={(event) => setClientPreview(event.target.value)} rows={5} /><footer><button type="button" onClick={() => void copyText(clientPreview)}><Clipboard size={14} /> Скопировать</button><button type="button" className="is-primary" onClick={openCrmDialog}>Открыть в CRM-диалоге</button><button type="button" onClick={() => setClientPreview(null)}>Закрыть</button></footer></section>}
            {working && <div className="eco-aiw-thinking"><LoaderCircle size={17} /> Идёт исследование: web-поиск, каталоги и источники появятся справа.</div>}
          </div>
          <form className="eco-aiw-composer" onSubmit={(event) => { event.preventDefault(); void send(); }}><textarea ref={composerRef} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); void send(); } }} disabled={working || activeThreadIsArchived} placeholder={activeThreadIsArchived ? "Диалог в архиве — восстановите его, чтобы продолжить" : branchSelectionRequired && !activeThreadId ? "Напишите вопрос, затем выберите филиал…" : activeThreadId ? "Напишите рабочий запрос…" : "Напишите вопрос — новый диалог создастся автоматически"} rows={3} /><button type="submit" disabled={!draft.trim() || working || activeThreadIsArchived}><Send size={18} /> Отправить</button><small>{activeThreadIsArchived ? "Архивный диалог доступен только для просмотра." : branchSelectionRequired && !activeThreadId ? "После отправки выберите филиал — запрос продолжится автоматически." : activeThreadId ? "⌘/Ctrl + Enter — отправить" : "⌘/Ctrl + Enter — создать диалог и отправить"}</small></form>
        </section>

        <aside className="eco-aiw-evidence">
          <section><div className="eco-aiw-evidence__title"><Wrench size={16} /><strong>Trace исследования</strong></div>{data?.latestRun ? <div className={`eco-aiw-run is-${data.latestRun.status}`}><strong>{runLabel(data.latestRun)}</strong><span>{data.latestRun.model} · reasoning {data.latestRun.reasoning}</span>{data.latestRun.durationMs != null && <small>{(data.latestRun.durationMs / 1000).toFixed(1)} с</small>}{data.latestRun.inputTokens != null || data.latestRun.outputTokens != null ? <small>Токены: {formatTokens(data.latestRun.inputTokens ?? 0)} вход · {formatTokens(data.latestRun.outputTokens ?? 0)} выход</small> : null}{data.latestRun.errorMessage && <em>{data.latestRun.errorMessage}</em>}</div> : <p className="eco-aiw-side-empty">Запусков пока нет.</p>}
            <div className="eco-aiw-connection-check"><button type="button" onClick={() => void checkOpenAIConnection()} disabled={checkingConnection}>{checkingConnection ? <LoaderCircle size={14} /> : <Wrench size={14} />}{checkingConnection ? "Проверяем маршрут…" : "Проверить соединение OpenAI"}</button>{connectionCheck && <p className={connectionCheck.ok ? "is-ok" : "is-error"}>{connectionCheck.ok ? `HTTPS-маршрут ${connectionCheck.proxyConfigured ? "через WireGuard-прокси " : ""}доступен (HTTP ${connectionCheck.status}).` : connectionCheck.error}</p>}</div>
            <div className="eco-aiw-tool-list">{toolCalls.map((call) => <details key={call.id}><summary><span className={`eco-aiw-tool-dot is-${call.status}`} />{toolLabel(call.toolName)}<small>{call.durationMs != null ? `${(call.durationMs / 1000).toFixed(1)} с` : call.status}</small></summary>{call.errorMessage ? <p className="eco-aiw-tool-error">{call.errorMessage}</p> : call.resultSummary ? <pre>{JSON.stringify(call.resultSummary, null, 2)}</pre> : null}</details>)}</div>
          </section>
          <section><div className="eco-aiw-evidence__title"><ExternalLink size={16} /><strong>Источники</strong><span>{sourceList.length}</span></div>{sourceList.length ? <div className="eco-aiw-source-list">{sourceList.map((source) => <div key={source.id} className="eco-aiw-source"><span>{source.sourceType === "web" ? "WEB" : source.sourceType.toUpperCase()}</span><div><strong>{source.title || "Источник"}</strong>{source.excerpt && <small>{source.excerpt}</small>}{source.url && <a href={source.url} target="_blank" rel="noreferrer">Открыть <ExternalLink size={12} /></a>}</div></div>)}</div> : <p className="eco-aiw-side-empty">Источники появятся после поиска или проверки.</p>}</section>
          <p className="eco-aiw-audit-note">Журнал показывает результаты проверок и ссылки, но не раскрывает внутренние рассуждения модели.</p>
        </aside>
      </section>
    </main>
  );
}
