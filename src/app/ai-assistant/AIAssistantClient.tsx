"use client";

import { Bot, ChevronRight, CircleStop, Clipboard, ExternalLink, FileSearch, LoaderCircle, MessageSquarePlus, Send, ShieldCheck, Sparkles, Wrench } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Thread = { id: string; title: string; createdById: string; lastMessageAt: string; createdAt: string; _count?: { messages: number } };
type Message = { id: string; role: "user" | "assistant"; content: string; citationsJson: Citation[]; attachmentsJson: unknown; createdAt: string; runId: string | null };
type Citation = { title: string | null; url: string };
type Quote = { id: string; status: string; vehicleDisplayName: string | null; serviceName: string | null; selectedScenario: string | null; appliedRuleId: string | null; appliedRuleSnapshotJson: unknown; includedItemsJson: unknown; optionalItemsJson: unknown; baseTotalCents: number; maximumTotalCents: number | null; assumptionsJson: unknown; internalWarningsJson: unknown; customerSafeWarningsJson: unknown; validUntil: string | null; isSelected: boolean; createdAt: string };
type Run = { id: string; status: string; model: string; reasoning: string; errorMessage: string | null; inputTokens: number | null; outputTokens: number | null; durationMs: number | null; startedAt: string; completedAt: string | null; cancelledAt: string | null } | null;
type Source = { id: string; sourceType: string; title: string | null; url: string | null; excerpt: string | null; createdAt: string };
type ToolCall = { id: string; toolName: string; status: string; errorMessage: string | null; durationMs: number | null; resultSummary: unknown; startedAt: string };
type ThreadData = { thread: Thread | null; messages: Message[]; latestRun: Run; sources: Source[]; toolCalls: ToolCall[]; quotes: Quote[] };
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
    mandatory_technical_web_search: "Обязательное web-исследование",
    lookup_vehicle: "Определение автомобиля",
    get_vehicle_service_history: "История автомобиля",
    find_mann_filters: "Применяемость MANN",
    search_local_catalog: "Локальный каталог",
    find_service_options: "Поиск стоимости работы",
    search_rossko: "ROSSKO",
    calculate_quote_preview: "Предварительный расчёт",
  };
  return labels[name] || name;
}

