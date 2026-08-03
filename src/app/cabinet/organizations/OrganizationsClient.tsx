"use client";

import Link from "next/link";
import { Archive, ArchiveRestore, Building2, CheckCircle2, Eye, Pencil, Plus, RefreshCw, Star, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { EcoBadge, EcoButton, EcoInput, EcoKpi, EcoSelect, EcoTable } from "@/components/platform/EcoUI";

type Organization = {
  id: string;
  name: string;
  entityType: string;
  fullLegalName: string;
  inn: string;
  kpp: string;
  ogrn: string;
  ogrnip: string;
  legalAddress: string;
  actualAddress: string;
  phone: string;
  email: string;
  website: string;
  taxSystem: string;
  vatEnabled: boolean;
  defaultVatRate: number | null;
  currency: string;
  bankName: string;
  bik: string;
  checkingAccount: string;
  correspondentAccount: string;
  signatoryName: string;
  signatoryPosition: string;
  signatoryAuthority: string;
  shipmentPrefix: string;
  workOrderPrefix: string;
  actPrefix: string;
  updPrefix: string;
  isDefault: boolean;
  isActive: boolean;
  status: "active" | "archive";
  storesCount: number;
  employeesCount: number;
  demandsCount: number;
  closingDocumentsCount: number;
  cashExpenseOrdersCount: number;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
};

type OrganizationForm = Omit<Organization, "id" | "status" | "storesCount" | "employeesCount" | "demandsCount" | "closingDocumentsCount" | "cashExpenseOrdersCount" | "createdAt" | "updatedAt">;

const EMPTY_FORM: OrganizationForm = {
  name: "",
  entityType: "ip",
  fullLegalName: "",
  inn: "",
  kpp: "",
  ogrn: "",
  ogrnip: "",
  legalAddress: "",
  actualAddress: "",
  phone: "",
  email: "",
  website: "",
  taxSystem: "УСН",
  vatEnabled: false,
  defaultVatRate: null,
  currency: "RUB",
  bankName: "",
  bik: "",
  checkingAccount: "",
  correspondentAccount: "",
  signatoryName: "",
  signatoryPosition: "",
  signatoryAuthority: "",
  shipmentPrefix: "",
  workOrderPrefix: "",
  actPrefix: "",
  updPrefix: "",
  isDefault: false,
  isActive: true,
};

function dateRu(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("ru-RU");
}

function entityTypeLabel(value: string) {
  if (value === "ip") return "ИП";
  if (value === "ooo") return "ООО";
  return "Юрлицо";
}

function requisitesLine(org: Organization) {
  return [
    org.inn ? `ИНН ${org.inn}` : "",
    org.kpp ? `КПП ${org.kpp}` : "",
    org.ogrnip ? `ОГРНИП ${org.ogrnip}` : org.ogrn ? `ОГРН ${org.ogrn}` : "",
  ].filter(Boolean).join(" · ") || "реквизиты не заполнены";
}

function formFromOrganization(org: Organization): OrganizationForm {
  return {
    name: org.name,
    entityType: org.entityType,
    fullLegalName: org.fullLegalName,
    inn: org.inn,
    kpp: org.kpp,
    ogrn: org.ogrn,
    ogrnip: org.ogrnip,
    legalAddress: org.legalAddress,
    actualAddress: org.actualAddress,
    phone: org.phone,
    email: org.email,
    website: org.website,
    taxSystem: org.taxSystem,
    vatEnabled: org.vatEnabled,
    defaultVatRate: org.defaultVatRate,
    currency: org.currency,
    bankName: org.bankName,
    bik: org.bik,
    checkingAccount: org.checkingAccount,
    correspondentAccount: org.correspondentAccount,
    signatoryName: org.signatoryName,
    signatoryPosition: org.signatoryPosition,
    signatoryAuthority: org.signatoryAuthority,
    shipmentPrefix: org.shipmentPrefix,
    workOrderPrefix: org.workOrderPrefix,
    actPrefix: org.actPrefix,
    updPrefix: org.updPrefix,
    isDefault: org.isDefault,
    isActive: org.isActive,
  };
}

async function readJson<T>(response: Response, fallback: T): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    return fallback;
  }
}

