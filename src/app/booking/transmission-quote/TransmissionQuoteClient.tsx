"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Check, LoaderCircle } from "lucide-react";
import { normalizePhoneKey } from "@/lib/phone-normalize";
import PublicBookingHeader from "../PublicBookingHeader";
import styles from "../booking.module.css";
import quoteStyles from "./quote.module.css";

export default function TransmissionQuoteClient() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [vin, setVin] = useState("");
  const [comment, setComment] = useState("");
  const [website, setWebsite] = useState("");
  const [sourcePage, setSourcePage] = useState("/booking/transmission-quote");
  const [utm, setUtm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const sending = useRef(false);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const caseId = params.get("case");
    if (caseId && /^[a-z0-9-]{1,120}$/i.test(caseId)) setSourcePage(`/case/${caseId}`);
    setUtm(Object.fromEntries([...params.entries()].filter(([key]) => /^utm_(source|medium|campaign|content|term)$/.test(key))));
  }, []);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current) return;
    setError("");
    if (name.trim().length < 2 || !vehicle.trim()) {
      setError("Укажите имя и автомобиль для расчёта."); return;
    }
    if (!normalizePhoneKey(phone)) {
      setError("Проверьте телефон: укажите номер с кодом страны."); return;
    }
    sending.current = true;
    setBusy(true);
    try {
      const response = await fetch("/api/public/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "transmission_oil_quote", name: name.trim(), phone: phone.trim(), vehicle: vehicle.trim(), vin: vin.trim().toUpperCase(), comment: comment.trim(), sourcePage, utm, website }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) throw new Error(data?.error || "Не удалось отправить заявку. Попробуйте позже.");
      setSent(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось отправить заявку. Проверьте соединение.");
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  return <div className={styles.publicRoot}>
    <PublicBookingHeader quote />
    {sent ? <main className={styles.successPanel}>
      <div className={styles.successIcon}><Check aria-hidden /></div>
      <h1>Заявка на расчёт отправлена</h1>
      <p>Рассчитаем стоимость масла, расходников и работ для вашего автомобиля и свяжемся с вами по указанному телефону.</p>
      <div className={styles.successActions}><a className={styles.secondaryButton} href={sourcePage === "/booking/transmission-quote" ? "/client-site/cases" : `/client-site${sourcePage}`}><ArrowLeft aria-hidden /> Вернуться к кейсам</a></div>
    </main> : <main className={`${styles.bookingShell} ${quoteStyles.shell}`}>
      <div className={styles.intro}><div>
        <span className={styles.bookingKicker}>Масло в АКПП</span>
        <h1>Рассчитать стоимость замены</h1>
        <p>Укажите автомобиль и контакты. Подберём масло и расходники, рассчитаем работы и сообщим стоимость. Дату визита согласуем отдельно.</p>
      </div></div>
      <form className={quoteStyles.panel} onSubmit={submit} aria-busy={busy}>
        <div className={styles.stageBody}>
          <div className={styles.stageHeading}><div><h2>Ваш автомобиль и контакты</h2><p>Имя, телефон и автомобиль обязательны. VIN поможет точнее подобрать материалы.</p></div></div>
          <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
            <legend className={quoteStyles.honeypot}>Данные для расчёта</legend>
            <div className={styles.formGrid}>
              <label><span>Имя</span><input required minLength={2} maxLength={120} autoComplete="given-name" value={name} onChange={e => setName(e.target.value)} /></label>
              <label><span>Телефон</span><input required type="tel" autoComplete="tel" inputMode="tel" maxLength={30} placeholder="+7 (999) 123-45-67" value={phone} onChange={e => setPhone(e.target.value)} /></label>
              <label className={styles.wideField}><span>Марка, модель и год</span><input required maxLength={200} placeholder="Например, Toyota Camry, 2019" value={vehicle} onChange={e => setVehicle(e.target.value)} /></label>
              <label className={styles.wideField}><span>VIN · необязательно</span><input maxLength={17} minLength={17} pattern="[A-HJ-NPR-Za-hj-npr-z0-9]{17}" title="17 латинских букв и цифр, без I, O и Q" autoCapitalize="characters" spellCheck={false} value={vin} onChange={e => setVin(e.target.value.toUpperCase())} /><small>Если VIN нет под рукой, оставьте поле пустым — уточним при связи.</small></label>
              <label className={styles.wideField}><span>Комментарий · необязательно</span><textarea rows={3} maxLength={1500} placeholder="Пробег, когда меняли масло, вопросы по замене" value={comment} onChange={e => setComment(e.target.value)} /></label>
            </div>
            <label className={quoteStyles.honeypot} aria-hidden="true">Ваш сайт<input name="website" tabIndex={-1} autoComplete="off" value={website} onChange={e => setWebsite(e.target.value)} /></label>
          </fieldset>
          <p className={styles.privacyNote}>Нажимая «Отправить на расчёт», вы разрешаете использовать контакты для ответа на заявку. <a href="/client-site/privacy" target="_blank" rel="noreferrer">Политика конфиденциальности</a>.</p>
          {error && <div ref={errorRef} className={styles.error} role="alert" tabIndex={-1}>{error}</div>}
        </div>
        <div className={quoteStyles.actions}><button className={styles.primaryButton} type="submit" disabled={busy}>{busy ? <><LoaderCircle className={styles.searchSpinner} aria-hidden /> Отправляем…</> : <>Отправить на расчёт <ArrowRight aria-hidden /></>}</button></div>
      </form>
    </main>}
  </div>;
}