function asError(value: unknown) {
  if (value && typeof value === "object" && "error" in value) return String((value as { error?: unknown }).error || "Не удалось выполнить действие");
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

function formatQuotePrice(cents: number) {
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Math.round(cents / 100 / 100) * 100)} ₽`;
}

function formatTokens(value: number) {
  return new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export default function AIAssistantClient() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [data, setData] = useState<ThreadData | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientPreview, setClientPreview] = useState<string | null>(null);
  const [connectionCheck, setConnectionCheck] = useState<OpenAIConnectionCheck | null>(null);
  const [checkingConnection, setCheckingConnection] = useState(false);
  const messageEndRef = useRef<HTMLDivElement | null>(null);

  const loadThreads = useCallback(async () => {
    const response = await fetch("/api/ai-assistant/threads", { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(asError(payload));
    const next = (payload.threads ?? []) as Thread[];
    setThreads(next);
    setActiveThreadId((current) => current && next.some((thread) => thread.id === current) ? current : next[0]?.id ?? null);
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

  const working = sending || data?.latestRun?.status === "running" || data?.latestRun?.status === "queued";
  useEffect(() => {
    if (!activeThreadId || !working) return;
    const timer = window.setInterval(() => { void loadThread(activeThreadId).catch(() => undefined); }, 2_000);
    return () => window.clearInterval(timer);
  }, [activeThreadId, loadThread, working]);

  useEffect(() => { messageEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [data?.messages?.length, working]);

  const createThread = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch("/api/ai-assistant/threads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(asError(payload));
      const thread = payload.thread as Thread;
      setThreads((current) => [thread, ...current]);
      setActiveThreadId(thread.id);
      setDraft("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось создать диалог"); }
  }, []);

  const send = useCallback(async () => {
    const message = draft.trim();
    if (!message || !activeThreadId || working) return;
    setSending(true);
    setError(null);
    setDraft("");
    try {
      const response = await fetch(`/api/ai-assistant/threads/${encodeURIComponent(activeThreadId)}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(asError(payload));
      await Promise.all([loadThread(activeThreadId), loadThreads()]);
    } catch (reason) {
      setDraft(message);
      setError(reason instanceof Error ? reason.message : "Не удалось отправить запрос");
      await loadThread(activeThreadId).catch(() => undefined);
    } finally { setSending(false); }
  }, [activeThreadId, draft, loadThread, loadThreads, working]);

  const requestClientMessage = useCallback(async (quoteId: string, mode: "short_with_price" | "short_without_price" | "detailed_with_price" | "only_final_price") => {
    if (!activeThreadId || working) return;
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
  }, [activeThreadId, loadThread, loadThreads, working]);

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
          <div className="eco-aiw-sidebar__head"><strong>Диалоги</strong><button type="button" className="eco-aiw-icon-button" onClick={() => void createThread()} title="Новый диалог" aria-label="Новый диалог"><MessageSquarePlus size={18} /></button></div>
          <button type="button" className="eco-aiw-new" onClick={() => void createThread()}><Sparkles size={17} /> Новый запрос</button>
          <div className="eco-aiw-thread-list">
            {threads.map((thread) => <button type="button" key={thread.id} className={`eco-aiw-thread ${thread.id === activeThreadId ? "is-active" : ""}`} onClick={() => setActiveThreadId(thread.id)}><span>{thread.title}</span><small>{formatTime(thread.lastMessageAt)} · {thread._count?.messages ?? 0}</small></button>)}
            {!loading && threads.length === 0 && <p className="eco-aiw-empty-list">Создайте первый диалог, чтобы начать проверку.</p>}
          </div>
        </aside>

        <section className="eco-aiw-chat">
          <div className="eco-aiw-chat__head"><div><strong>{data?.thread?.title ?? "Новый диалог"}</strong><span><Bot size={15} /> {runLabel(data?.latestRun ?? null)}</span></div>{working && <button type="button" className="eco-aiw-stop" onClick={() => void cancel()}><CircleStop size={16} /> Остановить</button>}</div>
          <div className="eco-aiw-messages">
            {loading && <div className="eco-aiw-loading"><LoaderCircle size={19} /> Загружаем рабочее пространство…</div>}
            {!loading && !activeThreadId && <div className="eco-aiw-welcome"><Bot size={28} /><h2>Задайте рабочий вопрос</h2><p>Помощник сам выберет нужные проверки, но сохранит их источники и журнал инструментов.</p></div>}
            {!loading && activeThreadId && messages.length === 0 && <div className="eco-aiw-welcome"><FileSearch size={28} /><h2>Новый внутренний диалог</h2><p>Например, найдите клиентскую историю, проверьте артикул, определите автомобиль или соберите предварительный расчёт.</p><div className="eco-aiw-starters">{starterPrompts.map((item) => <button key={item} type="button" onClick={() => setDraft(item)}>{item}<ChevronRight size={15} /></button>)}</div></div>}
            {messages.map((message) => {
              const quoteIds = quoteIdsForMessage(message);
              const linkedQuotes = quoteIds.map((id) => quotes.find((quote) => quote.id === id)).filter((quote): quote is Quote => Boolean(quote));
              const isClientMessage = attachmentKind(message) === "client_message" && Boolean(clientQuoteId(message));
              const isMissingQuote = attachmentKind(message) === "missing_quote";
              return <article key={message.id} className={`eco-aiw-message is-${message.role}`}>
                <div className="eco-aiw-message__meta">{message.role === "assistant" ? "ИИ-помощник" : "Вы"} · {formatTime(message.createdAt)}</div>
                <div className="eco-aiw-message__body">{message.content}</div>
                {linkedQuotes.map((quote) => <div className="eco-aiw-quote-actions" key={quote.id}>
                  <div className="eco-aiw-quote-actions__summary"><strong>Готовый расчёт</strong><span>{quote.vehicleDisplayName || "Автомобиль уточняется"} · {quote.serviceName || "Работа уточняется"}</span><b>{quote.maximumTotalCents && quote.maximumTotalCents > quote.baseTotalCents ? `от ${formatQuotePrice(quote.baseTotalCents)} до ${formatQuotePrice(quote.maximumTotalCents)}` : formatQuotePrice(quote.baseTotalCents)}</b></div>
                  {asObject(quote.appliedRuleSnapshotJson).name ? <p className="eco-aiw-quote-actions__rule">Тариф: {String(asObject(quote.appliedRuleSnapshotJson).name)} · {String(asObject(quote.appliedRuleSnapshotJson).selectionReason || "применённое правило")}</p> : null}
                  {quote.status === "draft" ? <div className="eco-aiw-quote-actions__buttons">
                    <button type="button" onClick={() => void requestClientMessage(quote.id, "short_with_price")} disabled={working}>Короткое сообщение</button>
                    <button type="button" onClick={() => void requestClientMessage(quote.id, "short_with_price")} disabled={working}>С расчётом</button>
                    <button type="button" onClick={() => void requestClientMessage(quote.id, "short_without_price")} disabled={working}>Без расчёта</button>
                    <button type="button" onClick={() => void requestClientMessage(quote.id, "detailed_with_price")} disabled={working}>Подробное сообщение</button>
                    <button type="button" onClick={() => setDraft("Добавь рекомендацию к сообщению клиенту: ")}>Добавить рекомендацию</button>
                  </div> : <p className="eco-aiw-quote-actions__missing">Для клиентского текста в этом расчёте нужно указать автомобиль и название работы.</p>}
                  {Array.isArray(quote.internalWarningsJson) && quote.internalWarningsJson.length > 0 && <p className="eco-aiw-quote-actions__warning">Внутреннее замечание — не включено в сообщение клиенту.</p>}
                </div>)}
                {isClientMessage && <div className="eco-aiw-client-message-actions"><button type="button" onClick={() => void copyText(message.content)}><Clipboard size={14} /> Скопировать</button><button type="button" onClick={() => openCrmPreview(message.content)}>Открыть в CRM-диалоге</button></div>}
                {isMissingQuote && <div className="eco-aiw-client-message-actions"><button type="button" onClick={() => setDraft("Выполни технический подбор и предварительный расчёт по текущему запросу")}>Рассчитать</button></div>}
                {message.citationsJson?.length > 0 && <div className="eco-aiw-inline-sources">{message.citationsJson.map((citation) => <a key={citation.url} href={citation.url} target="_blank" rel="noreferrer"><ExternalLink size={13} /> {citation.title || new URL(citation.url).hostname}</a>)}</div>}
              </article>;
            })}
            {working && <div className="eco-aiw-thinking"><LoaderCircle size={17} /> Идёт исследование: web-поиск, каталоги и источники появятся справа.</div>}
            <div ref={messageEndRef} />
          </div>
          <form className="eco-aiw-composer" onSubmit={(event) => { event.preventDefault(); void send(); }}><textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); void send(); } }} disabled={!activeThreadId || working} placeholder={activeThreadId ? "Напишите рабочий запрос…" : "Создайте диалог слева"} rows={3} /><button type="submit" disabled={!draft.trim() || !activeThreadId || working}><Send size={18} /> Отправить</button><small>⌘/Ctrl + Enter — отправить</small></form>
          {clientPreview && <section className="eco-aiw-client-preview" aria-label="Предпросмотр сообщения для CRM"><div><strong>Предпросмотр для CRM</strong><span>Текст ещё не отправлен клиенту.</span></div><textarea value={clientPreview} onChange={(event) => setClientPreview(event.target.value)} rows={5} /><footer><button type="button" onClick={() => void copyText(clientPreview)}><Clipboard size={14} /> Скопировать</button><button type="button" className="is-primary" onClick={openCrmDialog}>Открыть в CRM-диалоге</button><button type="button" onClick={() => setClientPreview(null)}>Закрыть</button></footer></section>}
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
