"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Bot, Mic, Square, X } from "lucide-react";
import { journalLocalToUtcIso } from "@/lib/booking/journal-time";
import { normalizePhoneKey } from "@/lib/phone-normalize";
import { uniqueQuickOption, type QuickAnswer, type QuickBookingOptions, type QuickCommand, type QuickShipmentPreview } from "@/lib/quick-assistant";
import styles from "./quick-assistant.module.css";

type Preview = {
  draft: QuickCommand;
  branch: { id: string; name: string; timezone: string; login: string };
  options?: QuickBookingOptions;
};

type ShipmentResult = { shipment: QuickShipmentPreview; branchName: string };
type CommandResult = Preview | { answer: QuickAnswer } | ShipmentResult;

const rubles = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB" });

type ChatMessage = { role: "user" | "assistant"; content: string; sources?: QuickAnswer["sources"] };

type Recording = { recorder: MediaRecorder; timer: number };

export default function QuickAssistant({ branchId }: { branchId: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<Preview>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [shipment, setShipment] = useState<ShipmentResult>();
  const [serviceId, setServiceId] = useState("");
  const [masterId, setMasterId] = useState<number>();
  const [busy, setBusy] = useState("");
  const [recording, setRecording] = useState(false);
  const [retryAudio, setRetryAudio] = useState<Blob>();
  const [error, setError] = useState("");
  const [saveUncertain, setSaveUncertain] = useState(false);
  const operation = useRef<AbortController | null>(null);
  const capture = useRef<Recording | null>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const commandInput = useRef<HTMLTextAreaElement>(null);
  const chatLog = useRef<HTMLDivElement>(null);
  const previewHeading = useRef<HTMLElement>(null);
  const previewKind = preview?.draft.kind ?? (shipment ? "shipment" : undefined);
  const hasBranch = Boolean(branchId && branchId !== "all");

  useEffect(() => () => {
    operation.current?.abort();
    if (capture.current) {
      const { recorder, timer } = capture.current;
      capture.current = null;
      window.clearTimeout(timer);
      recorder.stream.getTracks().forEach(track => track.stop());
      if (recorder.state !== "inactive") recorder.stop();
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    if (previewKind) previewHeading.current?.focus();
    else if (!busy && !recording) commandInput.current?.focus();
  }, [open, previewKind, busy, recording]);

  useEffect(() => {
    if (chatLog.current) chatLog.current.scrollTop = chatLog.current.scrollHeight;
  }, [open, messages]);

  function appendAnswer(content: string, sources?: QuickAnswer["sources"]) {
    setMessages(current => [...current, { role: "assistant", content, sources }]);
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

  async function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!hasBranch || !text.trim() || operation.current || capture.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy("Разбираю команду…");
    setError("");
    const command = text.trim();
    setMessages(current => [...current, { role: "user", content: command }]);
    setText("");
    try {
      const history = messages.slice(-8).map(({ role, content }) => ({ role, content }));
      const result: CommandResult = await parseCommand(JSON.stringify({ text: command, history }), controller.signal);
      if ("answer" in result) {
        appendAnswer(result.answer.text, result.answer.sources);
        return;
      }
      if ("shipment" in result) {
        setShipment(result);
        return;
      }
      const service = uniqueQuickOption(result.draft.service, result.options?.services ?? []);
      const masters = result.options?.masters.filter(master => service?.masterIds.includes(master.id)) ?? [];
      const master = result.draft.master ? uniqueQuickOption(result.draft.master, masters) : masters.length === 1 ? masters[0] : undefined;
      setServiceId(service?.id ?? "");
      setMasterId(master?.id);
      setSaveUncertain(false);
      setPreview(result);
    } catch (cause) {
      if (!controller.signal.aborted) {
        setMessages(current => current.slice(0, -1));
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
      setText(result.text);
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
      if (capture.current.recorder.state === "recording") capture.current.recorder.stop();
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
      const recorder = new MediaRecorder(stream, { mimeType });
      const chunks: Blob[] = [];
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = async () => {
        recorder.stream.getTracks().forEach(track => track.stop());
        if (capture.current?.recorder !== recorder) return;
        window.clearTimeout(capture.current.timer);
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
      const timer = window.setTimeout(() => { if (recorder.state === "recording") recorder.stop(); }, 30_000);
      capture.current = { recorder, timer };
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

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!preview || operation.current || saveUncertain) return;
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
    if (booking && (!datetime || !serviceId || !masterId)) {
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
    setError("");
    const expectedBranchId = branch.id;
    const payload = booking ? {
      expectedBranchId,
      action: "create-record",
      payload: {
        client: { name: draft.customerName, phone },
        staff_id: masterId,
        services: [{ booking_service_id: serviceId }],
        datetime,
        internal_comment: draft.notes || null,
      },
    } : {
      expectedBranchId,
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
      const response = await fetch(booking ? "/api/booking-journal" : "/api/crm/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (response.status >= 500) throw new Error();
      if (!response.ok) {
        setError(data.error || "Не удалось сохранить. Проверьте черновик.");
        return;
      }
      if (!(booking ? data.data?.booking_id : data.id)) throw new Error();
      setPreview(undefined);
      setText("");
      appendAnswer(booking ? "Запись создана в журнале." : "Дело клиента создано в CRM.");
    } catch {
      setSaveUncertain(true);
      setError(booking
        ? "Результат сохранения неизвестен. Проверьте журнал перед повтором."
        : "Результат сохранения неизвестен. Проверьте CRM перед повтором.");
    } finally {
      operation.current = null;
      setBusy("");
    }
  }

  async function confirmShipment() {
    if (!shipment || operation.current) return;
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
      setText("");
    } catch {
      setError("Результат неизвестен. Повторите подтверждение этого черновика, чтобы проверить сохранение.");
    } finally {
      operation.current = null;
      setBusy("");
    }
  }

  function close() {
    if (busy || recording) return;
    setOpen(false);
    launcher.current?.focus();
  }

  const draft = preview?.draft;
  const service = preview?.options?.services.find(option => option.id === serviceId);
  const masters = preview?.options?.masters.filter(master => service?.masterIds.includes(master.id)) ?? [];

  return createPortal(
    <div className={styles.widget} onKeyDown={event => { if (event.key === "Escape" && open) close(); }}>
      <button ref={launcher} type="button" className={styles.launcher} onClick={() => open ? close() : setOpen(true)}
        aria-label="Быстрый помощник" aria-expanded={open} aria-controls={open ? "quick-assistant-panel" : undefined}>
        <Bot size={23} aria-hidden />
      </button>
      {open && <section id="quick-assistant-panel" className={styles.panel} aria-label="Быстрый помощник">
        <header className={styles.heading}>
          <h2>Быстрый помощник</h2>
          <button type="button" className={styles.icon} onClick={close} disabled={Boolean(busy || recording)} aria-label="Закрыть"><X size={18} /></button>
        </header>
        {hasBranch && <div ref={chatLog} className={styles.chatLog} role="log" aria-label="История разговора" tabIndex={0}>
          {messages.length === 0 && <p className={styles.intro}>Спросите про остатки, клиента или автомобиль. Можно продолжить вопрос в следующем сообщении.</p>}
          {messages.map((message, index) => (
            <div key={index} className={message.role === "user" ? styles.userMessage : styles.assistantMessage}>
              <span className={styles.messageAuthor}>{message.role === "user" ? "Вы" : "Помощник"}</span>
              <p>{message.content}</p>
              {!!message.sources?.length && <ul className={styles.sourceList}>
                {message.sources.map(source => <li key={source.href}><a href={source.href}>{source.label}</a></li>)}
              </ul>}
            </div>
          ))}
        </div>}
        {!hasBranch ? <p>Выберите один филиал в меню платформы, чтобы начать.</p> : shipment ?
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
              <button type="button" className={styles.secondary} disabled={Boolean(busy)}
                onClick={() => { setShipment(undefined); setError(""); }}>Продолжить чат</button>
              <button type="button" className={styles.primary} disabled={Boolean(busy)}
                onClick={() => void confirmShipment()}>Подтвердить и создать</button>
            </div>
          </div> : !draft ?
          <form className={styles.form} onSubmit={prepare}>
            <label>Сообщение
              <textarea ref={commandInput} className={styles.composer} rows={2} maxLength={2000} required
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
              <button className={styles.primary} disabled={!text.trim() || Boolean(busy || recording)}>Отправить</button>
            </div>
            {retryAudio && <button type="button" className={styles.secondary} disabled={Boolean(busy || recording)}
              onClick={resendRecording}>Повторить отправку</button>}
            <small>Текст и голос обрабатывает OpenAI.</small>
            {recording && <p role="status">Идёт запись, до 30 секунд.</p>}
          </form> :
          <form className={styles.form} onSubmit={confirm}>
            <div className={styles.previewTitle}>
              <strong ref={previewHeading} tabIndex={-1}>{draft.kind === "booking" ? "Новая запись" : "Новое дело клиента"}</strong>
              <span>{preview.branch.name} · {preview.branch.timezone}</span>
              {draft.kind === "task" && <span>Ответственный: {preview.branch.login}</span>}
            </div>
            <fieldset disabled={Boolean(busy || saveUncertain)} className={styles.fields}>
              <label>Клиент<input className="eco-input" required maxLength={180} value={draft.customerName} onChange={event => edit("customerName", event.target.value)} /></label>
              <label>Телефон<input className="eco-input" type="tel" required maxLength={32} value={draft.phone} onChange={event => edit("phone", event.target.value)} /></label>
              {draft.kind === "booking" ? <>
                <label>Услуга
                  {!serviceId && draft.service && <small>В команде: {draft.service}</small>}
                  <select className="eco-input" value={serviceId} required onChange={event => { setServiceId(event.target.value); setMasterId(undefined); }}>
                    <option value="">Выберите услугу</option>
                    {preview.options?.services.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
                  </select>
                </label>
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
              <button type="button" className={styles.secondary} disabled={Boolean(busy)} onClick={() => { setPreview(undefined); setError(""); if (saveUncertain) setText(""); }}>
                {saveUncertain ? "Закрыть черновик" : "Продолжить чат"}
              </button>
              <button className={styles.primary} disabled={Boolean(busy || saveUncertain)}>Подтвердить и сохранить</button>
            </div>
          </form>}
        {busy && <p role="status">{busy}</p>}
        {error && <p role="alert" className={styles.error}>{error}</p>}
      </section>}
    </div>,
    document.body,
  );
}
