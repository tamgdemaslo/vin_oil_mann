"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { expiryLabel, loyaltyDate, loyaltyMoney, loyaltyNumber, loyaltyRequest } from "./client";

const operations: Record<string, string> = {
  LINKED: "Привязка карточки", LINK_REVIEW: "Совпадение передано управляющему",
  PURCHASE_SPEND: "Списание за покупку", PURCHASE_EARN: "Начисление за покупку",
  PURCHASE_SPEND_RESTORED: "Восстановление списанных бонусов", PURCHASE_REVERSED: "Сторно начисления",
  EXPIRED: "Истечение срока", RESTORATION_EXPIRED: "Истечение восстановленных бонусов",
  CARD_EXCLUDED: "Карточка исключена из программы", CARD_RESTORED: "Участие карточки восстановлено",
  DEBT_PAYMENT: "Погашение отрицательного остатка", CAMPAIGN: "Акция",
  MANUAL_GRANT: "Ручное начисление", MANUAL_REMOVE: "Ручное списание", COMPENSATION: "Компенсация",
};
type Info = {
  status: string; branchId: string; balance?: number; available?: number; centsPerPoint?: number; compensationLimit?: number;
  expires?: { at: string; points: number }; permissions: { owner: boolean; manager: boolean; master: boolean };
  candidates?: { id: string; displayName: string }[];
  history?: { id: string; kind: string; points: number; shipmentId?: string; reason?: string; actor: string; createdAt: string }[];
};

