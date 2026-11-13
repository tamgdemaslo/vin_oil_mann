"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bot, ExternalLink, Mic, Send, Square, X } from "lucide-react";
import { journalLocalToUtcIso } from "@/lib/booking/journal-time";
import { normalizePhoneKey } from "@/lib/phone-normalize";
import { QUICK_COMMAND_MAX_LENGTH, quickAssistantPlainText, uniqueQuickBookingService, uniqueQuickOption, type QuickAnswer, type QuickBookingOptions, type QuickCommand, type QuickReschedulePreview, type QuickShipmentPreview } from "@/lib/quick-assistant";
import styles from "./quick-assistant.module.css";

type Preview = {
  draft: QuickCommand;
  branch: { id: string; name: string; timezone: string; login: string };
  options?: QuickBookingOptions;
  selectedServiceId?: string | null;
  requestedServices?: string[];
  selectedServiceIds?: (string | null)[];
  relatedTask?: { title: string; notes: string };
};

type ShipmentResult = { shipment: QuickShipmentPreview; branchName: string };
type CommandResult = Preview | { answer: QuickAnswer } | ShipmentResult | { reschedule: QuickReschedulePreview };

const rubles = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB" });

type ChatMessage = { role: "user" | "assistant"; content: string; sources?: QuickAnswer["sources"] };

type Chat = { id: string; messages: ChatMessage[] };
const emptyMessages: ChatMessage[] = [];
const maxSavedChats = 20;

type Workspace = {
  chats: Chat[];
  chatId: string;
  text: string;
  preview?: Preview;
  reschedule?: QuickReschedulePreview;
  shipment?: ShipmentResult;
  serviceId?: string;
  serviceIds?: string[];
  masterId?: number;
  saveUncertain: boolean;
  bookingSaveKey: string | null;
  error: string;
};

