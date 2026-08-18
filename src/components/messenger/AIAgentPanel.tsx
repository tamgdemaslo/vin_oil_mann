"use client";

import Link from "next/link";
import { Bot, Check, CircleAlert, Hand, LoaderCircle, RotateCcw, Send, ShieldCheck, Sparkles, StopCircle, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMessenger } from "./MessengerProvider";
import type { Conversation } from "./messenger-data";

type AgentState = "off" | "idle" | "running" | "waiting_client" | "needs_approval" | "handoff" | "human" | "error";

type AgentStatus = {
  enabled: boolean;
  configured: boolean;
  hasApiKey: boolean;
  mode: "off" | "suggestions" | "auto_quote_approval" | "auto_booking_approval" | "autonomous";
  agentName: string;
  state: AgentState;
  intent: string | null;
  confidence: number | null;
  draft: string | null;
  pendingApprovals: Array<{ id: string; toolName: string; arguments?: unknown }>;
  latestQuote: { id?: string; status?: string; totalCents?: number | null; vehicleSnapshot?: unknown; requirementsSnapshot?: unknown; sourceEvidence?: unknown; localProductsSnapshot?: unknown; rosskoOffersSnapshot?: unknown; quoteOptions?: unknown; optionalItems?: unknown; validUntil?: string | null; humanReviewReason?: string | null } | null;
  latestHandoff: { reason?: string; summary?: string; status?: string } | null;
  recentToolCalls: Array<{ id: string; toolName: string; status: string; requiresApproval?: boolean; errorMessage?: string | null }>;
  lastError: string | null;
  updatedAt: string | null;
  conversationState: {
    pendingQuestion: string | null;
    vinAvailability: string;
    vehicleConfidence: "HIGH" | "MEDIUM" | "LOW" | null;
    mileage: string | null;
    mileageApproximate: boolean;
    unresolvedItems: string[];
  };
  currentRun: {
    id: string;
    status: "queued" | "running" | "waiting_for_client" | "waiting_for_human" | "completed" | "failed" | "research_failed" | "timed_out" | "cancelled" | "handed_off";
    stage: string | null;
    stageLabel: string | null;
    startedAt: string;
    heartbeatAt: string | null;
    elapsedSeconds: number;
    heartbeatSeconds: number;
    softExceeded: boolean;
    stale: boolean;
    requiresHumanApproval: boolean;
    humanApprovalReason: string | null;
    lastToolName: string | null;
    lastToolStatus: string | null;
    completedStages: string[];
    errorCode: string | null;
    errorMessage: string | null;
    retryCount: number;
    events: Array<{ id: string; eventType: string; stage: string | null; publicLabel: string | null; toolName: string | null; toolStatus: string | null; durationMs: number | null; createdAt: string }>;
  } | null;
};

type StatusResponse = { status?: AgentStatus; error?: string };

const stateLabels: Record<AgentState, string> = {
  off: "выключен",
  idle: "готов",
  running: "готовит ответ",
  waiting_client: "ждёт клиента",
  needs_approval: "нужно подтверждение",
  handoff: "передано сотруднику",
  human: "сотрудник отвечает",
  error: "требует внимания",
};

const modeLabels = {
  off: "Выключен",
  suggestions: "Подсказки",
  auto_quote_approval: "Расчёт с подтверждением",
  auto_booking_approval: "Запись после расчёта",
  autonomous: "Автономный сценарий",
};

const intentLabels: Record<string, string> = {
  engine_oil_change: "замена масла в двигателе",
  transmission_oil_change: "замена масла в коробке",
  filter_lookup: "подбор фильтра",
  quote: "расчёт стоимости",
  book: "запись на обслуживание",
  cancel_appointment: "отмена записи",
  reschedule_appointment: "перенос записи",
  complaint: "жалоба",
  human_request: "просит сотрудника",
  address: "адрес сервиса",
  unknown: "намерение уточняется",
};

