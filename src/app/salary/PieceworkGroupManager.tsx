"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Archive, Check, Loader2, Pencil, Plus, RefreshCw, X } from "lucide-react";
import { EcoBadge, EcoButton, EcoInput, EcoSelect } from "@/components/platform/EcoUI";

type CatalogGroupKind = "service" | "product";

type CatalogGroup = {
  id: string;
  kind: CatalogGroupKind;
  name: string;
  itemCount: number;
};

type CatalogService = {
  id: string;
  name: string;
  groupId: string | null;
};

type ServiceOperation = {
  code: string;
  title: string;
  groupId: string | null;
};

type PieceworkGroupsPayload = {
  groups?: CatalogGroup[];
  services?: CatalogService[];
  serviceOperations?: ServiceOperation[];
  error?: string;
};

function groupKindLabel(kind: CatalogGroupKind) {
  return kind === "service" ? "Услуги · мастер" : "Товары · администратор";
}

function itemCountLabel(count: number) {
  if (count === 1) return "1 позиция";
  return `${count} позиций`;
}

async function readPayload<T>(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || fallback);
  return payload;
}

export default function PieceworkGroupManager({
  onChanged,
}: {
  onChanged: () => Promise<void> | void;
}) {
  const [groups, setGroups] = useState<CatalogGroup[]>([]);
  const [services, setServices] = useState<CatalogService[]>([]);
  const [serviceOperations, setServiceOperations] = useState<ServiceOperation[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newGroupKind, setNewGroupKind] = useState<CatalogGroupKind>("service");
  const [newGroupName, setNewGroupName] = useState("");
  const [creating, setCreating] = useState(false);
  const [creatingOperations, setCreatingOperations] = useState(false);
  const [busyGroupId, setBusyGroupId] = useState<string | null>(null);
  const [busyServiceId, setBusyServiceId] = useState<string | null>(null);
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await readPayload<PieceworkGroupsPayload>(
        await fetch("/api/piecework-groups", { cache: "no-store" }),
        "Не удалось загрузить группы начислений",
      );
      setGroups(Array.isArray(payload.groups) ? payload.groups : []);
      setServices(Array.isArray(payload.services) ? payload.services : []);
      setServiceOperations(Array.isArray(payload.serviceOperations) ? payload.serviceOperations : []);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Не удалось загрузить группы начислений");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const serviceGroups = useMemo(() => groups.filter((group) => group.kind === "service"), [groups]);
  const productGroups = useMemo(() => groups.filter((group) => group.kind === "product"), [groups]);
  const unaddedOperations = useMemo(
    () => serviceOperations.filter((operation) => !operation.groupId),
    [serviceOperations],
  );

  async function refreshAfterChange(nextMessage: string) {
    await Promise.all([load(), Promise.resolve(onChanged())]);
    setMessage(nextMessage);
  }

  async function createGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newGroupName.trim();
    if (!name) {
      setError("Введите название группы");
      return;
    }

    setCreating(true);
    setError(null);
    setMessage(null);
    try {
      await readPayload(
        await fetch("/api/piecework-groups", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ kind: newGroupKind, name }),
        }),
        "Не удалось добавить группу",
      );
      setNewGroupName("");
      await refreshAfterChange(`Группа «${name}» добавлена`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Не удалось добавить группу");
    } finally {
      setCreating(false);
    }
  }

  async function addServiceOperations(codes: string[]) {
    if (codes.length === 0) return;
    setCreatingOperations(true);
    setError(null);
    setMessage(null);
    try {
      await readPayload(
        await fetch("/api/piecework-groups", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "add-service-operations", codes }),
        }),
        "Не удалось добавить группы операций",
      );
      await refreshAfterChange(codes.length === 1 ? "Группа операции добавлена" : `Добавлено групп операций: ${codes.length}`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Не удалось добавить группы операций");
    } finally {
      setCreatingOperations(false);
    }
  }

  async function saveRename(group: CatalogGroup) {
    const name = renameValue.trim();
    if (!name || name === group.name) {
      setRenamingGroupId(null);
      return;
    }

    setBusyGroupId(group.id);
    setError(null);
    setMessage(null);
    try {
      await readPayload(
        await fetch("/api/piecework-groups", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "rename", groupId: group.id, name }),
        }),
        "Не удалось переименовать группу",
      );
      setRenamingGroupId(null);
      await refreshAfterChange(`Группа переименована в «${name}»`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Не удалось переименовать группу");
    } finally {
      setBusyGroupId(null);
    }
  }

  async function archiveGroup(group: CatalogGroup) {
    if (!window.confirm(`Убрать группу «${group.name}» из настроек начислений? История отгрузок сохранится.`)) return;

    setBusyGroupId(group.id);
    setError(null);
    setMessage(null);
    try {
      await readPayload(
        await fetch("/api/piecework-groups", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "archive", groupId: group.id }),
        }),
        "Не удалось убрать группу",
      );
      await refreshAfterChange(`Группа «${group.name}» убрана из настроек`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Не удалось убрать группу");
    } finally {
      setBusyGroupId(null);
    }
  }

  async function assignService(service: CatalogService, groupId: string) {
    if (service.groupId === (groupId || null)) return;

    setBusyServiceId(service.id);
    setError(null);
    setMessage(null);
    try {
      await readPayload(
        await fetch("/api/piecework-groups", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "assign-service", serviceId: service.id, groupId }),
        }),
        "Не удалось назначить группу услуге",
      );
      await refreshAfterChange(`Для услуги «${service.name}» обновлена группа начисления`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Не удалось назначить группу услуге");
    } finally {
      setBusyServiceId(null);
    }
  }

  function renderGroupSection(kind: CatalogGroupKind, sectionGroups: CatalogGroup[]) {
    return (
      <section className="eco-piecework-group-section" aria-label={groupKindLabel(kind)}>
        <div className="eco-payroll-section-title">
          <strong>{kind === "service" ? "Группы услуг" : "Группы товаров"}</strong>
          <span>{sectionGroups.length}</span>
        </div>
        {sectionGroups.length === 0 ? (
          <div className="eco-piecework-group-empty">
            Нет групп. Добавьте первую группу выше.
          </div>
        ) : (
          <div className="eco-table-wrap">
            <table className="eco-table eco-piecework-group-table">
              <thead>
                <tr>
                  <th>Группа</th>
                  <th>Роль</th>
                  <th>Позиции</th>
                  <th>Действия</th>
                </tr>
              </thead>
              <tbody>
                {sectionGroups.map((group) => {
                  const isRenaming = renamingGroupId === group.id;
                  const isBusy = busyGroupId === group.id;
                  return (
                    <tr key={group.id}>
                      <td>
                        {isRenaming ? (
                          <div className="eco-piecework-group-rename">
                            <EcoInput
                              value={renameValue}
                              onChange={(event) => setRenameValue(event.target.value)}
                              aria-label={`Новое название группы ${group.name}`}
                              autoFocus
                            />
                            <EcoButton type="button" size="sm" variant="primary" onClick={() => void saveRename(group)} disabled={isBusy}>
                              {isBusy ? <Loader2 size={14} className="eco-spin" /> : <Check size={14} />}
                              Сохранить
                            </EcoButton>
                            <EcoButton type="button" size="sm" onClick={() => setRenamingGroupId(null)} disabled={isBusy} aria-label="Отменить переименование">
                              <X size={14} />
                            </EcoButton>
                          </div>
                        ) : (
                          <strong>{group.name}</strong>
                        )}
                      </td>
                      <td>{kind === "service" ? "Мастер" : "Администратор"}</td>
                      <td>{itemCountLabel(group.itemCount)}</td>
                      <td>
                        {!isRenaming && (
                          <div className="eco-piecework-group-actions">
                            <EcoButton
                              type="button"
                              size="sm"
                              onClick={() => {
                                setRenamingGroupId(group.id);
                                setRenameValue(group.name);
                              }}
                              disabled={isBusy}
                            >
                              <Pencil size={14} />
                              Переименовать
                            </EcoButton>
                            <EcoButton
                              type="button"
                              size="sm"
                              variant="danger"
                              onClick={() => void archiveGroup(group)}
                              disabled={isBusy || group.itemCount > 0}
                              title={group.itemCount > 0 ? "Сначала переназначьте позиции из этой группы" : "Убрать группу"}
                            >
                              {isBusy ? <Loader2 size={14} className="eco-spin" /> : <Archive size={14} />}
                              Убрать
                            </EcoButton>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="eco-piecework-group-manager" aria-labelledby="piecework-groups-heading">
      <div className="eco-piecework-group-manager__head">
        <div>
          <div className="eco-page-kicker">Группы начислений</div>
          <h2 id="piecework-groups-heading">Сначала назначьте работы нужным группам</h2>
          <p>
            Например, создайте «Замена моторного масла» и выберите её для соответствующих услуг ниже.
            Правила всегда привязываются к ID группы, а не к её названию.
          </p>
        </div>
        <EcoButton type="button" size="sm" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 size={14} className="eco-spin" /> : <RefreshCw size={14} />}
          Обновить
        </EcoButton>
      </div>

      <div className="eco-piecework-group-steps" role="note">
        <strong>Как это работает</strong>
        <span>1. Добавьте группу. 2. Назначьте ей услуги каталога. 3. Задайте сумму или процент в таблице правил ниже.</span>
      </div>

      <section className="eco-piecework-operation-library" aria-labelledby="piecework-operation-library-heading">
        <div className="eco-payroll-section-title">
          <div>
            <strong id="piecework-operation-library-heading">Готовые операции отгрузок</strong>
            <small>Это реальные виды работ: они получают собственные ID групп и сразу доступны для правила мастера.</small>
          </div>
          {unaddedOperations.length > 0 && (
            <EcoButton type="button" size="sm" variant="primary" onClick={() => void addServiceOperations(unaddedOperations.map((operation) => operation.code))} disabled={creatingOperations}>
              {creatingOperations ? <Loader2 size={14} className="eco-spin" /> : <Plus size={14} />}
              Добавить все ({unaddedOperations.length})
            </EcoButton>
          )}
        </div>
        {loading ? null : (
          <div className="eco-piecework-operation-list">
            {serviceOperations.map((operation) => (
              <div key={operation.code} className="eco-piecework-operation-row">
                <strong>{operation.title}</strong>
                {operation.groupId ? (
                  <EcoBadge tone="success">Добавлена</EcoBadge>
                ) : (
                  <EcoButton type="button" size="sm" variant="primary" onClick={() => void addServiceOperations([operation.code])} disabled={creatingOperations}>
                    Добавить
                  </EcoButton>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <form className="eco-piecework-group-create" onSubmit={createGroup}>
        <label>
          <span>Для кого начисление</span>
          <EcoSelect value={newGroupKind} onChange={(event) => setNewGroupKind(event.target.value as CatalogGroupKind)}>
            <option value="service">Мастер — группа услуг</option>
            <option value="product">Администратор — группа товаров</option>
          </EcoSelect>
        </label>
        <label>
          <span>Название группы</span>
          <EcoInput
            value={newGroupName}
            onChange={(event) => setNewGroupName(event.target.value)}
            placeholder={newGroupKind === "service" ? "Например, Замена моторного масла" : "Например, Расходники"}
            maxLength={120}
          />
        </label>
        <EcoButton type="submit" variant="primary" disabled={creating}>
          {creating ? <Loader2 size={15} className="eco-spin" /> : <Plus size={15} />}
          Добавить группу
        </EcoButton>
      </form>

      {(message || error) && (
        <div className={`eco-piecework-group-feedback ${error ? "is-error" : "is-success"}`} role="status">
          {error ?? message}
        </div>
      )}

      {loading ? (
        <div className="eco-piecework-group-loading"><Loader2 size={16} className="eco-spin" /> Загрузка групп…</div>
      ) : (
        <>
          {renderGroupSection("service", serviceGroups)}
          <section className="eco-piecework-service-assignment" aria-labelledby="piecework-service-assignment-heading">
            <div className="eco-payroll-section-title">
              <div>
                <strong id="piecework-service-assignment-heading">Услуги каталога</strong>
                <small>Меняйте группу у каждой услуги: так «Замена масла» появится отдельной строкой правила мастера.</small>
              </div>
              <span>{services.length}</span>
            </div>
            {services.length === 0 ? (
              <div className="eco-piecework-group-empty">
                В каталоге нет карточек услуг. Добавьте карточку с типом «Услуга» — после этого её можно будет назначить в группу здесь.
              </div>
            ) : (
              <div className="eco-table-wrap">
                <table className="eco-table eco-piecework-service-table">
                  <thead>
                    <tr>
                      <th>Услуга</th>
                      <th>Группа начисления мастера</th>
                    </tr>
                  </thead>
                  <tbody>
                    {services.map((service) => (
                      <tr key={service.id}>
                        <td><strong>{service.name}</strong></td>
                        <td>
                          <div className="eco-piecework-service-select">
                            <EcoSelect
                              value={service.groupId ?? ""}
                              onChange={(event) => void assignService(service, event.target.value)}
                              disabled={busyServiceId === service.id || serviceGroups.length === 0}
                              aria-label={`Группа начисления для услуги ${service.name}`}
                            >
                              <option value="">Не назначена</option>
                              {serviceGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                            </EcoSelect>
                            {busyServiceId === service.id && <Loader2 size={15} className="eco-spin" aria-label="Сохранение" />}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          {renderGroupSection("product", productGroups)}
        </>
      )}
    </section>
  );
}