export function ClientLoyalty({ clientId, shipmentId }: { clientId: string; shipmentId?: string }) {
  const endpoint = `/api/loyalty/clients/${encodeURIComponent(clientId)}`;
  const [info, setInfo] = useState<Info>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [adjust, setAdjust] = useState(false);
  const [remove, setRemove] = useState(false);
  const [choice, setChoice] = useState("");
  const [reviewReason, setReviewReason] = useState("");
  const [eligibilityReason, setEligibilityReason] = useState("");
  const replay = useRef<{ body: string; key: string } | null>(null);
  const load = useCallback(() => loyaltyRequest<Info>(endpoint).then(setInfo), [endpoint]);
  useEffect(() => {
    let stale = false;
    loyaltyRequest<Info>(endpoint).then((result) => { if (!stale) setInfo(result); })
      .catch((reason: Error) => { if (!stale) setError(reason.message); });
    return () => { stale = true; };
  }, [endpoint]);
  if (info && ["disabled", "ineligible"].includes(info.status)) return null;
  const canAdjust = info && (info.permissions.owner || (info.permissions.master && shipmentId));
  async function mutate(body: Record<string, unknown>, success: string) {
    if (!info || busy) return;
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await loyaltyRequest(endpoint, { ...body, branchId: info.branchId });
      setNotice(success);
      setAdjust(false);
      replay.current = null;
      await load();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const body = { action: "adjust", points: Number(data.get("points")), reason: String(data.get("reason")),
      expires: remove ? null : String(data.get("expires") || "") || null, remove,
      shipmentId: info?.permissions.owner ? undefined : shipmentId };
    const serialized = JSON.stringify(body);
    const key = replay.current?.body === serialized ? replay.current.key : crypto.randomUUID();
    replay.current = { body: serialized, key };
    void mutate({ ...body, requestKey: key }, remove ? "Бонусы списаны" : "Бонусы начислены");
  }
  return (
    <fieldset className="eco-loyalty-panel" disabled={busy}>
      <legend>Программа лояльности</legend>
      {!info && !error && <p role="status">Загружаем бонусный счёт…</p>}
      {error && <p role="alert">{error} {!info && <button type="button" className="eco-btn" onClick={() => {
        setError(""); void load().catch((reason: Error) => setError(reason.message));
      }}>Повторить</button>}</p>}
      {notice && <p role="status">{notice}</p>}
      {info?.status === "linked" && <>
        <dl className="eco-loyalty-metrics">
          <div><dt>Баланс</dt><dd>{loyaltyNumber(info.balance ?? 0)}</dd></div>
          <div><dt>Доступно списать</dt><dd>{loyaltyNumber(info.available ?? 0)} · {loyaltyMoney((info.available ?? 0) * (info.centsPerPoint ?? 100))}</dd></div>
          {info.expires && <div><dt>Действуют до {expiryLabel(info.expires.at)}</dt><dd>{loyaltyNumber(info.expires.points)}</dd></div>}
        </dl>
        {!!info.history?.length && <details>
          <summary>История операций филиала</summary>
          <ul className="eco-loyalty-history">
            {info.history.map((item) => {
              const kind = item.kind.split(":")[0];
              return <li key={item.id}>
                <strong>{operations[kind] ?? kind} {item.points ? `· ${item.points > 0 ? "+" : ""}${loyaltyNumber(item.points)}` : ""}</strong>
                <br />{loyaltyDate(item.createdAt)} · {item.actor}
                {item.shipmentId && <>{ " · " }<Link href={`/shipment/${encodeURIComponent(item.shipmentId)}`}>Отгрузка</Link></>}
                {item.reason && <p>{kind === "EXPIRED" || kind === "RESTORATION_EXPIRED" ? expiryLabel(item.reason) : item.reason}</p>}
              </li>;
            })}
          </ul>
        </details>}
      </>}
      {info?.status === "new" && <p>Начальный баланс 0. Счёт открывается с первым начислением.</p>}
      {info?.status === "incomplete" && <p>Добавьте телефон, чтобы открыть бонусный счёт.</p>}
      {info?.status === "confirm" && <>
        <p>Найден счёт по телефону. Уточните у клиента, что это его счёт.</p>
        <button type="button" className="eco-btn" onClick={() => void mutate({ action: "confirm" }, "Карточка привязана")}>Подтвердить со слов клиента</button>
      </>}
      {info?.status === "review" && <>
        <p>Совпадение передано управляющему.</p>
        {info.permissions.manager && <>
          <label>Решение<select value={choice} onChange={(event) => setChoice(event.target.value)}>
            <option value="">Выберите решение</option><option value="separate">Открыть отдельный счёт</option>
            {info.candidates?.map((candidate) => <option key={candidate.id} value={candidate.id}>Привязать счёт · {candidate.displayName} · {candidate.id.slice(-6)}</option>)}
          </select></label>
          <label>Основание <input maxLength={500} value={reviewReason} onChange={(event) => setReviewReason(event.target.value)} /></label>
          <button type="button" className="eco-btn" disabled={!choice || !reviewReason.trim()} onClick={() => void mutate({
            action: "resolve", accountId: choice === "separate" ? undefined : choice, separate: choice === "separate", reason: reviewReason,
          }, "Совпадение разобрано")}>Сохранить решение</button>
        </>}
      </>}
      {info?.status === "excluded" && <p>Карточка исключена из программы управляющим.</p>}
      {info?.permissions.manager && !shipmentId && <details>
        <summary>{info.status === "excluded" ? "Восстановить участие карточки" : "Исключить карточку из программы"}</summary>
        <p>Для служебных карточек, автопарков и общих аккаунтов.</p>
        <label>Причина <input maxLength={500} value={eligibilityReason} onChange={(event) => setEligibilityReason(event.target.value)} /></label>
        <button type="button" className="eco-btn" disabled={!eligibilityReason.trim()} onClick={() => void mutate({
          action: "eligibility", excluded: info.status !== "excluded", reason: eligibilityReason,
        }, "Участие карточки изменено")}>Подтвердить</button>
      </details>}
      {canAdjust && (info.status === "linked" || info.status === "new") && <>
        {!adjust ? <button type="button" className="eco-btn" onClick={() => setAdjust(true)}>
          {info.permissions.owner ? "Скорректировать бонусы" : "Начислить компенсацию"}
        </button> : <form className="eco-loyalty-rates" onSubmit={submit}>
          {info.permissions.owner && <label>Действие <select value={remove ? "remove" : "grant"} onChange={(event) => setRemove(event.target.value === "remove")}>
            <option value="grant">Начислить</option><option value="remove">Списать</option>
          </select></label>}
          <label>Бонусы <input type="number" name="points" step="1" required min={1} max={info.permissions.owner ? 1_000_000 : info.compensationLimit} /></label>
          {!remove && <label>Действуют до <input type="date" name="expires" /></label>}
          <label>Причина <input name="reason" maxLength={500} required /></label>
          <div className="eco-loyalty-actions">
            <button className="eco-btn eco-btn--primary" type="submit">Подтвердить</button>
            <button className="eco-btn" type="button" onClick={() => setAdjust(false)}>Отмена</button>
          </div>
        </form>}
      </>}
    </fieldset>
  );
}