export default function OrganizationsClient() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<Organization | null>(null);
  const [editing, setEditing] = useState<Organization | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<OrganizationForm>(EMPTY_FORM);

  const stats = useMemo(() => {
    const active = organizations.filter((org) => org.isActive).length;
    const archived = organizations.length - active;
    const defaultOrg = organizations.find((org) => org.isDefault);
    return { active, archived, defaultOrg };
  }, [organizations]);

  const loadOrganizations = useCallback(async () => {
    setLoading(true);
    setError(null);
    const response = await fetch("/api/organizations", { cache: "no-store" });
    const data = await readJson<{ organizations?: Organization[]; error?: string }>(response, {});
    if (!response.ok) {
      setError(data.error ?? "Не удалось загрузить организации");
      setOrganizations([]);
    } else {
      setOrganizations(data.organizations ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadOrganizations(), 0);
    return () => window.clearTimeout(timer);
  }, [loadOrganizations]);

  function openCreate() {
    setEditing(null);
    setForm({ ...EMPTY_FORM, isDefault: organizations.filter((org) => org.isActive).length === 0 });
    setFormOpen(true);
    setMessage(null);
    setError(null);
  }

  function openEdit(org: Organization) {
    setEditing(org);
    setForm(formFromOrganization(org));
    setFormOpen(true);
    setMessage(null);
    setError(null);
  }

  function setField<K extends keyof OrganizationForm>(key: K, value: OrganizationForm[K]) {
    setForm((prev) => ({
      ...prev,
      [key]: value,
      ...(key === "entityType" && value === "ip" ? { kpp: "", ogrn: "" } : {}),
    }));
  }

  async function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    const payload = {
      ...form,
      fullLegalName: form.fullLegalName.trim() || null,
      defaultVatRate: form.vatEnabled ? form.defaultVatRate : null,
    };
    const response = await fetch(editing ? `/api/organizations/${editing.id}` : "/api/organizations", {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await readJson<Organization & { error?: string }>(response, {} as Organization);
    setSaving(false);
    if (!response.ok) {
      setError(data.error ?? "Не удалось сохранить организацию");
      return;
    }
    setFormOpen(false);
    setEditing(null);
    setMessage(editing ? "Организация обновлена. Новые реквизиты будут использоваться только в новых документах." : "Организация создана");
    await loadOrganizations();
  }

  async function runAction(org: Organization, action: "default" | "archive" | "restore" | "delete") {
    setSaving(true);
    setError(null);
    setMessage(null);
    let response: Response;
    if (action === "default") {
      response = await fetch(`/api/organizations/${org.id}/set-default`, { method: "POST" });
    } else if (action === "archive") {
      if (!window.confirm(`Перенести организацию "${org.name}" в архив? Она останется в старых документах и не будет доступна для новых.`)) {
        setSaving(false);
        return;
      }
      response = await fetch(`/api/organizations/${org.id}/archive`, { method: "POST" });
    } else if (action === "restore") {
      response = await fetch(`/api/organizations/${org.id}/restore`, { method: "POST" });
    } else {
      const checkResponse = await fetch(`/api/organizations/${org.id}/deletion-check`, { cache: "no-store" });
      const check = await readJson<{
        canDelete?: boolean;
        canArchive?: boolean;
        linkedCounts?: Record<string, number>;
        blockers?: string[];
        error?: string;
      }>(checkResponse, {});
      if (!checkResponse.ok) {
        setSaving(false);
        setError(check.error ?? "Не удалось проверить удаление");
        return;
      }
      const linked = check.linkedCounts
        ? Object.entries(check.linkedCounts).filter(([, count]) => count > 0).map(([key, count]) => `${key}: ${count}`).join(", ")
        : "";
      if (!check.canDelete) {
        setSaving(false);
        setError(`Организация уже используется${linked ? `: ${linked}` : ""}. Полное удаление запрещено, используйте архив.`);
        return;
      }
      if (!window.confirm(`Удалить организацию "${org.name}" безвозвратно?`)) {
        setSaving(false);
        return;
      }
      response = await fetch(`/api/organizations/${org.id}`, { method: "DELETE" });
    }
    const data = await readJson<{ error?: string; linkedCounts?: Record<string, number> }>(response, {});
    setSaving(false);
    if (!response.ok) {
      const suffix = data.linkedCounts
        ? ` Связи: ${Object.entries(data.linkedCounts).filter(([, count]) => count > 0).map(([key, count]) => `${key}: ${count}`).join(", ")}.`
        : "";
      setError(`${data.error ?? "Операция не выполнена"}.${suffix}`);
      return;
    }
    setMessage(action === "delete" ? "Организация удалена" : action === "default" ? "Основная организация обновлена" : action === "restore" ? "Организация восстановлена" : "Организация перенесена в архив");
    await loadOrganizations();
  }

  return (
    <main className="eco-page eco-organizations-page">
      <section className="eco-page-head eco-organizations-head">
        <div>
          <div className="eco-page-crumbs">
            <Link href="/">Главная</Link>
            <span className="sep">/</span>
            <Link href="/cabinet">Кабинет</Link>
            <span className="sep">/</span>
            <span className="cur">Организации</span>
          </div>
          <div className="eco-title-row">
            <h1 className="eco-page-title">Организации</h1>
            <EcoBadge tone="info" dot>
              реквизиты из БД
            </EcoBadge>
          </div>
          <p className="eco-page-subtitle">Юридические данные, банк, налоги и контекст новых документов.</p>
        </div>
        <div className="eco-page-actions">
          <EcoButton type="button" onClick={() => void loadOrganizations()} disabled={loading || saving}>
            <RefreshCw aria-hidden className="eco-icon" />
            Обновить
          </EcoButton>
          <EcoButton type="button" variant="primary" onClick={openCreate}>
            <Plus aria-hidden className="eco-icon" />
            Новая организация
          </EcoButton>
        </div>
      </section>

      <div className="eco-grid eco-grid--kpi eco-organizations-kpis">
        <EcoKpi label="Активные" value={activeValue(stats.active, loading)} tone="success" />
        <EcoKpi label="Архив" value={activeValue(stats.archived, loading)} tone="warning" />
        <EcoKpi label="Основная" value={stats.defaultOrg?.name ?? "не выбрана"} sub={stats.defaultOrg ? requisitesLine(stats.defaultOrg) : undefined} tone="rust" />
      </div>

      {message && <div className="eco-form-hint eco-organizations-message">{message}</div>}
      {error && <div className="eco-form-error eco-organizations-message">{error}</div>}

      <section className="eco-card eco-organizations-table-card">
        <div className="eco-card__head">
          <div>
            <div className="eco-page-kicker">Список</div>
            <h2 className="eco-stock-doc-title">Организации пользователя</h2>
          </div>
        </div>
        <EcoTable className="eco-organizations-table-wrap">
          <thead>
            <tr>
              <th>Краткое название</th>
              <th>Юридическое название</th>
              <th>Реквизиты</th>
              <th>Статус</th>
              <th>Связи</th>
              <th>Создана</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7}>Загружаем организации...</td></tr>
            ) : organizations.length === 0 ? (
              <tr><td colSpan={7}>Организации ещё не созданы.</td></tr>
            ) : organizations.map((org) => (
              <tr key={org.id}>
                <td>
                  <div className="eco-org-name-cell">
                    <Building2 size={16} aria-hidden />
                    <div>
                      <strong>{org.name}</strong>
                      <span>{entityTypeLabel(org.entityType)}</span>
                    </div>
                  </div>
                </td>
                <td>{org.fullLegalName || "—"}</td>
                <td>{requisitesLine(org)}</td>
                <td>
                  <div className="eco-org-badges">
                    <EcoBadge tone={org.isActive ? "success" : "warning"} dot>{org.isActive ? "активна" : "архив"}</EcoBadge>
                    {org.isDefault && <EcoBadge tone="rust"><Star size={12} aria-hidden /> основная</EcoBadge>}
                  </div>
                </td>
                <td>
                  <span className="eco-org-links">
                    складов {org.storesCount} · сотрудников {org.employeesCount}
                  </span>
                </td>
                <td>{dateRu(org.createdAt)}</td>
                <td>
                  <div className="eco-row-actions eco-org-actions">
                    <button type="button" title="Открыть" onClick={() => setDetail(org)}><Eye aria-hidden /></button>
                    <button type="button" title="Редактировать" onClick={() => openEdit(org)}><Pencil aria-hidden /></button>
                    <button type="button" title="Сделать основной" disabled={!org.isActive || org.isDefault || saving} onClick={() => void runAction(org, "default")}><CheckCircle2 aria-hidden /></button>
                    {org.isActive ? (
                      <button type="button" title="Архивировать" disabled={org.isDefault || saving} onClick={() => void runAction(org, "archive")}><Archive aria-hidden /></button>
                    ) : (
                      <button type="button" title="Восстановить" disabled={saving} onClick={() => void runAction(org, "restore")}><ArchiveRestore aria-hidden /></button>
                    )}
                    <button type="button" title="Удалить" disabled={saving} onClick={() => void runAction(org, "delete")}><Trash2 aria-hidden /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </EcoTable>
      </section>

      {detail && <OrganizationDetail org={detail} onClose={() => setDetail(null)} onEdit={() => { setDetail(null); openEdit(detail); }} />}
      {formOpen && (
        <OrganizationFormDrawer
          form={form}
          editing={editing}
          saving={saving}
          onClose={() => {
            if (!saving) setFormOpen(false);
          }}
          onSubmit={submitForm}
          onField={setField}
        />
      )}
    </main>
  );
}

function activeValue(value: number, loading: boolean) {
  return loading ? "..." : value.toLocaleString("ru-RU");
}

function OrganizationDetail({ org, onClose, onEdit }: { org: Organization; onClose: () => void; onEdit: () => void }) {
  const rows = [
    ["Тип", entityTypeLabel(org.entityType)],
    ["Краткое название", org.name],
    ["Полное название", org.fullLegalName],
    ["ИНН", org.inn],
    ["КПП", org.kpp],
    ["ОГРН/ОГРНИП", org.ogrnip || org.ogrn],
    ["Юридический адрес", org.legalAddress],
    ["Фактический адрес", org.actualAddress],
    ["Телефон", org.phone],
    ["Email", org.email],
    ["Сайт", org.website],
    ["Налоги", [org.taxSystem, org.vatEnabled ? `НДС ${org.defaultVatRate ?? 0}%` : "без НДС", org.currency].filter(Boolean).join(" · ")],
    ["Банк", [org.bankName, org.bik ? `БИК ${org.bik}` : "", org.checkingAccount].filter(Boolean).join(" · ")],
    ["Подписант", [org.signatoryPosition, org.signatoryName, org.signatoryAuthority].filter(Boolean).join(" · ")],
    ["Префиксы", [org.shipmentPrefix && `отгрузки ${org.shipmentPrefix}`, org.workOrderPrefix && `заказ-наряды ${org.workOrderPrefix}`, org.actPrefix && `акты ${org.actPrefix}`, org.updPrefix && `УПД ${org.updPrefix}`].filter(Boolean).join(" · ")],
  ];
  return (
    <div className="eco-org-drawer-backdrop" role="presentation" onMouseDown={onClose}>
      <aside className="eco-org-drawer" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <header className="eco-org-drawer__head">
          <div>
            <span>Организация</span>
            <h2>{org.name}</h2>
            <p>{requisitesLine(org)}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Закрыть"><X aria-hidden /></button>
        </header>
        <div className="eco-org-drawer__body">
          <div className="eco-org-detail-badges">
            <EcoBadge tone={org.isActive ? "success" : "warning"} dot>{org.isActive ? "активна" : "архив"}</EcoBadge>
            {org.isDefault && <EcoBadge tone="rust">основная</EcoBadge>}
          </div>
          <dl className="eco-org-detail-list">
            {rows.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value || "—"}</dd>
              </div>
            ))}
          </dl>
        </div>
        <footer className="eco-org-drawer__footer">
          <EcoButton type="button" variant="primary" onClick={onEdit}>
            <Pencil aria-hidden className="eco-icon" />
            Редактировать
          </EcoButton>
          <EcoButton type="button" variant="ghost" onClick={onClose}>Закрыть</EcoButton>
        </footer>
      </aside>
    </div>
  );
}

