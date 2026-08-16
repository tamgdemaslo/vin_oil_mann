"use client";

import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Car,
  Check,
  CheckCircle2,
  Clock3,
  MapPin,
  Phone,
  ShieldCheck,
  UserRound,
  Wrench,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./booking.module.css";

type Branch = {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  timezone: string;
  intro: string | null;
  bookingHorizonDays: number;
  workingHours: Array<{ weekday: number; isWorking: boolean; startTime: string | null; endTime: string | null }>;
};

type Service = {
  id: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  requiresVin: boolean;
  requiresConfirmation: boolean;
  requiredFields: string[];
};

type Vehicle = {
  id: string;
  make: string;
  model: string;
  generation: string | null;
  year: number | null;
  plate: string | null;
  vin: string | null;
};

type Slot = {
  startsAt: string;
  endsAt: string;
  localTime: string;
  durationMinutes: number;
  master: { membershipId: string; name: string; position: string | null };
};

type Availability = {
  durationMinutes: number;
  requiresVin: boolean;
  requiresConfirmation: boolean;
  slots: Slot[];
};

const STEPS = ["Филиал", "Автомобиль", "Услуги", "Время", "Контакты"];

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok) throw new Error(body?.error || "Не удалось выполнить запрос");
  if (!body) throw new Error("Сервис вернул пустой ответ");
  return body;
}

