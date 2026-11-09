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

type Recording = { recorder: MediaRecorder; timer: number };

export default function QuickAssistant({ branchId }: { branchId: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<Preview>();
  const [answer, setAnswer] = useState<QuickAnswer>();
  const [shipment, setShipment] = useState<ShipmentResult>();
  const [savedShipment, setSavedShipment] = useState<{ id: string; name: string }>();
  const [serviceId, setServiceId] = useState("");
  const [masterId, setMasterId] = useState<number>();
  const [busy, setBusy] = useState("");
  const [recording, setRecording] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [saveUncertain, setSaveUncertain] = useState(false);
  const operation = useRef<AbortController | null>(null);
  const capture = useRef<Recording | null>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const commandInput = useRef<HTMLTextAreaElement>(null);
  const previewHeading = useRef<HTMLElement>(null);
  const previewKind = preview?.draft.kind ?? (shipment ? "shipment" : answer ? "answer" : undefined);
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
    else commandInput.current?.focus();
  }, [open, previewKind]);

  async function parseCommand(body: FormData | string, signal: AbortSignal) {
    const headers: Record<string, string> = { "x-eco-assistant-branch": branchId };
    if (typeof body === "string") headers["Content-Type"] = "application/json";
    const response = await fetch("/api/ai-assistant/quick-command", { method: "POST", headers, body, signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Помощник недоступен.");
    return data;
  }

  async function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!hasBranch || !text.trim() || operation.current || capture.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy("Разбираю команду…");
    setError("");
    setNotice("");
    setAnswer(undefined);
    setSavedShipment(undefined);
    try {
      const result: CommandResult = await parseCommand(JSON.stringify({ text }), controller.signal);
      if ("answer" in result) {
        setAnswer(result.answer);
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
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Не удалось подготовить черновик.");
    } finally {
      operation.current = null;
      setBusy("");
    }
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
    setBusy("Запрашиваю микрофон…");
    setError("");
    setNotice("");
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
        setBusy("Распознаю голос…");
        try {
          const audio = new Blob(chunks, { type: mimeType });
          if (!audio.size) throw new Error("Запись пустая. Попробуйте ещё раз.");
          const body = new FormData();
          body.set("audio", audio, "command");
          const result = await parseCommand(body, controller.signal);
          if (!result.text) throw new Error("Речь не распознана. Попробуйте ещё раз.");
          setText(result.text);
          commandInput.current?.focus();
        } catch (cause) {
          if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Не удалось распознать голос.");
        } finally {
          operation.current = null;
          setBusy("");
        }
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
      setNotice(booking ? "Запись создана в журнале." : "Дело клиента создано в CRM.");
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
      setSavedShipment({ id: data.id, name: data.name });
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
          <div><span className={styles.eyebrow}>ЭКОПЛАТФОРМА</span><h2>Быстрый помощник</h2></div>
          <button type="button" className={styles.icon} onClick={close} disabled={Boolean(busy || recording)} aria-label="Закрыть"><X size={18} /></button>
        </header>
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
                onClick={() => { setShipment(undefined); setError(""); }}>К команде</button>
              <button type="button" className={styles.primary} disabled={Boolean(busy)}
                onClick={() => void confirmShipment()}>Подтвердить и создать</button>
            </div>
          </div> : !draft ?
          <form className={styles.form} onSubmit={prepare}>
            <label>Что нужно сделать?
              <textarea ref={commandInput} className="eco-input" rows={3} maxLength={2000} required
                placeholder="Например, что с заказом Петрова? Или подготовь отгрузку из заказ-наряда № 0042"
                value={text} disabled={Boolean(busy || recording)} onChange={event => setText(event.target.value)} />
            </label>
            <div className={styles.actions}>
              <button type="button" className={styles.secondary} onClick={() => void toggleRecording()} disabled={Boolean(busy)}>
                {recording ? <Square size={16} /> : <Mic size={16} />}{recording ? "Остановить" : "Продиктовать"}
              </button>
              <button className={styles.primary} disabled={!text.trim() || Boolean(busy || recording)}>Отправить</button>
            </div>
            <small>Текст и голос обрабатывает OpenAI.</small>
            {recording && <p role="status">Идёт запись, до 30 секунд.</p>}
            {notice && <p role="status" className={styles.notice}>{notice}</p>}
            {savedShipment && <p role="status" className={styles.notice}>
              Черновик создан. <a href={`/shipment/${encodeURIComponent(savedShipment.id)}/edit`}>Открыть отгрузку № {savedShipment.name}</a>
            </p>}
            {answer && <div className={styles.answer}>
              <strong ref={previewHeading} tabIndex={-1}>Результат</strong>
              <p>{answer.text}</p>
              {answer.sources.length > 0 && <ul className={styles.sourceList}>
                {answer.sources.map(source => <li key={source.href}><a href={source.href}>{source.label}</a></li>)}
              </ul>}
            </div>}
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
                {saveUncertain ? "Закрыть черновик" : "К команде"}
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