export default function QuickAssistant({ branchId, login, fullPage = false }: {
  branchId: string;
  login: string;
  fullPage?: boolean;
}) {
  const [open, setOpen] = useState(fullPage);
  const [draftOpen, setDraftOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<Preview>();
  const [chats, setChats] = useState<Chat[]>([]);
  const [chatId, setChatId] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const historyKey = `eco:quick-chats:${login}:${branchId}`;
  const workspaceKey = `${historyKey}:workspace`;
  const messages = chats.find(chat => chat.id === chatId)?.messages ?? emptyMessages;
  const [reschedule, setReschedule] = useState<QuickReschedulePreview>();
  const [shipment, setShipment] = useState<ShipmentResult>();
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [masterId, setMasterId] = useState<number>();
  const [localBusy, setBusy] = useState("");
  const [remoteBusy, setRemoteBusy] = useState(false);
  const busy = localBusy || (remoteBusy ? "Помощник работает в другой вкладке…" : "");
  const [recording, setRecording] = useState(false);
  const [retryAudio, setRetryAudio] = useState<Blob>();
  const [error, setError] = useState("");
  const [saveUncertain, setSaveUncertain] = useState(false);
  const shared = useRef(false);
  const observedWorkspace = useRef<string | null>(null);
  const appliedWorkspace = useRef<string | null>(null);
  const releaseAction = useRef<(() => void) | null>(null);
  const [actionFinished, setActionFinished] = useState(0);
  const actionKey = `${workspaceKey}:action`;
  const operation = useRef<AbortController | null>(null);
  const capture = useRef<MediaRecorder | null>(null);
  const bookingSaveKey = useRef<string | null>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const commandInput = useRef<HTMLTextAreaElement>(null);
  const chatLog = useRef<HTMLDivElement>(null);
  const previewHeading = useRef<HTMLElement>(null);
  const previewKind = preview?.draft.kind ?? (reschedule ? "reschedule" : shipment ? "shipment" : undefined);
  const hasBranch = Boolean(branchId && branchId !== "all");

  useEffect(() => () => {
    operation.current?.abort();
    if (capture.current) {
      const recorder = capture.current;
      capture.current = null;
      recorder.stream.getTracks().forEach(track => track.stop());
      if (recorder.state !== "inactive") recorder.stop();
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    if (previewKind && (fullPage || draftOpen)) previewHeading.current?.focus();
    else if (!busy && !recording) commandInput.current?.focus();
  }, [open, previewKind, busy, recording, fullPage, draftOpen]);

  useEffect(() => {
    if (chatLog.current) chatLog.current.scrollTop = chatLog.current.scrollHeight;
  }, [open, messages]);

  useEffect(() => {
    function restore(raw: string, initial = false) {
      const saved: Workspace = JSON.parse(raw);
      appliedWorkspace.current = JSON.stringify(saved);
      setChats(saved.chats);
      setChatId(saved.chatId);
      setText(saved.text);
      setPreview(saved.preview);
      setReschedule(saved.reschedule);
      setShipment(saved.shipment);
      setServiceIds(saved.serviceIds ?? [saved.serviceId ?? ""]);
      setMasterId(saved.masterId);
      setSaveUncertain(saved.saveUncertain);
      setError(saved.error || (initial && saved.saveUncertain && (!shared.current || !localStorage.getItem(actionKey))
        ? (saved.preview?.draft.kind === "task" && saved.bookingSaveKey
          ? "Сохранение прервалось. Нажмите «Проверить и повторить»."
          : "Сохранение прервалось. Проверьте результат перед повтором.")
        : ""));
      bookingSaveKey.current = saved.bookingSaveKey;
    }

    function refreshAction() {
      const active = localStorage.getItem(actionKey);
      setRemoteBusy(Boolean(active && !releaseAction.current));
      if (!active || releaseAction.current) return;
      // A browser tab can disappear before it clears the marker. The browser releases its lock.
      void navigator.locks.request(actionKey, { ifAvailable: true }, lock => {
        if (lock && localStorage.getItem(actionKey) === active) {
          localStorage.removeItem(actionKey);
          setRemoteBusy(false);
        }
      }).catch(() => {});
    }

    function sync(event: StorageEvent) {
      if (event.storageArea !== localStorage) return;
      try {
        if (event.key === actionKey) refreshAction();
        if (event.key !== workspaceKey) return;
        const latest = localStorage.getItem(workspaceKey);
        if (latest && latest !== observedWorkspace.current) {
          observedWorkspace.current = latest;
          restore(latest);
        }
      } catch {
        // The current conversation remains available in this tab.
      }
    }

    try {
      if (hasBranch && navigator.locks) {
        observedWorkspace.current = localStorage.getItem(workspaceKey);
        shared.current = true;
        refreshAction();
      }
      const raw = observedWorkspace.current ?? sessionStorage.getItem(workspaceKey);
      if (raw) {
        restore(raw, true);
      } else {
        const stored: unknown = JSON.parse(sessionStorage.getItem(historyKey) ?? "[]");
        if (Array.isArray(stored)) {
          const history = (stored as Chat[]).filter(chat => chat && typeof chat.id === "string" && Array.isArray(chat.messages)).slice(0, maxSavedChats);
          setChats(history);
          setChatId(history[0]?.id ?? "");
        }
      }
    } catch {
      // The chat remains usable if browser storage is unavailable.
    }
    if (shared.current) window.addEventListener("storage", sync);
    setHistoryLoaded(true);
    return () => {
      window.removeEventListener("storage", sync);
      if (releaseAction.current) {
        try { localStorage.removeItem(actionKey); } catch { /* The lock is still released. */ }
        releaseAction.current();
        releaseAction.current = null;
      }
    };
  }, [actionKey, hasBranch, historyKey, workspaceKey]);

  const workspace: Workspace = {
    chats, chatId, text, preview, reschedule, shipment, serviceIds, masterId,
    saveUncertain, bookingSaveKey: bookingSaveKey.current, error,
  };

  useEffect(() => {
    if (!historyLoaded) return;
    try {
      const snapshot = JSON.stringify(workspace);
      if (!shared.current) {
        sessionStorage.setItem(workspaceKey, snapshot);
        return;
      }
      if (snapshot === observedWorkspace.current) return;
      // Applying a snapshot from another tab must never write it back over a newer edit.
      if (snapshot === appliedWorkspace.current && observedWorkspace.current !== null) return;
      appliedWorkspace.current = null;
      if (localStorage.getItem(workspaceKey) === observedWorkspace.current
        && (!localStorage.getItem(actionKey) || releaseAction.current)) {
        localStorage.setItem(workspaceKey, snapshot);
        observedWorkspace.current = snapshot;
      }
    } catch {
      // The chat remains usable if the browser storage quota is exhausted.
    }
  });

  useEffect(() => {
    if (!actionFinished || !releaseAction.current) return;
    try { localStorage.removeItem(actionKey); } catch { /* The lock is still released. */ }
    releaseAction.current();
    releaseAction.current = null;
  }, [actionFinished, actionKey]);

  async function runAction(action: () => Promise<void>) {
    if (!historyLoaded || busy || operation.current || capture.current) return;
    if (!shared.current) return action();
    try {
      await navigator.locks.request(actionKey, { ifAvailable: true }, async lock => {
        if (!lock || localStorage.getItem(workspaceKey) !== observedWorkspace.current
          || JSON.stringify(workspace) !== observedWorkspace.current) return;

        const finished = new Promise<void>(resolve => { releaseAction.current = resolve; });
        try {
          localStorage.setItem(actionKey, crypto.randomUUID());
          await action();
        } finally {
          // Publish the result before another tab can start an action with this draft.
          setActionFinished(count => count + 1);
          await finished;
        }
      });
    } catch {
      setError("Не удалось синхронизировать чат. Попробуйте ещё раз.");
    }
  }

  function openFullPage() {
    if (!historyLoaded || busy || operation.current || capture.current) return;
    try {
      if (shared.current) {
        if (localStorage.getItem(workspaceKey) !== JSON.stringify(workspace)) {
          setError("Чат ещё синхронизируется. Попробуйте открыть вкладку ещё раз.");
          return;
        }
        if (!window.open("/ai-assistant", "_blank")) {
          setError("Разрешите открытие новой вкладки для этого сайта.");
          return;
        }
        close();
        return;
      }
      sessionStorage.setItem(workspaceKey, JSON.stringify(workspace));
      // A same-origin tab with an opener starts with a copy of this tab's session storage.
      const tab = window.open("about:blank", "_blank");
      if (!tab) {
        setError("Разрешите открытие новой вкладки для этого сайта.");
        return;
      }
      tab.opener = null;
      tab.location.replace("/ai-assistant");
      // Leave confirmation of the transferred draft in the destination tab only.
      sessionStorage.setItem(workspaceKey, JSON.stringify({
        chats, chatId, text: "", serviceIds: [], saveUncertain: false, bookingSaveKey: null, error: "",
      } satisfies Workspace));
      setPreview(undefined);
      setReschedule(undefined);
      setShipment(undefined);
      setSaveUncertain(false);
      setDraftOpen(false);
      setServiceIds([]);
      setMasterId(undefined);
      bookingSaveKey.current = null;
      setText("");
      setRetryAudio(undefined);
      setError("");
      close();
    } catch {
      setError("Не удалось перенести чат. Проверьте настройки хранения данных браузера.");
    }
  }

  function updateMessages(id: string, update: (messages: ChatMessage[]) => ChatMessage[]) {
    setChats(current => {
      const next = update(current.find(chat => chat.id === id)?.messages ?? emptyMessages).slice(-80);
      const others = current.filter(chat => chat.id !== id);
      return (next.length ? [{ id, messages: next }, ...others] : others).slice(0, maxSavedChats);
    });
  }

  function switchChat(id: string) {
    setDraftOpen(false);
    setChatId(id);
    setHistoryOpen(false);
    setText("");
    setRetryAudio(undefined);
    setError("");
  }

  function appendAnswer(content: string, sources?: QuickAnswer["sources"], id = chatId) {
    updateMessages(id, current => [...current, { role: "assistant", content, sources }]);
  }

  async function parseCommand(body: string | Blob, signal: AbortSignal) {
    let response: Response;
    try {
      response = await fetch("/api/ai-assistant/quick-command", {
        method: "POST",
        headers: {
          "x-eco-assistant-branch": branchId,
          "Content-Type": typeof body === "string" ? "application/json" : body.type,
        },
        body: typeof body === "string" ? body : await body.arrayBuffer(),
        signal,
      });
    } catch {
      throw new Error(typeof body === "string"
        ? "Не удалось связаться с помощником. Проверьте соединение и отправьте команду ещё раз."
        : "Не удалось отправить аудио. Проверьте соединение и нажмите «Повторить отправку».");
    }
    const data = await response.json().catch(() => null);
    if (!response.ok || !data) throw new Error(data?.error || "Помощник недоступен. Попробуйте ещё раз.");
    return data;
  }

  async function prepare() {
    if (!hasBranch || !text.trim() || operation.current || capture.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy("Разбираю команду…");
    setError("");
    const command = text.trim();
    if (command.length > QUICK_COMMAND_MAX_LENGTH) {
      operation.current = null;
      setBusy("");
      setError(`Сократите сообщение до ${QUICK_COMMAND_MAX_LENGTH} символов.`);
      return;
    }
    const id = chatId || crypto.randomUUID();
    setChatId(id);
    updateMessages(id, current => [...current, { role: "user", content: command }]);
    setText("");
    try {
      const history = messages.slice(-8).map(({ role, content }) => ({ role, content }));
      const result: CommandResult = await parseCommand(JSON.stringify({ text: command, history }), controller.signal);
      if ("answer" in result) {
        appendAnswer(result.answer.text, result.answer.sources, id);
        return;
      }
      if (previewKind) {
        appendAnswer("У вас открыт черновик. Подтвердите или закройте его перед созданием другого.", undefined, id);
        setText(command);
        return;
      }
      if ("reschedule" in result) {
        setSaveUncertain(false);
        setReschedule(result.reschedule);
        appendAnswer("Нашёл запись и подготовил перенос.", undefined, id);
        return;
      }
      if ("shipment" in result) {
        setShipment(result);
        appendAnswer(`Подготовлен черновик отгрузки из заказа № ${result.shipment.sourceName}.`, undefined, id);
        return;
      }
      const services = result.options?.services ?? [];
      const selectedIds = result.selectedServiceIds?.map(id => id ?? "") ?? [
        result.selectedServiceId === undefined
          ? uniqueQuickBookingService(result.draft.service, services)?.id ?? ""
          : result.selectedServiceId ?? "",
      ];
      const masters = result.options?.masters.filter(master => selectedIds.every(id =>
        services.some(service => service.id === id && service.masterIds.includes(master.id)))) ?? [];
      const master = result.draft.master ? uniqueQuickOption(result.draft.master, masters) : masters.length === 1 ? masters[0] : undefined;
      setServiceIds(selectedIds);
      setMasterId(master?.id);
      setSaveUncertain(false);
      bookingSaveKey.current = null;
      setPreview(result);
      appendAnswer(result.relatedTask
        ? "Подготовил запись и дело. Сначала подтвердите запись, затем дело."
        : result.draft.kind === "booking" ? "Подготовлен черновик записи." : "Подготовлен черновик дела.", undefined, id);
    } catch (cause) {
      if (!controller.signal.aborted) {
        updateMessages(id, current => current.slice(0, -1));
        setText(command);
        setError(cause instanceof Error ? cause.message : "Не удалось подготовить ответ.");
      }
    } finally {
      operation.current = null;
      setBusy("");
    }
  }

  async function transcribe(audio: Blob, controller: AbortController) {
    setBusy("Распознаю голос…");
    setError("");
    try {
      const result = await parseCommand(audio, controller.signal);
      setRetryAudio(undefined);
      if (!result.text) {
        setError("Речь не распознана. Запишите команду ещё раз.");
        return;
      }
      setText(current => [current.trimEnd(), result.text.trim()].filter(Boolean).join(" "));
    } catch (cause) {
      if (!controller.signal.aborted) {
        setRetryAudio(audio);
        setError(cause instanceof Error ? cause.message : "Не удалось распознать голос.");
      }
    } finally {
      operation.current = null;
      setBusy("");
    }
  }

  function resendRecording() {
    if (!retryAudio || operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    void transcribe(retryAudio, controller);
  }

  async function toggleRecording() {
    if (capture.current) {
      if (capture.current.state === "recording") capture.current.stop();
      return;
    }
    if (operation.current || !hasBranch) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Микрофон недоступен в этом браузере. Можно ввести команду текстом.");
      return;
    }
    const controller = new AbortController();
    operation.current = controller;
    setRetryAudio(undefined);
    setBusy("Запрашиваю микрофон…");
    setError("");
    let stream: MediaStream | undefined;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (controller.signal.aborted) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      const mimeType = ["audio/webm", "audio/mp4", "audio/ogg"].find(type => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error("Формат записи не поддерживается.");
      const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 32_000 });
      const chunks: Blob[] = [];
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = async () => {
        recorder.stream.getTracks().forEach(track => track.stop());
        if (capture.current !== recorder) return;
        capture.current = null;
        setRecording(false);
        const contentType = (chunks[0]?.type || recorder.mimeType || mimeType).split(";")[0];
        const audio = new Blob(chunks, { type: contentType });
        if (!audio.size) {
          operation.current = null;
          setError("Запись пустая. Попробуйте ещё раз.");
          return;
        }
        await transcribe(audio, controller);
      };
      recorder.start();
      capture.current = recorder;
      setRecording(true);
      setBusy("");
    } catch {
      stream?.getTracks().forEach(track => track.stop());
      operation.current = null;
      if (!controller.signal.aborted) {
        setBusy("");
        setError("Не удалось включить микрофон. Проверьте разрешение браузера или введите текст.");
      }
    }
  }

  function edit(field: keyof Omit<QuickCommand, "kind">, value: string) {
    setPreview(current => current ? { ...current, draft: { ...current.draft, [field]: value } } : current);
  }

  async function confirm() {
    if (!preview || capture.current || operation.current || (saveUncertain && preview.draft.kind === "task" && !bookingSaveKey.current)) return;
    const { branch, draft } = preview;
    if (branch.id !== branchId) return;
    const phone = normalizePhoneKey(draft.phone);
    if (!phone || !draft.customerName.trim()) {
      setError("Укажите имя и корректный телефон клиента.");
      return;
    }
    const booking = draft.kind === "booking";
    let datetime = "";
    try {
      if (draft.datetime) datetime = journalLocalToUtcIso(draft.datetime, branch.timezone);
    } catch {
      setError("Проверьте дату и время.");
      return;
    }
    if (booking && (!datetime || !serviceIds.length || serviceIds.some(id => !id) || !masterId)) {
      setError("Выберите услугу, мастера, дату и время.");
      return;
    }
    if (!booking && !draft.title.trim()) {
      setError("Укажите, что нужно сделать.");
      return;
    }

    const controller = new AbortController();
    operation.current = controller;
    setBusy("Сохраняю…");
    setSaveUncertain(true);
    setError("");
    const expectedBranchId = branch.id;
    bookingSaveKey.current ??= crypto.randomUUID();
    const payload = booking ? {
      expectedBranchId,
      idempotencyKey: bookingSaveKey.current,
      action: "create-record",
      payload: {
        client: { name: draft.customerName, phone },
        staff_id: masterId,
        services: [...new Set(serviceIds)].map(id => ({ booking_service_id: id })),
        datetime,
        internal_comment: draft.notes || null,
      },
    } : {
      expectedBranchId,
      assistantIdempotencyKey: bookingSaveKey.current,
      customerName: draft.customerName,
      phone,
      title: draft.title,
      nextAction: draft.title,
      nextActionAt: datetime || null,
      notes: draft.notes,
      caseStatus: "calculation_needed",
      useExplicitDeadline: true,
      caseType: "manual",
      source: "Голосовой помощник",
    };
    try {
      if (!booking) {
        const pending = JSON.stringify({
          ...workspace, saveUncertain: true, bookingSaveKey: bookingSaveKey.current, error: "",
        });
        if (shared.current) {
          localStorage.setItem(workspaceKey, pending);
          observedWorkspace.current = pending;
        } else {
          sessionStorage.setItem(workspaceKey, pending);
        }
      }
    } catch {
      if (!saveUncertain) bookingSaveKey.current = null;
      operation.current = null;
      setSaveUncertain(saveUncertain);
      setBusy("");
      setError("Не удалось сохранить состояние черновика. Попробуйте ещё раз.");
      return;
    }
    try {
      const response = await fetch(booking ? "/api/booking-journal" : "/api/crm/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (response.status >= 500) throw new Error(data.error || "");
      if (!response.ok) {
        setSaveUncertain(false);
        setError(data.error || "Не удалось сохранить. Проверьте черновик.");
        return;
      }
      if (!(booking ? data.data?.booking_id : data.id)) throw new Error();
      const relatedTask = booking ? preview.relatedTask : undefined;
      bookingSaveKey.current = null;
      setPreview(relatedTask ? {
        branch,
        draft: { ...draft, ...relatedTask, kind: "task", datetime: "" },
      } : undefined);
      setSaveUncertain(false);
      appendAnswer(relatedTask
        ? "Запись создана. Проверьте и подтвердите черновик дела."
        : booking ? "Запись создана в журнале." : "Дело клиента создано в CRM.");
    } catch (cause) {
      setSaveUncertain(true);
      const detail = cause instanceof Error && cause.message !== "Failed to fetch" ? cause.message : "";
      setError(booking
        ? [detail, "Не удалось подтвердить результат. Нажмите «Проверить и повторить», чтобы завершить ту же операцию без дубля."].filter(Boolean).join(" ")
        : "Не удалось подтвердить сохранение дела. Нажмите «Проверить и повторить», чтобы завершить ту же операцию без дубля.");
    } finally {
      operation.current = null;
      setBusy("");
    }
  }

  async function confirmReschedule() {
    if (!reschedule || capture.current || operation.current || saveUncertain) return;
    operation.current = new AbortController();
    setBusy("Переношу запись…");
    setSaveUncertain(true);
    setError("");
    try {
      const response = await fetch("/api/booking-journal", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reschedule-record", expectedBranchId: reschedule.branchId, record_id: reschedule.recordId,
          expectedUpdatedAt: reschedule.updatedAt, datetime: reschedule.datetime, notes: reschedule.notes,
        }),
      });
      const data = await response.json();
      if (response.status >= 500) throw new Error();
      if (!response.ok) {
        setSaveUncertain(false);
        setError(data.error || "Не удалось перенести запись.");
        return;
      }
      if (data.data?.booking_id !== reschedule.recordId) throw new Error();
      appendAnswer(`Запись перенесена на ${reschedule.datetime.replace("T", " ")}.`, [
        { label: "Открыть запись в журнале", href: `/records?recordId=${reschedule.journalRecordId}` },
      ]);
      setReschedule(undefined);
      setSaveUncertain(false);
    } catch {
      setSaveUncertain(true);
      setError("Не удалось подтвердить перенос. Проверьте время записи в журнале.");
    } finally {
      operation.current = null;
      setBusy("");
    }
  }

  async function confirmShipment() {
    if (!shipment || capture.current || operation.current) return;
    operation.current = new AbortController();
    setBusy("Сохраняю черновик…");
    setError("");
    try {
      const { sourceId, fingerprint, nonce } = shipment.shipment;
      const response = await fetch("/api/ai-assistant/quick-command/shipment", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-eco-assistant-branch": branchId },
        body: JSON.stringify({ confirm: true, sourceId, fingerprint, nonce }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 409 && data.shipment) setShipment({ ...shipment, shipment: data.shipment });
        setError(data.error || "Не удалось создать черновик отгрузки.");
        return;
      }
      if (!data.id || !data.name) throw new Error();
      appendAnswer("Черновик отгрузки создан.", [{ label: `Открыть отгрузку № ${data.name}`, href: `/shipment/${encodeURIComponent(data.id)}/edit` }]);
      setShipment(undefined);
    } catch {
      setError("Результат неизвестен. Повторите подтверждение этого черновика, чтобы проверить сохранение.");
    } finally {
      operation.current = null;
      setBusy("");
    }
  }

  function close() {
    if (localBusy || recording) return;
    setOpen(false);
    launcher.current?.focus();
  }

  const draft = preview?.draft;
  const services = preview?.options?.services ?? [];
  const masters = serviceIds.length ? preview?.options?.masters.filter(master => serviceIds.every(id =>
    services.some(service => service.id === id && service.masterIds.includes(master.id)))) ?? [] : [];

  const draftPanel = previewKind && (
    <aside className={styles.draftPanel} aria-label="Черновик">
    {reschedule ?
    <form className={styles.form} onSubmit={event => { event.preventDefault(); void runAction(confirmReschedule); }}>
      <div className={styles.previewTitle}>
        <strong ref={previewHeading} tabIndex={-1}>Перенос записи</strong>
        <span>{reschedule.customerName} · {reschedule.branchName}</span>
        <span>Было {reschedule.previousDatetime.replace("T", " ")}</span>
        <a href={`/records?recordId=${reschedule.journalRecordId}`}>Открыть запись в журнале</a>
      </div>
      <fieldset disabled={Boolean(recording || busy || saveUncertain)} className={styles.fields}>
        <label>Новое время
          <input className="eco-input" type="datetime-local" required value={reschedule.datetime}
            onChange={event => setReschedule({ ...reschedule, datetime: event.target.value })} />
        </label>
        <label>Дополнить заметку
          <textarea className="eco-input" value={reschedule.notes} maxLength={1000}
            onChange={event => setReschedule({ ...reschedule, notes: event.target.value })} />
        </label>
      </fieldset>
      <div className={styles.actions}>
        <button type="button" className={styles.secondary} disabled={Boolean(recording || busy)}
          onClick={() => { setReschedule(undefined); setSaveUncertain(false); setError(""); }}>Закрыть черновик</button>
        <button className={styles.primary} disabled={Boolean(recording || busy || saveUncertain)}>Подтвердить перенос</button>
      </div>
    </form> : shipment ?
    <div className={styles.form}>
      <div className={styles.previewTitle}>
        <strong ref={previewHeading} tabIndex={-1}>Черновик отгрузки</strong>
        <span>{shipment.branchName} · {shipment.shipment.organization}</span>
        <a href={`/shipment/${encodeURIComponent(shipment.shipment.sourceId)}/edit`}>Исходный заказ-наряд № {shipment.shipment.sourceName}</a>
        <span>Клиент: {shipment.shipment.customer} · Склад: {shipment.shipment.warehouse}</span>
        <span>Комментарий: {shipment.shipment.description}</span>
      </div>
      <ul className={styles.sourceList}>
        {shipment.shipment.positions.map((line, index) => (
          <li key={index}>
            <strong>{line.name}</strong>
            <span>{line.quantity} × {rubles.format(line.priceCents / 100)}{line.discount ? ` · скидка ${line.discount}%` : ""}{line.vat !== null ? ` · НДС ${line.vat}%` : ""}</span>
            {line.comment && <small>{line.comment}</small>}
            {line.available !== null && <small className={line.shortage ? styles.error : undefined}>
              Доступно: {line.available}{line.shortage ? " · не хватает на весь заказ" : ""}
            </small>}
          </li>
        ))}
      </ul>
      <strong>Итого {rubles.format(shipment.shipment.totalCents / 100)}</strong>
      <small>Сохранится отдельный черновик без проведения и списания остатков.</small>
      <div className={styles.actions}>
        <button type="button" className={styles.secondary} disabled={Boolean(recording || busy)}
          onClick={() => { setShipment(undefined); setError(""); }}>Закрыть черновик</button>
        <button type="button" className={styles.primary} disabled={Boolean(recording || busy)}
          onClick={() => void runAction(confirmShipment)}>Подтвердить и создать</button>
      </div>
    </div> : draft ?
    <form className={styles.form} onSubmit={event => { event.preventDefault(); void runAction(confirm); }}>
      <div className={styles.previewTitle}>
        <strong ref={previewHeading} tabIndex={-1}>{draft.kind === "booking" ? "Черновик записи" : "Черновик дела клиента"}</strong>
        <span>{preview.branch.name} · {preview.branch.timezone}</span>
        {draft.kind === "task" && <span>Ответственный: {preview.branch.login}</span>}
      </div>
      <fieldset disabled={Boolean(recording || busy || saveUncertain)} className={styles.fields}>
        <label>Клиент<input className="eco-input" required maxLength={180} value={draft.customerName} onChange={event => edit("customerName", event.target.value)} /></label>
        <label>Телефон<input className="eco-input" type="tel" required maxLength={32} value={draft.phone} onChange={event => edit("phone", event.target.value)} /></label>
        {draft.kind === "booking" ? <>
          {(preview.requestedServices ?? [draft.service]).map((requested, index, list) => (
            <label key={index}>
              {list.length === 1 ? "Услуга" : `Услуга ${index + 1}`}
              {!serviceIds[index] && requested && <small>В команде: {requested}</small>}
              <select className="eco-input" value={serviceIds[index] ?? ""} required
                onChange={event => {
                  const selected = event.target.value;
                  setServiceIds(current => list.map((_, position) => position === index ? selected : current[position] ?? ""));
                  setMasterId(undefined);
                }}>
                <option value="">Выберите услугу</option>
                {services.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
              </select>
            </label>
          ))}
          {preview.relatedTask && <p>После записи — черновик дела: {preview.relatedTask.title}</p>}
          <label>Мастер
            {!masterId && draft.master && <small>В команде: {draft.master}</small>}
            <select className="eco-input" value={masterId ?? ""} required onChange={event => setMasterId(Number(event.target.value) || undefined)}>
              <option value="">Выберите мастера</option>
              {masters.map(master => <option key={master.id} value={master.id}>{master.name}</option>)}
            </select>
          </label>
        </> : <label>Что сделать<input className="eco-input" required maxLength={180} value={draft.title} onChange={event => edit("title", event.target.value)} /></label>}
        <label>{draft.kind === "booking" ? "Дата и время визита" : "Срок · необязательно"}
          <input className="eco-input" type="datetime-local" required={draft.kind === "booking"} value={draft.datetime}
            onChange={event => edit("datetime", event.target.value)} />
        </label>
        <label>Заметка<textarea className="eco-input" rows={2} maxLength={1000} value={draft.notes} onChange={event => edit("notes", event.target.value)} /></label>
      </fieldset>
      <div className={styles.actions}>
        <button type="button" className={styles.secondary} disabled={Boolean(recording || busy)} onClick={() => { setPreview(undefined); bookingSaveKey.current = null; setError(""); setSaveUncertain(false); }}>
          Закрыть черновик
        </button>
        <button className={styles.primary} disabled={Boolean(recording || busy || (saveUncertain && draft.kind === "task" && !bookingSaveKey.current))}>{saveUncertain && (draft.kind === "booking" || bookingSaveKey.current) ? "Проверить и повторить" : "Подтвердить и сохранить"}</button>
      </div>
    </form> : null}
    </aside>
  );

  const content = (
    <div className={fullPage ? styles.workspace : styles.widget} onKeyDown={event => { if (!fullPage && event.key === "Escape" && open) close(); }}>
      {!fullPage && <button ref={launcher} type="button" className={styles.launcher} onClick={() => open ? close() : setOpen(true)}
        aria-label="ИИ-помощник" aria-expanded={open} aria-controls={open ? "quick-assistant-panel" : undefined}>
        <Bot size={23} aria-hidden />
      </button>}
      {open && <section id="quick-assistant-panel" className={styles.panel} aria-label="ИИ-помощник">
        <header className={styles.heading}>
          {fullPage ? <h1>ИИ-помощник</h1> : <h2><Bot size={19} aria-hidden /> ИИ-помощник</h2>}
          {fullPage ? <a href="/ai-assistant?mode=research">Технические расчёты</a> : <div className={styles.actions}>
            <button type="button" className={styles.secondary} onClick={openFullPage}
              disabled={!historyLoaded || Boolean(busy || recording)}>Открыть в новой вкладке <ExternalLink size={15} aria-hidden /></button>
            <button type="button" className={styles.icon} onClick={close} disabled={Boolean(localBusy || recording)} aria-label="Закрыть"><X size={18} /></button>
          </div>}
        </header>
        <div className={styles.layout}>
        {hasBranch && <aside className={styles.history} aria-label="Чаты">
        <div className={styles.historyToolbar}>
          {!fullPage && <button type="button" className={styles.secondary} aria-expanded={historyOpen}
            disabled={Boolean(busy || recording || preview || shipment || reschedule)} onClick={() => setHistoryOpen(value => !value)}>История чатов</button>}
          <button type="button" className={styles.secondary}
            disabled={Boolean(busy || recording || preview || shipment || reschedule)} onClick={() => switchChat("")}>Новый чат</button>
        </div>
        {(fullPage || historyOpen) && <ul className={styles.historyList} aria-label="Прошлые чаты">
          {chats.length === 0 && <li>Пока нет сохранённых чатов.</li>}
          {chats.map(chat => <li key={chat.id}>
            <button type="button" className={styles.secondary} aria-current={chat.id === chatId ? "true" : undefined}
              disabled={Boolean(busy || recording || preview || shipment || reschedule)} onClick={() => switchChat(chat.id)}>
              {chat.messages.find(message => message.role === "user")?.content.slice(0, 100) || "Чат"}
            </button>
          </li>)}
        </ul>}
        </aside>}
        <div className={styles.thread}>
        {hasBranch && <div ref={chatLog} className={styles.chatLog} role="log" aria-label="История разговора" tabIndex={0}>
          {messages.length === 0 && <p className={styles.intro}>Спросите про остатки, клиента или автомобиль. Можно продолжить вопрос в следующем сообщении.</p>}
          {messages.map((message, index) => (
            <div key={index} className={message.role === "user" ? styles.userMessage : styles.assistantMessage}>
              <span className={styles.messageAuthor}>{message.role === "user" ? "Вы" : "Помощник"}</span>
              <p>{message.role === "assistant" ? quickAssistantPlainText(message.content) : message.content}</p>
            </div>
          ))}
        </div>}
        {!hasBranch && <p>Выберите один филиал в меню платформы, чтобы начать.</p>}
        {!fullPage && previewKind && <button type="button" className={styles.draftToggle} aria-expanded={draftOpen}
          onClick={() => setDraftOpen(value => !value)}>
          {draftOpen ? "Свернуть черновик" : "Проверить черновик"}
          {!draftOpen && draft?.customerName && <span>{draft.customerName} · {draft.datetime.replace("T", " ")}</span>}
        </button>}
        {!fullPage && previewKind && draftOpen && <div className={styles.inlineDraft}>{draftPanel}</div>}
        {hasBranch && (<form className={styles.composerForm} onSubmit={event => { event.preventDefault(); void runAction(prepare); }}>
            <label>Сообщение
              <textarea ref={commandInput} className={styles.composer} rows={2} required
                placeholder="Напишите или продиктуйте сообщение"
                value={text} disabled={Boolean(busy || recording)} onChange={event => setText(event.target.value)}
                onKeyDown={event => {
                  if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }} />
            </label>
            <div className={styles.actions}>
              <button type="button" className={styles.secondary} onClick={() => void toggleRecording()} disabled={Boolean(busy)}>
                {recording ? <Square size={16} /> : <Mic size={16} />}{recording ? "Остановить" : "Продиктовать"}
              </button>
              <button className={styles.primary} disabled={!text.trim() || Boolean(busy || recording)}><Send size={16} aria-hidden /> Отправить</button>
            </div>
            {retryAudio && <button type="button" className={styles.secondary} disabled={Boolean(busy || recording)}
              onClick={resendRecording}>Повторить отправку</button>}
            <small>Текст и голос обрабатывает OpenAI.</small>
            {recording && <p role="status">Идёт запись. Нажмите «Остановить», когда закончите.</p>}
          </form>)}
        {busy && <p role="status">{busy}</p>}
        {error && <p role="alert" className={styles.error}>{error}</p>}
        </div>
        {fullPage && draftPanel}
        </div>
      </section>}
    </div>
  );

  if (fullPage) return content;
  return mounted ? createPortal(content, document.body) : null;
}
