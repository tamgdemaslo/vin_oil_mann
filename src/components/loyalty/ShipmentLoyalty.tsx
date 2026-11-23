"use client";

import { useEffect, useId, useState } from "react";
import type { CreateDemandBody } from "@/lib/demand-create-payload";
import type { LoyaltyIntent, LoyaltyQuote } from "@/lib/loyalty/calculation";
import { loyaltyMoney, loyaltyNumber, loyaltyRequest } from "./client";

type QuoteResponse = { status: string; quote?: LoyaltyQuote };
export function useShipmentLoyalty(counterpartyId: string | undefined, branchId: string | undefined, positions: CreateDemandBody["positions"]) {
  const client = counterpartyId ?? "";
  const initial = { client, branchId, points: 0, skip: false, suppressEarn: false };
  const [selection, setSelection] = useState(initial);
  const [attempt, setAttempt] = useState(0);
  const [response, setResponse] = useState<{ key: string; contextKey?: string; value?: QuoteResponse; error?: string }>({ key: "" });
  const changed = selection.client !== client || selection.branchId !== branchId;
  const chosen = changed ? initial : selection;
  if (changed) setSelection(initial);
  const contextKey = JSON.stringify({ branchId, counterpartyId: client, positions });
  const key = client ? JSON.stringify({ branchId, counterpartyId: client, positions, points: chosen.points }) : "";
  const resultKey = key + "#" + attempt;
  useEffect(() => {
    if (!key || chosen.skip) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      loyaltyRequest<QuoteResponse>("/api/loyalty/quote", JSON.parse(key), { signal: controller.signal })
        .then((value) => { if (!controller.signal.aborted) setResponse({ key: resultKey, contextKey, value }); })
        .catch((error: Error) => { if (!controller.signal.aborted) setResponse({ key: resultKey, contextKey, error: error.message }); });
    }, 220);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [contextKey, key, chosen.skip, resultKey]);
  const current = response.key === resultKey ? response : null;
  const quote = chosen.skip ? undefined : current?.value?.quote;
  const status = chosen.skip ? "skip" : current?.value?.status;
  const stale = chosen.points > 0 && (!quote || quote.spent !== chosen.points);
  const retry = () => { setSelection({ ...chosen, skip: false }); setAttempt((value) => value + 1); };
  const setPoints = (points: number) => setSelection({ ...chosen, points, skip: false });
  const intent: LoyaltyIntent = { points: chosen.points, token: quote?.token, skip: chosen.skip, suppressEarn: chosen.suppressEarn };
  const previousQuote = !current && response.contextKey === contextKey && !chosen.skip
    ? response.value?.quote : undefined;
  return { client, status, quote, previousQuote, error: current?.error, loading: Boolean(key && !current && !chosen.skip),
    stale, intent, setPoints, retry, setSuppressEarn: (suppressEarn: boolean) => setSelection({ ...chosen, suppressEarn }),
    skip: () => setSelection({ ...chosen, points: 0, skip: true }) };
}

const issueLabels: Record<string, string> = {
  review: "Совпадение телефона передано управляющему.",
  incomplete: "Для бонусного счёта заполните телефон и ФИО клиента.",
};
export function ShipmentLoyalty({ state, branchId, disabled }: {
  state: ReturnType<typeof useShipmentLoyalty>; branchId?: string; disabled?: boolean;
}) {
  const inputId = useId();
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);
  if (!state.client || (["disabled", "ineligible", "excluded"].includes(state.status ?? "") && !state.intent.points)) return null;
  const quote = state.quote ?? state.previousQuote;
  async function confirm() {
    setBusy(true);
    setFailure("");
    try {
      const branch = branchId ?? (await loyaltyRequest<{ branchId: string }>(`/api/loyalty/clients/${encodeURIComponent(state.client)}`)).branchId;
      await loyaltyRequest(`/api/loyalty/clients/${encodeURIComponent(state.client)}`, { action: "confirm", branchId: branch });
      state.retry();
    } catch (error) {
      setFailure((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <fieldset className="eco-loyalty-panel" disabled={disabled || busy}>
      <legend>Программа лояльности</legend>
      {state.loading && <p role="status">Проверяем бонусный счёт…</p>}
      {state.status === "skip" && <p>Эта отгрузка пройдёт без бонусов. <button type="button" className="eco-btn" onClick={state.retry}>Проверить счёт</button></p>}
      {state.error && state.status !== "skip" && <p role="alert">{state.error}</p>}
      {failure && <p role="alert">{failure}</p>}
      {quote && <>
        <p>Баланс <strong>{loyaltyNumber(quote.balance)} бонусов</strong>{" "}
          <small>(к списанию {loyaltyMoney(quote.maximum * quote.centsPerPoint)})</small>
        </p>
        {state.status === "new" && <p>Счёт откроется при проведении первой отгрузки.</p>}
        <label htmlFor={inputId}><strong>Списать бонусов</strong></label>
        <div className="eco-loyalty-actions">
          <input id={inputId} className="eco-input" type="number" inputMode="numeric" min={0} max={quote.maximum} step={1}
            disabled={quote.maximum === 0} value={state.intent.points}
            onChange={(event) => state.setPoints(Math.min(quote.maximum, Math.max(0, Math.floor(Number(event.target.value) || 0))))} />
          {quote.maximum > 0 && <button className="eco-btn" type="button" onClick={() => state.setPoints(quote.maximum)}>Списать максимум</button>}
        </div>
        <div className="eco-loyalty-earn">
          <p>Начислится при проведении <strong>{loyaltyNumber(state.intent.suppressEarn ? 0 : quote.earned)} бонусов</strong></p>
          <label className="eco-loyalty-earn-option">
            <input type="checkbox" checked={Boolean(state.intent.suppressEarn)}
              onChange={(event) => state.setSuppressEarn(event.target.checked)} />
            Не начислять бонусы
          </label>
        </div>
        {state.stale && state.quote && <button type="button" className="eco-btn" onClick={() => state.setPoints(quote.spent)}>Подтвердить {loyaltyNumber(quote.spent)} к списанию</button>}
      </>}
      {state.status === "confirm" && <>
        <p>Найден счёт с таким телефоном и ФИО. Уточните у клиента, что это его счёт.</p>
        <button type="button" className="eco-btn" onClick={() => void confirm()}>Подтвердить со слов клиента</button>
      </>}
      {state.status && issueLabels[state.status] && <p>{issueLabels[state.status]}</p>}
      {(state.intent.points > 0 || state.error) && state.status !== "skip" &&
        <button className="eco-btn" type="button" onClick={() => state.error ? state.skip() : state.setPoints(0)}>
          {state.error ? "Продать без бонусов" : "Убрать списание"}
        </button>}
      {state.error && state.status !== "skip" && <button type="button" className="eco-btn" onClick={state.retry}>Повторить расчёт</button>}
      {state.stale && <p role="status">Выбранное списание ждёт подтверждения расчёта.</p>}
    </fieldset>
  );
}