const toolLabels: Record<string, string> = {
  get_client_profile: "Проверил карточку клиента",
  resolve_vehicle_by_vin: "Определил автомобиль по VIN",
  resolve_vehicle_by_parameters: "Проверил возможные модификации",
  get_engine_oil_requirements: "Проверил требования к маслу",
  find_required_parts: "Подобрал фильтры",
  search_local_catalog: "Проверил каталог и остатки",
  rossko_search: "Проверил наличие у поставщика",
  calculate_service_quote: "Рассчитал стоимость",
  request_quote_approval: "Подготовил расчёт к подтверждению",
  select_quote_option: "Зафиксировал выбор клиента",
  create_client_case: "Создал дело по запчастям",
  save_vehicle: "Сохранил автомобиль",
  trusted_technical_web_search: "Проверил технические источники",
  get_transmission_requirements: "Проверил требования агрегата",
  get_available_slots: "Проверил свободное время",
  hold_appointment_slot: "Удержал выбранное время",
  create_appointment: "Создал запись",
  handoff_to_human: "Передал диалог сотруднику",
  trusted_vehicle_web_search: "Проверил доверенный источник",
};

function money(cents?: number | null) {
  if (typeof cents !== "number") return null;
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(cents / 100);
}

function approvalLabel(toolName: string) {
  if (toolName === "request_quote_approval") return "Проверить расчёт перед отправкой";
  if (toolName === "create_appointment") return "Создать запись в Эко-платформе";
  if (toolName === "hold_appointment_slot") return "Удержать выбранное время";
  return toolLabels[toolName] ?? "Выполнить действие агента";
}

function safeError(value: unknown, fallback: string) {
  if (value && typeof value === "object" && "error" in value && typeof value.error === "string") return value.error;
  return fallback;
}

