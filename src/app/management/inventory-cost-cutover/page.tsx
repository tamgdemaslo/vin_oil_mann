"use client";

import { useEffect, useState } from "react";
import {
  INVENTORY_COST_CUTOVER_BACKUP,
  INVENTORY_COST_CUTOVER_CONFIRMATION,
  type InventoryCostCutoverPlan,
} from "@/lib/inventory-cost-cutover-contract";

type ApplyResult = {
  ok?: boolean;
  error?: string;
  appliedCount?: number;
  unresolvedCount?: number;
};

export default function InventoryCostCutoverPage() {
  const [plan, setPlan] = useState<InventoryCostCutoverPlan | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ApplyResult | null>(null);

  async function loadPlan() {
    const response = await fetch("/api/system/inventory-cost-cutover", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Не удалось построить dry-run");
    setPlan(payload);
  }

  useEffect(() => {
    loadPlan().catch((error) => setResult({ error: error instanceof Error ? error.message : String(error) }));
  }, []);

  async function apply() {
    if (!plan) return;
    setBusy(true);
    setResult(null);
    try {
      const response = await fetch("/api/system/inventory-cost-cutover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedPlanHash: plan.planHash,
          confirmation,
          backupReference: INVENTORY_COST_CUTOVER_BACKUP,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Cutover не выполнен");
      setResult(payload);
      await loadPlan();
    } catch (error) {
      setResult({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 1180, margin: "0 auto", padding: 32, fontFamily: "system-ui, sans-serif" }}>
      <h1>Cutover складской себестоимости</h1>
      <p>Исторические строки продаж не изменяются. Применяются только однозначно восстановленные текущие средние цены.</p>
      {!plan ? <p>Строится dry-run…</p> : (
        <>
          <p data-testid="plan-summary">
            Кандидатов: {plan.summary.total}; восстанавливаемых: {plan.summary.reconstructable}; требуют opening cost: {plan.summary.openingCostRequired}; неоднозначных: {plan.summary.ambiguousHistory}; без данных: {plan.summary.missingCost}.
          </p>
          <p><small>Plan hash: {plan.planHash}</small></p>
          <label style={{ display: "grid", gap: 8, maxWidth: 620 }}>
            Фраза подтверждения
            <input
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              placeholder={INVENTORY_COST_CUTOVER_CONFIRMATION}
              style={{ padding: 12 }}
            />
          </label>
          <button
            type="button"
            onClick={apply}
            disabled={busy || plan.summary.reconstructable === 0 || confirmation !== INVENTORY_COST_CUTOVER_CONFIRMATION}
            style={{ marginTop: 16, padding: "12px 18px" }}
          >
            {busy ? "Выполняется…" : `Применить ${plan.summary.reconstructable} восстановленных цен`}
          </button>
          <h2>Нерешённые позиции</h2>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr><th>Филиал</th><th>Склад</th><th>Товар</th><th>Остаток</th><th>Последняя закупка</th><th>Причина</th></tr></thead>
              <tbody>
                {plan.candidates.filter((row) => row.status !== "RECONSTRUCTABLE").map((row) => (
                  <tr key={row.balanceId}>
                    <td>{row.branchName}</td><td>{row.storeName}</td><td>{row.productName}</td><td>{row.currentQuantity}</td>
                    <td>{row.lastPurchasePriceCents == null ? "—" : `${(row.lastPurchasePriceCents / 100).toFixed(2)} ₽`}</td>
                    <td>{row.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {result?.error ? <p role="alert" style={{ color: "#a40000" }}>{result.error}</p> : null}
      {result?.ok ? <p role="status">Применено: {result.appliedCount}. Осталось нерешённых: {result.unresolvedCount}.</p> : null}
    </main>
  );
}