function todayInput() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() + days);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function durationLabel(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} мин`;
  return rest ? `${hours} ч ${rest} мин` : `${hours} ч`;
}

function dateLabel(value: string) {
  if (!value) return "Не выбрано";
  return new Intl.DateTimeFormat("ru-RU", { weekday: "short", day: "numeric", month: "long" }).format(new Date(`${value}T12:00:00`));
}

function branchHoursLabel(hours: Branch["workingHours"]) {
  const working = hours.filter((row) => row.isWorking && row.startTime && row.endTime);
  if (!working.length) return "График уточняется";
  const ranges = [...new Set(working.map((row) => `${row.startTime}–${row.endTime}`))];
  return ranges.length === 1 ? `Рабочие дни: ${ranges[0]}` : "График зависит от дня";
}

export default function BookingClient() {
  const [step, setStep] = useState(1);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [services, setServices] = useState<Service[]>([]);
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [plate, setPlate] = useState("");
  const [vin, setVin] = useState("");
  const [localDate, setLocalDate] = useState(addDays(todayInput(), 1));
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [lookupState, setLookupState] = useState<"idle" | "loading" | "found" | "none">("idle");
  const [error, setError] = useState("");
  const [managementUrl, setManagementUrl] = useState("");
  const [createdPending, setCreatedPending] = useState(false);

  const branch = branches.find((item) => item.id === branchId) ?? null;
  const selectedServices = useMemo(() => services.filter((service) => serviceIds.includes(service.id)), [services, serviceIds]);
  const totalDuration = selectedServices.reduce((total, service) => total + service.durationMinutes, 0);
  const requiresVin = selectedServices.some((service) => service.requiresVin);
  const requiresConfirmation = selectedServices.some((service) => service.requiresConfirmation);
  const requiredFields = useMemo(() => new Set(selectedServices.flatMap((service) => service.requiredFields ?? [])), [selectedServices]);
  const selectedVehicle = vehicles.find((vehicle) => vehicle.id === vehicleId) ?? null;
  const effectiveVin = selectedVehicle?.vin || (!vehicleId ? vin.trim() : "");
  const effectivePlate = selectedVehicle?.plate || (!vehicleId ? plate.trim() : "");
  const effectiveYear = selectedVehicle?.year || (!vehicleId ? year.trim() : "");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initialName = params.get("name")?.trim();
    const initialPhone = params.get("phone")?.trim();
    const initialVin = params.get("vin")?.trim().toUpperCase();
    if (initialName) setName(initialName);
    if (initialPhone) setPhone(initialPhone);
    if (initialVin) setVin(initialVin);
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/public/booking/branches")
      .then((response) => readJson<{ branches: Branch[] }>(response))
      .then((data) => {
        if (!active) return;
        setBranches(data.branches);
        if (data.branches.length === 1) setBranchId(data.branches[0].id);
      })
      .catch((reason) => active && setError(reason instanceof Error ? reason.message : "Не удалось загрузить филиалы"))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!branchId) return;
    setServices([]);
    setServiceIds([]);
    setAvailability(null);
    setSelectedSlot(null);
    fetch(`/api/public/booking/services?branchId=${encodeURIComponent(branchId)}`)
      .then((response) => readJson<{ services: Service[] }>(response))
      .then((data) => setServices(data.services))
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Не удалось загрузить услуги"));
  }, [branchId]);

  const lookupCustomer = useCallback(async () => {
    if (!branchId || phone.replace(/\D/g, "").length < 10) {
      setLookupState("none");
      return;
    }
    setLookupState("loading");
    setError("");
    try {
      const data = await readJson<{
        match: "found" | "none" | "ambiguous";
        vehicles?: Vehicle[];
      }>(await fetch("/api/public/booking/customer-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId, phone }),
      }));
      if (data.match === "found") {
        setVehicles(data.vehicles ?? []);
        setVehicleId(data.vehicles?.[0]?.id ?? null);
        setLookupState("found");
      } else {
        setVehicles([]);
        setVehicleId(null);
        setLookupState("none");
      }
    } catch (reason) {
      setLookupState("none");
      setError(reason instanceof Error ? reason.message : "Не удалось проверить телефон");
    }
  }, [branchId, phone]);

  const loadAvailability = useCallback(async () => {
    if (!branchId || !localDate || !serviceIds.length) return;
    setBusy(true);
    setError("");
    setSelectedSlot(null);
    try {
      const data = await readJson<Availability>(await fetch("/api/public/booking/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId, localDate, serviceIds }),
      }));
      setAvailability(data);
    } catch (reason) {
      setAvailability(null);
      setError(reason instanceof Error ? reason.message : "Не удалось загрузить свободное время");
    } finally {
      setBusy(false);
    }
  }, [branchId, localDate, serviceIds]);

  useEffect(() => {
    if (step === 4) void loadAvailability();
  }, [step, loadAvailability]);

  function canContinue() {
    if (step === 1) return Boolean(branchId);
    if (step === 2) return Boolean(
      name.trim() &&
      phone.replace(/\D/g, "").length >= 10 &&
      (vehicleId || (make.trim() && model.trim())) &&
      (!requiredFields.has("plate") || selectedVehicle?.plate || plate.trim()) &&
      (!requiredFields.has("year") || selectedVehicle?.year || year.trim())
    );
    if (step === 3) return Boolean(
      serviceIds.length > 0 &&
      (!requiresVin || effectiveVin) &&
      (!requiredFields.has("plate") || effectivePlate) &&
      (!requiredFields.has("year") || effectiveYear)
    );
    if (step === 4) return Boolean(selectedSlot);
    return Boolean(name.trim() && phone.trim() && selectedSlot && (!requiredFields.has("email") || email.trim()));
  }

  function goNext() {
    setError("");
    if (!canContinue()) {
      if (step === 3 && (requiresVin && !effectiveVin || requiredFields.has("plate") && !effectivePlate || requiredFields.has("year") && !effectiveYear)) {
        setError("Для выбранной услуги не хватает данных автомобиля. Вернитесь на шаг «Автомобиль» и добавьте другой автомобиль с обязательными полями.");
      } else {
        setError("Заполните обязательные поля шага");
      }
      return;
    }
    setStep((current) => Math.min(5, current + 1));
  }

  async function submitBooking() {
    if (!selectedSlot || !branchId) return;
    setBusy(true);
    setError("");
    try {
      const data = await readJson<{
        managementUrl: string;
        booking: { confirmationState: string };
      }>(await fetch("/api/public/booking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId,
          serviceIds,
          masterMembershipId: selectedSlot.master.membershipId,
          startsAt: selectedSlot.startsAt,
          customerName: name,
          phone,
          email,
          vehicleId: selectedVehicle && !selectedVehicle.id.startsWith("legacy:") ? selectedVehicle.id : null,
          vehicle: selectedVehicle && selectedVehicle.id.startsWith("legacy:")
            ? selectedVehicle
            : vehicleId ? null : { make, model, year, plate, vin },
          comment,
          website: "",
        }),
      }));
      setManagementUrl(data.managementUrl);
      setCreatedPending(data.booking.confirmationState === "PENDING");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Не удалось создать запись";
      setError(message);
      if (/время|слот|занят/iu.test(message)) {
        setStep(4);
        await loadAvailability();
      }
    } finally {
      setBusy(false);
    }
  }

  if (managementUrl) {
    return (
      <main className={styles.publicRoot}>
        <section className={styles.successPanel} aria-live="polite">
          <span className={styles.successIcon}><CheckCircle2 aria-hidden /></span>
          <h1>{createdPending ? "Заявка на запись принята" : "Вы записаны"}</h1>
          <p>
            {createdPending
              ? "Предварительное время пока не подтверждено. Оно временно учтено в календаре; администратор свяжется с вами, уточнит данные автомобиля и подтвердит или предложит другое время."
              : "Время закреплено. Сохраните ссылку: по ней можно перенести или отменить визит."}
          </p>
          <div className={styles.confirmationFacts}>
            <span><CalendarDays aria-hidden /> {dateLabel(localDate)}, {selectedSlot?.localTime}</span>
            <span><MapPin aria-hidden /> {branch?.name}</span>
            <span><Car aria-hidden /> {selectedVehicle ? `${selectedVehicle.make} ${selectedVehicle.model}` : [make, model].filter(Boolean).join(" ")}</span>
            <span><Wrench aria-hidden /> {selectedServices.map((service) => service.name).join(", ")}</span>
            <span><UserRound aria-hidden /> Мастер: {selectedSlot?.master.name}</span>
          </div>
          <a className={styles.primaryButton} href={managementUrl}>Открыть мою запись <ArrowRight aria-hidden /></a>
          <small>Ссылка также используется в уведомлениях и не требует регистрации.</small>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.publicRoot}>
      <header className={styles.publicHeader}>
        <a className={styles.brand} href="/client-site" aria-label="Там где масло — на главную">
          <span aria-hidden>ТГМ</span>
          <strong>Там где масло</strong>
        </a>
        <div>
          <ShieldCheck aria-hidden />
          <span>Онлайн-запись<br /><small>без звонка и регистрации</small></span>
        </div>
      </header>

      <section className={styles.bookingShell}>
        <div className={styles.intro}>
          <div>
            <h1>Запись в сервис</h1>
            <p>Выберите работы и удобное время. Мы показываем только действительно свободные слоты.</p>
          </div>
          {branch?.phone && <a href={`tel:${branch.phone.replace(/[^+\d]/g, "")}`}><Phone aria-hidden /> {branch.phone}</a>}
        </div>

        <nav className={styles.steps} aria-label="Шаги записи">
          {STEPS.map((label, index) => {
            const number = index + 1;
            return (
              <button
                type="button"
                key={label}
                className={number === step ? styles.activeStep : number < step ? styles.doneStep : ""}
                onClick={() => number < step && setStep(number)}
                disabled={number > step}
                aria-current={number === step ? "step" : undefined}
              >
                <span>{number < step ? <Check aria-hidden /> : number}</span>
                {label}
              </button>
            );
          })}
        </nav>

        <div className={styles.workspace}>
          <section className={styles.stage}>
            {loading ? (
              <div className={styles.skeleton} aria-label="Загрузка"><i /><i /><i /></div>
            ) : step === 1 ? (
              <div className={styles.stageBody}>
                <div className={styles.stageHeading}><MapPin aria-hidden /><div><h2>Куда вам удобно приехать?</h2><p>У каждого филиала своё расписание и набор услуг.</p></div></div>
                <div className={styles.choiceList}>
                  {branches.map((item) => (
                    <label key={item.id} className={branchId === item.id ? styles.selectedChoice : ""}>
                      <input type="radio" name="branch" value={item.id} checked={branchId === item.id} onChange={() => setBranchId(item.id)} />
                      <span><strong>{item.name}</strong><small>{item.address || "Адрес уточняется"} · {branchHoursLabel(item.workingHours)}</small>{item.intro && <em>{item.intro}</em>}</span>
                      <Check aria-hidden />
                    </label>
                  ))}
                  {!branches.length && <div className={styles.empty}>Онлайн-запись пока не открыта. Позвоните в сервис, и мы подберём время.</div>}
                </div>
              </div>
            ) : step === 2 ? (
              <div className={styles.stageBody}>
                <div className={styles.stageHeading}><Car aria-hidden /><div><h2>Кто приедет и на каком автомобиле?</h2><p>По телефону найдём вашу карточку и сохранённые автомобили.</p></div></div>
                <div className={styles.formGrid}>
                  <label><span>Телефон *</span><div className={styles.inlineField}><input value={phone} onChange={(event) => { setPhone(event.target.value); setLookupState("idle"); }} placeholder="+7 900 000-00-00" inputMode="tel" autoComplete="tel" /><button type="button" onClick={lookupCustomer} disabled={lookupState === "loading"}>{lookupState === "loading" ? "Ищем…" : "Найти"}</button></div></label>
                  <label><span>Имя *</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Как к вам обращаться" autoComplete="name" /></label>
                </div>
                {lookupState === "found" && <p className={styles.lookupNotice}><CheckCircle2 aria-hidden /> Нашли вашу карточку. Выберите автомобиль или добавьте новый.</p>}
                {!!vehicles.length && (
                  <div className={styles.vehicleList}>
                    {vehicles.map((vehicle) => (
                      <label key={vehicle.id} className={vehicleId === vehicle.id ? styles.selectedChoice : ""}>
                        <input type="radio" name="vehicle" checked={vehicleId === vehicle.id} onChange={() => setVehicleId(vehicle.id)} />
                        <span><strong>{vehicle.make} {vehicle.model}</strong><small>{[vehicle.year, vehicle.plate, vehicle.vin].filter(Boolean).join(" · ")}</small></span>
                        <Check aria-hidden />
                      </label>
                    ))}
                    <button type="button" className={styles.textButton} onClick={() => setVehicleId(null)}>+ Другой автомобиль</button>
                  </div>
                )}
                {!vehicleId && (
                  <div className={styles.formGrid}>
                    <label><span>Марка *</span><input value={make} onChange={(event) => setMake(event.target.value)} placeholder="Например, BMW" /></label>
                    <label><span>Модель *</span><input value={model} onChange={(event) => setModel(event.target.value)} placeholder="Например, X5" /></label>
                    <label><span>Год {requiredFields.has("year") ? "*" : ""}</span><input value={year} onChange={(event) => setYear(event.target.value)} placeholder="2020" inputMode="numeric" /></label>
                    <label><span>Госномер {requiredFields.has("plate") ? "*" : ""}</span><input value={plate} onChange={(event) => setPlate(event.target.value.toUpperCase())} placeholder="А123ВС39" /></label>
                    <label className={styles.wideField}><span>VIN {requiresVin ? "*" : ""}</span><input value={vin} onChange={(event) => setVin(event.target.value.toUpperCase())} placeholder="17 символов" maxLength={17} autoCapitalize="characters" /></label>
                  </div>
                )}
              </div>
            ) : step === 3 ? (
              <div className={styles.stageBody}>
                <div className={styles.stageHeading}><Wrench aria-hidden /><div><h2>Что нужно сделать?</h2><p>Можно выбрать несколько работ — длительность сложится автоматически.</p></div></div>
                <div className={styles.serviceList}>
                  {services.map((service) => {
                    const selected = serviceIds.includes(service.id);
                    return (
                      <label key={service.id} className={selected ? styles.selectedChoice : ""}>
                        <input type="checkbox" checked={selected} onChange={() => setServiceIds((current) => selected ? current.filter((id) => id !== service.id) : [...current, service.id])} />
                        <span><strong>{service.name}</strong><small>{service.description || "Работа по регламенту сервиса"}</small><em>{durationLabel(service.durationMinutes)}{service.requiresVin ? " · нужен VIN" : ""}{service.requiresConfirmation ? " · с подтверждением" : ""}</em></span>
                        <Check aria-hidden />
                      </label>
                    );
                  })}
                  {!services.length && <div className={styles.empty}>Для филиала ещё не открыты услуги онлайн-записи.</div>}
                </div>
                {(requiresVin && !effectiveVin || requiredFields.has("plate") && !effectivePlate || requiredFields.has("year") && !effectiveYear) && (
                  <p className={styles.warning}>Для выбранной услуги нужны дополнительные данные автомобиля. Вернитесь на шаг «Автомобиль» и выберите или добавьте автомобиль с VIN, госномером и годом согласно отмеченным требованиям.</p>
                )}
                {requiresConfirmation && <p className={styles.pendingNotice}><ShieldCheck aria-hidden /> <strong>Запись требует подтверждения.</strong> Для обслуживания коробки или другой сложной работы мы заранее проверим автомобиль и процедуру. Выберите предварительное время — администратор свяжется с вами и подтвердит его.</p>}
              </div>
            ) : step === 4 ? (
              <div className={styles.stageBody}>
                <div className={styles.stageHeading}><Clock3 aria-hidden /><div><h2>Выберите дату и время</h2><p>Слот закрепится только после подтверждения на следующем шаге.</p></div></div>
                <label className={styles.dateField}><span>Дата визита</span><input type="date" value={localDate} min={todayInput()} max={addDays(todayInput(), branch?.bookingHorizonDays ?? 60)} onChange={(event) => setLocalDate(event.target.value)} /></label>
                <div className={styles.slotHeader}><strong>{dateLabel(localDate)}</strong><button type="button" onClick={loadAvailability} disabled={busy}>Обновить</button></div>
                {busy ? <div className={styles.slotSkeleton}><i /><i /><i /><i /></div> : (
                  <div className={styles.slotGrid}>
                    {availability?.slots.map((slot) => (
                      <button type="button" key={`${slot.startsAt}-${slot.master.membershipId}`} className={selectedSlot?.startsAt === slot.startsAt && selectedSlot.master.membershipId === slot.master.membershipId ? styles.selectedSlot : ""} onClick={() => setSelectedSlot(slot)}>
                        <strong>{slot.localTime}</strong><span>{slot.master.name}</span>
                      </button>
                    ))}
                    {availability && !availability.slots.length && <div className={styles.empty}>На эту дату свободных окон нет. Выберите другой день.</div>}
                  </div>
                )}
              </div>
            ) : (
              <div className={styles.stageBody}>
                <div className={styles.stageHeading}><UserRound aria-hidden /><div><h2>Проверьте контакты</h2><p>На телефон придут подтверждение, напоминание и ссылка управления записью.</p></div></div>
                <div className={styles.formGrid}>
                  <label><span>Имя *</span><input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" /></label>
                  <label><span>Телефон *</span><input value={phone} onChange={(event) => setPhone(event.target.value)} inputMode="tel" autoComplete="tel" /></label>
                  <label className={styles.wideField}><span>Email {requiredFields.has("email") ? "*" : ""}</span><input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" placeholder={requiredFields.has("email") ? "Обязательное поле" : "Необязательно"} /></label>
                  <label className={styles.wideField}><span>Комментарий</span><textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={4} placeholder="Например, есть шум при повороте руля" /></label>
                </div>
                {requiresConfirmation && <p className={styles.pendingNotice}><ShieldCheck aria-hidden /> Время пока не подтверждено. После отправки оно будет временно занято в календаре, а администратор свяжется с вами после проверки автомобиля.</p>}
              </div>
            )}

            {error && <div className={styles.error} role="alert">{error}</div>}
            <footer className={styles.stageFooter}>
              <button type="button" className={styles.secondaryButton} onClick={() => setStep((current) => Math.max(1, current - 1))} disabled={step === 1 || busy}><ArrowLeft aria-hidden /> Назад</button>
              {step < 5
                ? <button type="button" className={styles.primaryButton} onClick={goNext} disabled={busy}>Продолжить <ArrowRight aria-hidden /></button>
                : <button type="button" className={styles.primaryButton} onClick={submitBooking} disabled={busy}>{busy ? "Закрепляем время…" : requiresConfirmation ? "Отправить на подтверждение" : "Записаться"} <ArrowRight aria-hidden /></button>}
            </footer>
          </section>

          <aside className={styles.summary}>
            <h2>Ваша запись</h2>
            <dl>
              <div><dt><MapPin aria-hidden /> Филиал</dt><dd>{branch?.name || "Не выбран"}<small>{branch?.address}</small></dd></div>
              <div><dt><Car aria-hidden /> Автомобиль</dt><dd>{selectedVehicle ? `${selectedVehicle.make} ${selectedVehicle.model}` : [make, model].filter(Boolean).join(" ") || "Не указан"}<small>{selectedVehicle?.plate || plate || null}</small></dd></div>
              <div><dt><Wrench aria-hidden /> Услуги</dt><dd>{selectedServices.length ? selectedServices.map((service) => service.name).join(", ") : "Не выбраны"}<small>{totalDuration ? durationLabel(totalDuration) : null}</small></dd></div>
              <div><dt><CalendarDays aria-hidden /> Время</dt><dd>{selectedSlot ? `${dateLabel(localDate)}, ${selectedSlot.localTime}` : "Не выбрано"}<small>{selectedSlot?.master.name}</small></dd></div>
            </dl>
            <p><ShieldCheck aria-hidden /> Данные передаются напрямую в систему сервиса. Оплата на сайте не требуется.</p>
          </aside>
        </div>
      </section>
    </main>
  );
}
