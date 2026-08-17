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

const STEPS = ["Филиал", "Автомобиль", "Услуги", "Время и контакты"];

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

  function changePhone(nextPhone: string) {
    if (selectedVehicle) {
      setMake(selectedVehicle.make);
      setModel(selectedVehicle.model);
      setYear(selectedVehicle.year == null ? "" : String(selectedVehicle.year));
      setPlate(selectedVehicle.plate ?? "");
      setVin(selectedVehicle.vin ?? "");
    }
    setPhone(nextPhone);
    setVehicles([]);
    setVehicleId(null);
    setLookupState("idle");
    setError("");
  }

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
        if (data.branches.length === 1) {
          setBranchId(data.branches[0].id);
          setStep((current) => current === 1 ? 2 : current);
        }
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
      setLookupState("idle");
      setError("Введите номер телефона полностью, чтобы найти сохранённые автомобили.");
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

  function validationMessage() {
    if (step === 1 && !branchId) return "Выберите филиал, в который хотите приехать.";
    if (step === 2) {
      if (phone.replace(/\D/g, "").length < 10) return "Укажите номер телефона — по нему мы найдём ваши автомобили и отправим подтверждение.";
      if (!vehicleId && (!make.trim() || !model.trim())) return "Укажите марку и модель автомобиля.";
      if (requiredFields.has("plate") && !effectivePlate) return "Для выбранной услуги нужен госномер автомобиля.";
      if (requiredFields.has("year") && !effectiveYear) return "Для выбранной услуги нужен год выпуска автомобиля.";
      if (requiresVin && !effectiveVin) return "Для выбранной услуги нужен VIN автомобиля.";
    }
    if (step === 3) {
      if (!serviceIds.length) return "Выберите хотя бы одну услугу.";
      if (requiresVin && !effectiveVin) return "Для выбранной услуги нужен VIN. Вернитесь к автомобилю и укажите его.";
      if (requiredFields.has("plate") && !effectivePlate) return "Для выбранной услуги нужен госномер. Вернитесь к автомобилю и укажите его.";
      if (requiredFields.has("year") && !effectiveYear) return "Для выбранной услуги нужен год выпуска. Вернитесь к автомобилю и укажите его.";
    }
    if (step === 4) {
      if (!selectedSlot) return "Выберите свободное время визита.";
      if (!name.trim()) return "Укажите, как к вам обращаться.";
      if (phone.replace(/\D/g, "").length < 10) return "Проверьте номер телефона.";
      if (requiredFields.has("email") && !email.trim()) return "Для выбранной услуги нужен email.";
    }
    return "";
  }

  function canContinue() {
    return !validationMessage();
  }

  function goNext() {
    setError("");
    if (!canContinue()) {
      setError(validationMessage());
      return;
    }
    setStep((current) => Math.min(4, current + 1));
  }

  async function submitBooking() {
    const message = validationMessage();
    if (message) {
      setError(message);
      return;
    }
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
            <h1>Запишитесь в сервис за пару минут</h1>
            <p>Без звонка и регистрации: выберите автомобиль, работы и действительно свободное время.</p>
          </div>
          {branch?.phone && <a href={`tel:${branch.phone.replace(/[^+\d]/g, "")}`}><Phone aria-hidden /> {branch.phone}</a>}
        </div>

        <div className={styles.progressHeader}>
          <nav className={styles.steps} aria-label="Шаги записи">
            {STEPS.map((label, index) => {
              const number = index + 1;
              return (
                <button
                  type="button"
                  key={label}
                  className={number === step ? styles.activeStep : number < step ? styles.doneStep : ""}
                  onClick={() => {
                    if (number < step) {
                      setError("");
                      setStep(number);
                    }
                  }}
                  disabled={number > step}
                  aria-current={number === step ? "step" : undefined}
                >
                  <span>{number < step ? <Check aria-hidden /> : number}</span>
                  {label}
                </button>
              );
            })}
          </nav>
          <div className={styles.mobileProgress} aria-label={`Шаг ${step} из ${STEPS.length}: ${STEPS[step - 1]}`}>
            <div><strong>Шаг {step} из {STEPS.length}</strong><span>{STEPS[step - 1]}</span></div>
            <i aria-hidden><span style={{ transform: `scaleX(${step / STEPS.length})` }} /></i>
          </div>
        </div>

        <div className={styles.workspace}>
          <div className={styles.mobileSummary} aria-label="Текущие данные записи">
            <MapPin aria-hidden />
            <span>
              <strong>{branch?.name || "Выберите филиал"}</strong>
              <small>{[
                selectedVehicle ? `${selectedVehicle.make} ${selectedVehicle.model}` : [make, model].filter(Boolean).join(" "),
                selectedServices.length ? `${selectedServices.length} ${selectedServices.length === 1 ? "услуга" : "услуги"}` : "",
                selectedSlot ? `${dateLabel(localDate)}, ${selectedSlot.localTime}` : "",
              ].filter(Boolean).join(" · ") || "Детали визита появятся здесь"}</small>
            </span>
          </div>
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
                <div className={styles.stageHeading}><Car aria-hidden /><div><h2>На каком автомобиле приедете?</h2><p>Если вы уже были у нас, найдём сохранённые автомобили по телефону.</p></div></div>
                <div className={styles.formGrid}>
                  <label className={`${styles.wideField} ${styles.lookupField}`}><span>Телефон *</span><div className={styles.inlineField}><input value={phone} onChange={(event) => changePhone(event.target.value)} placeholder="+7 900 000-00-00" inputMode="tel" autoComplete="tel" aria-describedby="phone-help" /><button type="button" onClick={lookupCustomer} disabled={lookupState === "loading"}>{lookupState === "loading" ? "Ищем…" : "Найти мои авто"}</button></div><small id="phone-help">Номер нужен для подтверждения записи. Рекламных звонков не будет.</small></label>
                </div>
                {lookupState === "found" && <p className={styles.lookupNotice}><CheckCircle2 aria-hidden /> Нашли вашу карточку. Выберите автомобиль или добавьте новый.</p>}
                {lookupState === "none" && <p className={styles.neutralNotice}>Сохранённых автомобилей не нашли — добавьте автомобиль ниже.</p>}
                {!!vehicles.length && (
                  <div className={styles.vehicleList}>
                    {vehicles.map((vehicle) => (
                      <label key={vehicle.id} className={vehicleId === vehicle.id ? styles.selectedChoice : ""}>
                        <input type="radio" name="vehicle" checked={vehicleId === vehicle.id} onChange={() => setVehicleId(vehicle.id)} />
                        <span><strong>{vehicle.make} {vehicle.model}</strong><small>{[vehicle.year, vehicle.plate, vehicle.vin].filter(Boolean).join(" · ")}</small></span>
                        <Check aria-hidden />
                      </label>
                    ))}
                    <button type="button" className={styles.textButton} onClick={() => { setVehicleId(null); setError(""); }}>+ Добавить другой автомобиль</button>
                  </div>
                )}
                {!vehicleId && (
                  <div className={styles.vehicleEditor}>
                    <div className={styles.sectionLead}><strong>Добавьте автомобиль</strong><span>Сейчас достаточно марки и модели. Остальные данные помогут нам подготовиться заранее.</span></div>
                    <div className={styles.formGrid}>
                      <label><span>Марка *</span><input value={make} onChange={(event) => { setMake(event.target.value); setError(""); }} placeholder="Например, BMW" autoComplete="organization" /></label>
                      <label><span>Модель *</span><input value={model} onChange={(event) => { setModel(event.target.value); setError(""); }} placeholder="Например, X5" /></label>
                      <label><span>Год {requiredFields.has("year") ? "*" : ""}</span><input value={year} onChange={(event) => { setYear(event.target.value); setError(""); }} placeholder="2020" inputMode="numeric" /></label>
                      <label><span>Госномер {requiredFields.has("plate") ? "*" : ""}</span><input value={plate} onChange={(event) => { setPlate(event.target.value.toUpperCase()); setError(""); }} placeholder="А123ВС39" autoCapitalize="characters" /></label>
                      <label className={styles.wideField}><span>VIN {requiresVin ? "*" : ""}</span><input value={vin} onChange={(event) => { setVin(event.target.value.toUpperCase()); setError(""); }} placeholder="Если знаете — 17 символов" maxLength={17} autoCapitalize="characters" /></label>
                    </div>
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
                        <input type="checkbox" checked={selected} onChange={() => { setServiceIds((current) => selected ? current.filter((id) => id !== service.id) : [...current, service.id]); setError(""); }} />
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
                <div className={styles.stageHeading}><Clock3 aria-hidden /><div><h2>Когда вам удобно приехать?</h2><p>Выберите свободное время и оставьте контакт для подтверждения.</p></div></div>
                <label className={styles.dateField}><span>Дата визита</span><input type="date" value={localDate} min={todayInput()} max={addDays(todayInput(), branch?.bookingHorizonDays ?? 60)} onChange={(event) => setLocalDate(event.target.value)} /></label>
                <div className={styles.slotHeader}><strong>{dateLabel(localDate)}</strong><button type="button" onClick={loadAvailability} disabled={busy}>Обновить</button></div>
                {busy ? <div className={styles.slotSkeleton}><i /><i /><i /><i /></div> : (
                  <div className={styles.slotGrid}>
                    {availability?.slots.map((slot) => (
                      <button type="button" key={`${slot.startsAt}-${slot.master.membershipId}`} className={selectedSlot?.startsAt === slot.startsAt && selectedSlot.master.membershipId === slot.master.membershipId ? styles.selectedSlot : ""} onClick={() => { setSelectedSlot(slot); setError(""); }}>
                        <strong>{slot.localTime}</strong><span>{slot.master.name}</span>
                      </button>
                    ))}
                    {availability && !availability.slots.length && <div className={styles.empty}>На эту дату свободных окон нет. Выберите другой день.</div>}
                  </div>
                )}
                {selectedSlot && (
                  <section className={styles.contactPanel} aria-labelledby="contact-heading">
                    <div className={styles.sectionLead}><strong id="contact-heading">Куда отправить подтверждение?</strong><span>Имя спросим один раз. Телефон уже подставлен — проверьте его перед записью.</span></div>
                    <div className={styles.formGrid}>
                      <label><span>Имя *</span><input value={name} onChange={(event) => { setName(event.target.value); setError(""); }} autoComplete="name" placeholder="Как к вам обращаться" /></label>
                      <label><span>Телефон *</span><input value={phone} onChange={(event) => changePhone(event.target.value)} inputMode="tel" autoComplete="tel" /></label>
                      <label className={styles.wideField}><span>Email {requiredFields.has("email") ? "*" : ""}</span><input value={email} onChange={(event) => { setEmail(event.target.value); setError(""); }} type="email" autoComplete="email" placeholder={requiredFields.has("email") ? "Укажите email" : "Необязательно"} /></label>
                      <label className={styles.wideField}><span>Комментарий</span><textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={3} placeholder="Например, есть шум при повороте руля" /></label>
                    </div>
                    {requiresConfirmation && <p className={styles.pendingNotice}><ShieldCheck aria-hidden /> Время будет временно занято. Администратор проверит данные автомобиля и подтвердит визит.</p>}
                  </section>
                )}
              </div>
            ) : null}

            {error && <div className={styles.error} role="alert">{error}</div>}
            <footer className={styles.stageFooter}>
              {step > 1 && (step > 2 || branches.length > 1)
                ? <button type="button" className={styles.secondaryButton} onClick={() => { setError(""); setStep((current) => Math.max(1, current - 1)); }} disabled={step === 1 || busy}><ArrowLeft aria-hidden /> Назад</button>
                : <span />}
              {step < 4
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