function OrganizationFormDrawer({
  form,
  editing,
  saving,
  onClose,
  onSubmit,
  onField,
}: {
  form: OrganizationForm;
  editing: Organization | null;
  saving: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onField: <K extends keyof OrganizationForm>(key: K, value: OrganizationForm[K]) => void;
}) {
  const isIp = form.entityType === "ip";
  return (
    <div className="eco-org-drawer-backdrop" role="presentation" onMouseDown={onClose}>
      <aside className="eco-org-drawer eco-org-form-drawer" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <header className="eco-org-drawer__head">
          <div>
            <span>{editing ? "Редактирование" : "Новая организация"}</span>
            <h2>{editing ? editing.name : "Реквизиты организации"}</h2>
            <p>Новые реквизиты будут использоваться в новых документах. Ранее выпущенные документы не изменятся.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Закрыть" disabled={saving}><X aria-hidden /></button>
        </header>
        <form id="organization-form" className="eco-org-form" onSubmit={onSubmit}>
          <FormSection title="Основное">
            <Field label="Тип">
              <EcoSelect value={form.entityType} onChange={(event) => onField("entityType", event.target.value)}>
                <option value="ip">ИП</option>
                <option value="ooo">ООО</option>
                <option value="legal_entity">Другое юридическое лицо</option>
              </EcoSelect>
            </Field>
            <Field label="Краткое название">
              <EcoInput value={form.name} onChange={(event) => onField("name", event.target.value)} required />
            </Field>
            <Field label="Полное юридическое название">
              <EcoInput value={form.fullLegalName} placeholder={isIp && form.name ? "Будет сформировано автоматически" : ""} onChange={(event) => onField("fullLegalName", event.target.value)} />
            </Field>
            <Field label="ИНН">
              <EcoInput value={form.inn} onChange={(event) => onField("inn", event.target.value)} />
            </Field>
            {!isIp && (
              <Field label="КПП">
                <EcoInput value={form.kpp} onChange={(event) => onField("kpp", event.target.value)} />
              </Field>
            )}
            {!isIp && (
              <Field label="ОГРН">
                <EcoInput value={form.ogrn} onChange={(event) => onField("ogrn", event.target.value)} />
              </Field>
            )}
            {isIp && (
              <Field label="ОГРНИП">
                <EcoInput value={form.ogrnip} onChange={(event) => onField("ogrnip", event.target.value)} />
              </Field>
            )}
            <Field label="Юридический адрес">
              <EcoInput value={form.legalAddress} onChange={(event) => onField("legalAddress", event.target.value)} />
            </Field>
            <Field label="Фактический адрес">
              <EcoInput value={form.actualAddress} onChange={(event) => onField("actualAddress", event.target.value)} />
            </Field>
            <Field label="Телефон">
              <EcoInput value={form.phone} onChange={(event) => onField("phone", event.target.value)} />
            </Field>
            <Field label="Email">
              <EcoInput type="email" value={form.email} onChange={(event) => onField("email", event.target.value)} />
            </Field>
            <Field label="Сайт">
              <EcoInput value={form.website} onChange={(event) => onField("website", event.target.value)} />
            </Field>
          </FormSection>

          <FormSection title="Налоги">
            <Field label="Система налогообложения">
              <EcoInput value={form.taxSystem} onChange={(event) => onField("taxSystem", event.target.value)} />
            </Field>
            <label className="eco-org-check">
              <input type="checkbox" checked={form.vatEnabled} onChange={(event) => onField("vatEnabled", event.target.checked)} />
              <span>Работает с НДС</span>
            </label>
            <Field label="Ставка НДС">
              <EcoInput type="number" min={0} max={100} value={form.defaultVatRate ?? ""} disabled={!form.vatEnabled} onChange={(event) => onField("defaultVatRate", event.target.value ? Number(event.target.value) : null)} />
            </Field>
            <Field label="Валюта">
              <EcoSelect value={form.currency} onChange={(event) => onField("currency", event.target.value)}>
                <option value="RUB">RUB</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </EcoSelect>
            </Field>
          </FormSection>

          <FormSection title="Банковские реквизиты">
            <Field label="Банк">
              <EcoInput value={form.bankName} onChange={(event) => onField("bankName", event.target.value)} />
            </Field>
            <Field label="БИК">
              <EcoInput value={form.bik} onChange={(event) => onField("bik", event.target.value)} />
            </Field>
            <Field label="Расчётный счёт">
              <EcoInput value={form.checkingAccount} onChange={(event) => onField("checkingAccount", event.target.value)} />
            </Field>
            <Field label="Корреспондентский счёт">
              <EcoInput value={form.correspondentAccount} onChange={(event) => onField("correspondentAccount", event.target.value)} />
            </Field>
          </FormSection>

          <FormSection title="Подписант">
            <Field label="Ф. И. О.">
              <EcoInput value={form.signatoryName} onChange={(event) => onField("signatoryName", event.target.value)} />
            </Field>
            <Field label="Должность">
              <EcoInput value={form.signatoryPosition} onChange={(event) => onField("signatoryPosition", event.target.value)} />
            </Field>
            <Field label="Основание полномочий">
              <EcoInput value={form.signatoryAuthority} onChange={(event) => onField("signatoryAuthority", event.target.value)} />
            </Field>
          </FormSection>

          <FormSection title="Настройки документов">
            <Field label="Префикс отгрузок">
              <EcoInput value={form.shipmentPrefix} onChange={(event) => onField("shipmentPrefix", event.target.value)} />
            </Field>
            <Field label="Префикс заказ-нарядов">
              <EcoInput value={form.workOrderPrefix} onChange={(event) => onField("workOrderPrefix", event.target.value)} />
            </Field>
            <Field label="Префикс актов">
              <EcoInput value={form.actPrefix} onChange={(event) => onField("actPrefix", event.target.value)} />
            </Field>
            <Field label="Префикс УПД">
              <EcoInput value={form.updPrefix} onChange={(event) => onField("updPrefix", event.target.value)} />
            </Field>
            <label className="eco-org-check">
              <input type="checkbox" checked={form.isDefault} disabled={!form.isActive} onChange={(event) => onField("isDefault", event.target.checked)} />
              <span>Организация по умолчанию для новых документов</span>
            </label>
          </FormSection>
        </form>
        <footer className="eco-org-drawer__footer">
          <span>Ранее выпущенные закрывающие документы сохраняют snapshot реквизитов.</span>
          <div>
            <EcoButton type="button" variant="ghost" onClick={onClose} disabled={saving}>Отмена</EcoButton>
            <EcoButton type="submit" form="organization-form" variant="primary" disabled={saving || !form.name.trim()}>
              {saving ? "Сохраняем..." : "Сохранить"}
            </EcoButton>
          </div>
        </footer>
      </aside>
    </div>
  );
}

function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="eco-org-form-section">
      <h3>{title}</h3>
      <div className="eco-org-form-grid">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="eco-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
