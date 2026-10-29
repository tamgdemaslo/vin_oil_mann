"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { EcoBadge, EcoButton, EcoInput, EcoSelect } from "@/components/platform/EcoUI";
import { toServiceDateInput } from "@/lib/date-time";
import { readEmployeePaySettings } from "@/lib/employee-pay-settings";

type Member = { id: string; roleId: string; status: string; paySettingsJson: unknown; user: { login: string; name: string; authRole?: string } };
const ROLES = [
  ["branch_owner", "Владелец филиала", "Управление филиалом, сотрудниками и подключениями. Рабочие, клиентские, складские и финансовые разделы."],
  ["administrator", "Администратор", "Записи, отгрузки, клиенты, сообщения, склад и финансы; управление сотрудниками и настройками записи. Управление интеграциями требует дополнительных прав."],
  ["master", "Мастер-приёмщик", "Все функции администратора в доступном филиале: записи, отгрузки, клиенты, сообщения, склад, финансы, сотрудники и настройки записи. Роль и правила зарплаты сохраняются."],
  ["mechanic", "Механик", "Записи, журнал отгрузок, клиентская история и товары. В меню нет создания отгрузки, складских операций, общих финансов и ИИ-помощника."],
  ["accountant", "Бухгалтер", "Финансы, склад, клиентская история и реквизиты организаций. Без рабочего журнала записей, создания отгрузок и управления сотрудниками."],
  ["viewer", "Наблюдатель", "Главная и личный кабинет. Рабочие, клиентские, складские и финансовые разделы по умолчанию не доступны."],
] as const;
async function read(response: Response) {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Не удалось сохранить изменение");
  return data;
}
export default function EmployeeRoles({ branchId, canDismiss, ownLogin }: { branchId: string; canDismiss: boolean; ownLogin: string }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const [archive, setArchive] = useState(false);
  const [dismissId, setDismissId] = useState("");
  const [lastDay, setLastDay] = useState(() => toServiceDateInput(new Date()));
  const endpoint = `/api/branches/${encodeURIComponent(branchId)}/members`;
  const load = useCallback(async () => {
    setLoading(true);
    try { const data = await read(await fetch(endpoint, { cache: "no-store" })); setMembers(data.memberships ?? []); }
    catch (error) { setError(error instanceof Error ? error.message : "Не удалось загрузить сотрудников"); }
    finally { setLoading(false); }
  }, [endpoint]);
  useEffect(() => { void load(); }, [load]);
  async function update(id: string, body: object, message: string) {
    setBusy(id); setError(""); setNotice("");
    try {
      await read(await fetch(`${endpoint}/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
      setNotice(message); setDismissId(""); await load();
    } catch (error) { setError(error instanceof Error ? error.message : "Не удалось сохранить"); }
    finally { setBusy(""); }
  }
  const dismissed = members.filter((member) => readEmployeePaySettings(member.paySettingsJson).employmentEnd);
  const visible = archive ? dismissed : members.filter((member) => !readEmployeePaySettings(member.paySettingsJson).employmentEnd);
  return <main className="eco-page eco-page--wide">
    <div className="eco-page-head"><div><h1 className="eco-page-title">Роли и сотрудники</h1><p className="eco-page-subtitle">Доступ к филиалу, состав команды и завершение работы сотрудника.</p></div><Link className="eco-btn" href={`/cabinet/branches?branch=${encodeURIComponent(branchId)}&tab=employees`}>Добавить сотрудника</Link></div>
    <p>Отключение доступа запрещает вход в филиал, но сохраняет сотрудника в расчёте зарплаты. «Уволить» также прекращает начисления после последнего рабочего дня. История и выплаты сохраняются.</p>
    <div className="eco-employees-toolbar"><EcoButton aria-pressed={!archive} onClick={() => setArchive(false)}>Работают ({members.length - dismissed.length})</EcoButton><EcoButton aria-pressed={archive} onClick={() => setArchive(true)}>Уволены ({dismissed.length})</EcoButton><a href="#roles-help" onClick={() => setHelpOpen(true)}>Чем отличаются роли</a></div>
    {error && <p role="alert" className="eco-employees-error">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {loading ? <p role="status">Загрузка сотрудников…</p> : visible.length === 0 ? <p>{archive ? "Уволенных сотрудников нет." : "В филиале пока нет сотрудников. Добавьте сотрудника для настройки роли и зарплаты."}</p> : <div className="eco-table-wrap"><table className="eco-table"><thead><tr><th>Сотрудник</th><th>Роль в филиале</th><th>Доступ / статус</th><th>Действия</th></tr></thead><tbody>{visible.map((member) => {
      const settings = readEmployeePaySettings(member.paySettingsJson);
      const own = member.user.login.toLowerCase() === ownLogin.toLowerCase();
      return <tr key={member.id}><td><strong>{member.user.name}</strong><div>{member.user.login}</div></td><td><EcoSelect aria-label={`Роль: ${member.user.name}`} value={member.roleId} disabled={Boolean(busy) || Boolean(settings.employmentEnd) || own} onChange={(event) => void update(member.id, { roleId: event.target.value }, "Роль обновлена")}>
        {ROLES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</EcoSelect></td><td>{settings.employmentEnd ? <span>Уволен · последний день {settings.employmentEnd}</span> : <EcoBadge tone={member.status === "active" ? "success" : "neutral"}>{member.status === "active" ? "Доступ открыт" : "Доступ отключён"}</EcoBadge>}</td><td><div className="eco-employees-actions">
        {!settings.employmentEnd && <EcoButton disabled={Boolean(busy) || own} onClick={() => void update(member.id, { status: member.status === "active" ? "disabled" : "active" }, "Доступ обновлён")}>{member.status === "active" ? "Отключить доступ" : "Включить доступ"}</EcoButton>}
        {canDismiss && !settings.employmentEnd && !own && member.roleId !== "branch_owner" && <EcoButton disabled={Boolean(busy)} onClick={() => { setDismissId(member.id); setLastDay(toServiceDateInput(new Date())); }}>Уволить</EcoButton>}
        <Link href={settings.employmentEnd ? "/employees/salary?tab=history" : `/employees/salary?tab=rules&employee=${encodeURIComponent(member.user.login)}`}>{settings.employmentEnd ? "История зарплаты" : "Правила зарплаты"}</Link>
        {dismissId === member.id && <form className="eco-employees-dismiss" onSubmit={(event) => { event.preventDefault(); void update(member.id, { employmentEnd: lastDay }, "Сотрудник уволен. История и расчёты сохранены."); }}><label>Последний рабочий день<EcoInput type="date" value={lastDay} max={toServiceDateInput(new Date())} required onChange={(event) => setLastDay(event.target.value)} /></label><p>Сотрудник получит начисления по этот день включительно. Доступ к этому филиалу будет отключён сейчас; будущие смены перестанут участвовать в расчёте. История и выплаты останутся.</p><EcoButton type="submit" disabled={Boolean(busy)} variant="primary">Подтвердить увольнение</EcoButton><EcoButton type="button" disabled={Boolean(busy)} onClick={() => setDismissId("")}>Отмена</EcoButton></form>}
      </div></td></tr>;
    })}</tbody></table></div>}
    <details id="roles-help" className="eco-employees-help" open={helpOpen} onToggle={(event) => setHelpOpen(event.currentTarget.open)}><summary>Справка: чем отличаются роли и правила зарплаты</summary><p>Роль филиала определяет доступные разделы и действия. Индивидуальные разрешения могут расширять доступ. Начисления настраиваются отдельно в «Зарплата → Правила» и не меняют доступ сотрудника.</p><div className="eco-table-wrap"><table className="eco-table"><thead><tr><th>Роль филиала</th><th>Различия по умолчанию</th></tr></thead><tbody>{ROLES.map(([id, label, description]) => <tr key={id}><th>{label}</th><td>{description}</td></tr>)}</tbody></table></div>
    <p>Дополнительно у учётной записи есть общий уровень: владелец, администратор или мастер. Владелец меняет зарплатные правила, назначает смены и выполняет увольнение. Администратор и мастер видят собственную зарплату; рабочие действия требуют открытой кассовой смены. Изменение роли филиала не меняет сохранённый уровень аккаунта. Мастер-приёмщик получает доступ администратора только в выбранном филиале; механик, бухгалтер и наблюдатель сохраняют свои права.</p>
    <p>Роли группы: владелец и администратор группы управляют филиалами; аналитик группы получает сводный просмотр и аналитику. Групповые права могут расширять права роли филиала.</p>
    <p>Общие зарплатные правила назначаются расчётным ролям «Мастер» и «Администратор» по общему уровню учётной записи. Для любого сотрудника можно вместо этого задать собственный набор: услуги, группы товаров, все услуги и/или все товары. Конкретное правило имеет приоритет над общим правилом категории. Процент за услуги считается от суммы после скидки, за товары — от прибыли после себестоимости; фикс — за единицу.</p>
    <p>Индивидуальные правила применяются только к назначенным сменам сотрудника. Если в смене несколько сотрудников с одинаковым общим правилом роли, автоматического деления нет: расчёт покажет конфликт. Индивидуальные правила позволяют явно задать начисления каждому.</p>
    </details>
  </main>;
}
