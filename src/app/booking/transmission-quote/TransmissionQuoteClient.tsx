"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Check, LoaderCircle } from "lucide-react";
import { trackClientGoal } from "@/lib/client-site-analytics";
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
  const [help, setHelp] = useState(false);
  const successRef = useRef<HTMLHeadingElement>(null);
  const [utm, setUtm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const sending = useRef(false);
  const phoneRef = useRef<HTMLInputElement>(null);
  const [phoneError, setPhoneError] = useState("");
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const caseId = params.get("case");
    if (params.get("source") === "akpp") setSourcePage("/services/zamena-masla-akpp");
    setHelp(params.get("mode") === "help");
    if (params.get("source") === "akpp" && params.get("mode") === "help") {
      const maintenance = params.get("maintenance");
      const distance = params.get("distance") ?? "";
      if (maintenance === "yes") {
        const mileage = /^\d{1,7}$/.test(distance)
          ? ` После последней замены прошло ${new Intl.NumberFormat("ru-RU").format(Number(distance))} км.`
          : distance === "unknown" ? " Пробег после замены неизвестен." : "";
        setComment(`Жалоб на работу АКПП нет. Масло меняли.${mileage}`);
      } else if (maintenance === "no") {
        setComment("Жалоб на работу АКПП нет. Масло ещё не меняли.");
      } else if (maintenance === "unknown") {
        setComment("Жалоб на работу АКПП нет. История замены масла неизвестна.");
      }
    }
    if (caseId && /^[a-z0-9-]{1,120}$/i.test(caseId)) setSourcePage(`/case/${caseId}`);
    setUtm(Object.fromEntries([...params.entries()].filter(([key]) => /^utm_(source|medium|campaign|content|term)$/.test(key))));
  }, []);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  useEffect(() => { if (sent) successRef.current?.focus(); }, [sent]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current) return;
    setError("");
    setPhoneError("");
    if (name.trim().length < 2 || !vehicle.trim()) {
      setError("Укажите имя и автомобиль для расчёта."); return;
    }
    if (!normalizePhoneKey(phone)) {
      setPhoneError("Проверьте номер телефона. Пример: +7 999 123-45-67.");
      phoneRef.current?.focus();
      return;
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
      trackClientGoal("akpp_quote_success", { source: sourcePage });
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
      <h1 ref={successRef} tabIndex={-1}>Заявка на расчёт принята</h1>
      <p>Рассчитаем стоимость масла, расходников и работ для вашего автомобиля и свяжемся с вами по указанному телефону.</p>
      <div className={styles.successActions}><a className={styles.secondaryButton} href={sourcePage === "/booking/transmission-quote" ? "/client-site/cases" : `/client-site${sourcePage}`}><ArrowLeft aria-hidden /> {sourcePage.startsWith("/services/") ? "Вернуться к услуге" : "Вернуться к кейсам"}</a></div>
    </main> : <main className={`${styles.bookingShell} ${quoteStyles.shell}`}>
      <div className={styles.intro}><div>
        <span className={styles.bookingKicker}>Масло в АКПП</span>
        <h1>{help ? "Подбор способа замены масла в АКПП" : "Расчёт стоимости замены масла в АКПП"}</h1>
        <p>{help ? "Укажите автомобиль и телефон. Уточним данные по коробке, подскажем подходящий способ замены и рассчитаем стоимость." : "Укажите автомобиль и телефон. Подберём масло и расходники, рассчитаем работу и сообщим итоговую стоимость. Дату визита согласуем отдельно."}</p>
      </div></div>
      <form className={quoteStyles.panel} onSubmit={submit} aria-busy={busy}>
        <div className={styles.stageBody}>
          <div className={styles.stageHeading}><div><h2>Ваш автомобиль и контакты</h2><p>Имя, телефон и автомобиль обязательны. VIN поможет точнее подобрать материалы.</p></div></div>
          <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
            <legend className={quoteStyles.honeypot}>Данные для расчёта</legend>
            <div className={styles.formGrid}>
              <label><span>Имя</span><input required minLength={2} maxLength={120} autoComplete="given-name" value={name} onChange={e => setName(e.target.value)} /></label>
              <label><span>Телефон</span><input ref={phoneRef} required type="tel" autoComplete="tel" inputMode="tel" maxLength={30} placeholder="+7 (999) 123-45-67" aria-invalid={Boolean(phoneError)} aria-describedby={phoneError ? "quote-phone-error" : undefined} value={phone} onChange={e => { setPhone(e.target.value); setPhoneError(""); }} />{phoneError && <small id="quote-phone-error" className={styles.fieldError} role="alert">{phoneError}</small>}</label>
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