function displayAgentError(value: string) {
  if (/Input guardrail triggered:.*tooLarge/i.test(value)) {
    return "Контекст диалога оказался слишком большим. История сокращена — подготовьте ответ ещё раз.";
  }
  return value;
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function duration(seconds: number) {
  const value = Math.max(0, Math.floor(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

function lastActivityText(run: NonNullable<AgentStatus["currentRun"]>) {
  const event = run.events[0];
  if (event?.publicLabel) return event.publicLabel;
  if (run.lastToolName) return toolLabels[run.lastToolName] ?? "Выполняется проверка";
  return run.stageLabel ?? "Подготавливаем следующий шаг";
}

export default function AIAgentPanel({ conversation }: { conversation: Conversation }) {
  const { messagesByConversation, refreshConversation } = useMessenger();
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [liveDraft, setLiveDraft] = useState("");
  const [editedDraft, setEditedDraft] = useState("");
  const statusLoadInFlightRef = useRef(false);

  const latestInbound = useMemo(
    () => [...(messagesByConversation[conversation.id] ?? [])].reverse().find((message) => message.direction === "inbound") ?? null,
    [conversation.id, messagesByConversation]
  );

  const loadStatus = useCallback(async (silent = false) => {
    if (statusLoadInFlightRef.current) return;
    statusLoadInFlightRef.current = true;
    if (!silent) setLoading(true);
    try {
      const response = await fetch(`/api/ai-agent/conversations/${encodeURIComponent(conversation.id)}/status`, { cache: "no-store" });
      const data = (await response.json().catch(() => null)) as StatusResponse | null;
      if (!response.ok || !data?.status) throw new Error(data?.error || "Не удалось получить состояние агента");
      setStatus(data.status);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Не удалось получить состояние агента");
    } finally {
      statusLoadInFlightRef.current = false;
      if (!silent) setLoading(false);
    }
  }, [conversation.id]);

  useEffect(() => {
    setStatus(null);
    setLiveDraft("");
    const refresh = () => {
      if (document.visibilityState === "visible") void loadStatus(true);
    };
    if (document.visibilityState === "visible") void loadStatus();
    const timer = window.setInterval(refresh, 8_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [loadStatus]);

  useEffect(() => {
    setEditedDraft(status?.draft ?? "");
  }, [conversation.id, status?.draft, status?.updatedAt]);

  async function runAgent() {
    const message = latestInbound?.text?.trim() || conversation.lastMessageText.trim();
    if (!message) {
      setError("В диалоге пока нет сообщения клиента для обработки.");
      return;
    }
    setBusy("run");
    setLiveDraft("");
    setError(null);
    try {
      const response = await fetch(`/api/ai-agent/conversations/${encodeURIComponent(conversation.id)}/run?stream=1`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, sourceMessageId: latestInbound?.id }),
      });
      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => null);
        throw new Error(safeError(data, "Агент не смог начать обработку"));
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamed = "";
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";
        for (const block of blocks) {
          const event = block.match(/^event:\s*(.+)$/m)?.[1];
          const raw = block.match(/^data:\s*(.+)$/m)?.[1];
          if (!raw) continue;
          const payload = JSON.parse(raw) as { chunk?: string; error?: string; outputText?: string };
          if (event === "text" && payload.chunk) {
            streamed += payload.chunk;
            setLiveDraft(streamed);
            setEditedDraft(streamed);
          }
          if (event === "done" && payload.outputText && !streamed) setLiveDraft(payload.outputText);
          if (event === "error") throw new Error(payload.error || "Агент завершил работу с ошибкой");
        }
        if (done) break;
      }
      await loadStatus(true);
      refreshConversation(conversation.id);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Агент не смог подготовить ответ");
    } finally {
      setBusy(null);
    }
  }

  async function postAction(path: string, body?: unknown, action = "action") {
    setBusy(action);
    setError(null);
    try {
      const response = await fetch(`/api/ai-agent/conversations/${encodeURIComponent(conversation.id)}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(safeError(data, "Действие не выполнено"));
      await loadStatus(true);
      refreshConversation(conversation.id);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Действие не выполнено");
    } finally {
      setBusy(null);
    }
  }

  async function sendQualityFeedback(code: string) {
    if (!status?.latestQuote?.id) return;
    setBusy(`quality:${code}`);
    setError(null);
    try {
      const response = await fetch(`/api/ai-agent/quotes/${encodeURIComponent(status.latestQuote.id)}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(safeError(data, "Оценка не сохранилась"));
    } catch (feedbackError) {
      setError(feedbackError instanceof Error ? feedbackError.message : "Оценка не сохранилась");
    } finally {
      setBusy(null);
    }
  }

  if (loading && !status) {
    return (
      <section className="eco-ai-panel is-loading" aria-label="ИИ-агент">
        <LoaderCircle size={16} className="is-spin" /> Проверяем помощника…
      </section>
    );
  }

  if (!status) {
    return (
      <section className="eco-ai-panel is-error" aria-label="ИИ-агент">
        <CircleAlert size={16} />
        <span><strong>ИИ-помощник недоступен</strong><small>{error || "Обновите страницу или проверьте настройки."}</small></span>
      </section>
    );
  }

  const draft = liveDraft || editedDraft || status.draft;
  const approval = status.pendingApprovals[0];
  const approvalArguments = asRecord(approval?.arguments);
  const sourceEvidence = asArray(status.latestQuote?.sourceEvidence).map(asRecord);
  const isHuman = status.state === "human";
  const run = status.currentRun;
  const isRunning = status.state === "running" || run?.status === "queued" || run?.status === "running" || busy === "run";
  const currentStep = Math.min(10, run ? run.completedStages.length + (run.status === "completed" ? 0 : 1) : 0);
  const hasQuote = asArray(status.latestQuote?.quoteOptions).length > 0;
  const vinAwaited = run?.status === "waiting_for_client" && status.conversationState.pendingQuestion === "vin";
  const runTitle = !run ? "" : run.status === "waiting_for_human" ? "Расчёт готов" : run.status === "waiting_for_client" ? (run.stageLabel === "Уточняет параметры без VIN" ? "Уточняет параметры без VIN" : run.stageLabel === "Ждёт пробег" ? "Ждёт пробег" : run.stageLabel === "Уточняет историю АКПП" ? "Уточняет историю АКПП" : run.stageLabel === "Проверяет жалобы на АКПП" ? "Проверяет жалобы на АКПП" : "Ждём клиента") : run.status === "completed" ? (hasQuote ? "Расчёт завершён" : "Ответ подготовлен") : run.status === "timed_out" || run.status === "research_failed" ? "Нужна техническая проверка" : run.status === "handed_off" ? "Передано сотруднику" : run.status === "cancelled" ? "Остановлено" : run.status === "failed" ? "Требует внимания" : "ИИ-агент рассчитывает";

  return (
    <section className={`eco-ai-panel state-${status.state}`} aria-label="ИИ-агент">
      <div className="eco-ai-panel__head">
        <span className="eco-ai-panel__icon"><Bot size={16} /></span>
        <span className="eco-ai-panel__title">
          <strong>{status.agentName}</strong>
          <small><i />{stateLabels[isRunning ? "running" : status.state]} · {modeLabels[status.mode]}</small>
        </span>
        <Link href="/cabinet/ai-agent" aria-label="Настройки ИИ-агента">Настроить</Link>
      </div>

      {!status.hasApiKey && (
        <div className="eco-ai-panel__notice is-warning">
          <CircleAlert size={14} /> Для запуска нужен ключ OpenAI на сервере.
        </div>
      )}

      {status.enabled && status.intent && (
        <div className="eco-ai-panel__signal">
          <span>Запрос</span>
          <strong>{intentLabels[status.intent] ?? status.intent}</strong>
          {typeof status.confidence === "number" && <em>Уверенность в запросе: {Math.round(status.confidence * 100)}%</em>}
        </div>
      )}

      {status.conversationState.mileage && (
        <div className="eco-ai-panel__signal">
          <span>Пробег</span>
          <strong>{status.conversationState.mileage}</strong>
          {status.conversationState.mileageApproximate && <em>Значение ориентировочное</em>}
        </div>
      )}

      {run && (
        <section className={`eco-ai-panel__run status-${run.status}`} aria-label="Текущий запуск агента">
          <div className="eco-ai-panel__run-head">
            <span>{isRunning && <LoaderCircle size={13} className="is-spin" />}<strong>{runTitle}</strong></span>
            <time>{duration(run.elapsedSeconds)}</time>
          </div>
          <p><b>Шаг {currentStep || 1} из 10</b> · {run.stageLabel ?? "Подготавливаем следующий шаг"}</p>
          <small>Последняя активность: {lastActivityText(run)}</small>
          {(run.softExceeded || run.stale) && (
            <div className="eco-ai-panel__notice is-warning">
              <CircleAlert size={14} /> {run.stale ? "Нет подтверждённой активности больше минуты — проверка могла зависнуть." : "Проверка идёт дольше обычного, результаты сохраняются."}
            </div>
          )}
          <details className="eco-ai-panel__run-details">
            <summary>Открыть детали</summary>
            <div>
              {run.completedStages.length > 0 && <span>Готово: {run.completedStages.length} этапа(ов)</span>}
              {run.events.slice(0, 5).map((event) => <span key={event.id}>{event.publicLabel ?? toolLabels[event.toolName ?? ""] ?? "Проверка"}</span>)}
            </div>
          </details>
          {(run.stale || run.status === "timed_out" || run.status === "failed" || run.status === "research_failed") && (
            <button type="button" disabled={Boolean(busy)} onClick={() => void runAgent()}><RotateCcw size={14} /> Повторить подготовку</button>
          )}
        </section>
      )}

      {approval && (
        <div className="eco-ai-panel__approval">
          <ShieldCheck size={17} />
          <span><strong>Нужно ваше подтверждение</strong><small>{approvalLabel(approval.toolName)}</small></span>
          <div>
            <button type="button" className="is-approve" disabled={Boolean(busy)} onClick={() => void postAction("approval", { approvalId: approval.id, approved: true }, "approve")}>
              <Check size={14} /> {approval.toolName === "request_quote_approval" ? "Проверить расчёт" : "Подтвердить"}
            </button>
            <button type="button" disabled={Boolean(busy)} onClick={() => void postAction("approval", { approvalId: approval.id, approved: false }, "reject")}>
              <X size={14} /> Отклонить
            </button>
          </div>
        </div>
      )}

      {approval?.toolName === "request_quote_approval" && (
        <details className="eco-ai-panel__review" open>
          <summary>Проверка расчёта перед отправкой</summary>
          <div>
            <p><strong>Сводка:</strong> {String(approvalArguments.internalSummary || "не указана")}</p>
            <p><strong>Текст клиенту:</strong> {String(approvalArguments.customerText || "не подготовлен")}</p>
            {sourceEvidence.length > 0 && <p><strong>Источники:</strong> {sourceEvidence.slice(0, 3).map((item) => String(item.source || item.name || "источник")).join(" · ")}</p>}
          </div>
        </details>
      )}

      {vinAwaited && (
        <div className="eco-ai-panel__notice is-warning">
          <CircleAlert size={14} /> VIN ускорит точную проверку, но предварительный подбор можно продолжить по параметрам автомобиля.
          <div className="eco-ai-panel__inline-actions">
            <button type="button" disabled={Boolean(busy)} onClick={() => void postAction("control", { action: "continue_without_vin" }, "without-vin")}>
              Продолжить без VIN
            </button>
            <button type="button" disabled={Boolean(busy)} onClick={() => void postAction("control", { action: "request_other_parameter" }, "other-parameter")}>
              Запросить другой параметр
            </button>
          </div>
        </div>
      )}

      {draft && (
        <div className="eco-ai-panel__draft">
          <span>{isRunning ? "Ответ формируется" : status.mode === "suggestions" ? "Черновик ответа" : "Последний ответ"}</span>
          {status.mode === "suggestions" ? (
            <textarea value={editedDraft || liveDraft} onChange={(event) => { setEditedDraft(event.target.value); setLiveDraft(""); }} disabled={isRunning} rows={5} aria-label="Черновик ответа ИИ" />
          ) : <p>{draft}</p>}
        </div>
      )}

      {status.latestQuote && (
        <div className="eco-ai-panel__quote">
          <span>Расчёт · {status.latestQuote.status === "draft_preliminary" ? "предварительный" : status.latestQuote.status === "needs_human_review" ? "проверка" : status.latestQuote.status === "sent" ? "отправлен" : "ожидает"}</span>
          <strong>{money(status.latestQuote.totalCents) ?? "варианты"}</strong>
        </div>
      )}

      {status.latestQuote?.id && (
        <div className="eco-ai-panel__quality" aria-label="Быстрая оценка расчёта">
          <span>Оценка</span>
          <button type="button" disabled={Boolean(busy)} onClick={() => void sendQualityFeedback("all_correct")}>Всё верно</button>
          <button type="button" disabled={Boolean(busy)} onClick={() => void sendQualityFeedback("corrected_product")}>Исправил товар</button>
          <button type="button" disabled={Boolean(busy)} onClick={() => void sendQualityFeedback("dangerous_error")}>Опасная ошибка</button>
        </div>
      )}

      {status.latestHandoff && (status.state === "handoff" || status.latestHandoff.status === "queued") && (
        <div className="eco-ai-panel__handoff">
          <Hand size={15} />
          <span><strong>{status.latestHandoff.reason || "Диалог передан сотруднику"}</strong><small>{status.latestHandoff.summary}</small></span>
        </div>
      )}

      {status.recentToolCalls.length > 0 && (
        <details className="eco-ai-panel__history">
          <summary>Что уже проверено · {status.recentToolCalls.length}</summary>
          <div>
            {status.recentToolCalls.slice(0, 5).map((call) => (
              <span key={call.id} className={call.status === "failed" ? "is-failed" : ""}>
                {call.status === "completed" || call.status === "approved" ? <Check size={12} /> : call.status === "failed" ? <CircleAlert size={12} /> : <LoaderCircle size={12} />}
                {toolLabels[call.toolName] ?? call.toolName}
              </span>
            ))}
          </div>
        </details>
      )}

      {(error || status.lastError) && <div className="eco-ai-panel__notice is-error"><CircleAlert size={14} />{displayAgentError(error || status.lastError || "")}</div>}

      <div className="eco-ai-panel__actions">
        {!status.enabled ? (
          <Link href="/cabinet/ai-agent"><Sparkles size={14} /> Включить в настройках</Link>
        ) : isHuman ? (
          <button type="button" disabled={Boolean(busy)} onClick={() => void postAction("control", { action: "return" }, "return")}>
            <RotateCcw size={14} /> Вернуть помощнику
          </button>
        ) : (
          <>
            <button type="button" className="is-primary" disabled={Boolean(busy) || !status.hasApiKey || Boolean(approval)} onClick={() => void runAgent()}>
              {isRunning ? <LoaderCircle size={14} className="is-spin" /> : <Sparkles size={14} />}
              {isRunning ? "Готовит ответ…" : "Подготовить ответ"}
            </button>
            {status.mode === "suggestions" && draft && !approval && (
              <button type="button" disabled={Boolean(busy) || !editedDraft.trim()} onClick={() => void postAction("draft/send", { text: editedDraft }, "send")}>
                <Send size={14} /> Отправить черновик
              </button>
            )}
            <button type="button" disabled={Boolean(busy)} onClick={() => void postAction("control", { action: "takeover" }, "takeover")}>
              <Hand size={14} /> Перехватить диалог
            </button>
            <button type="button" disabled={Boolean(busy)} onClick={() => void postAction("control", { action: "handoff" }, "handoff")}>
              <Hand size={14} /> Передать сотруднику
            </button>
            <button type="button" disabled={Boolean(busy)} onClick={() => void postAction("control", { action: "stop" }, "stop")}>
              <StopCircle size={14} /> Остановить помощника
            </button>
          </>
        )}
      </div>
    </section>
  );
}
