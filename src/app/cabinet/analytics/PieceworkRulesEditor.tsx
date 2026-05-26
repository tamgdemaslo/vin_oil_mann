"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MoneyInput from "@/components/MoneyInput";

type PieceworkRuleItem = {
  targetType: "service" | "product_group";
  targetId: string;
  targetName: string;
  role: "master" | "admin";
  mode: "fixed" | "percent";
  fixedCents: number | null;
  percentBasisPoints: number | null;
  isDefault: boolean;
};

type DraftRule = {
  mode: "fixed" | "percent";
  value: string;
};

function getRuleKey(rule: Pick<PieceworkRuleItem, "targetType" | "targetId" | "role">) {
  return `${rule.targetType}:${rule.targetId}:${rule.role}`;
}

function formatFixedInput(amountCents: number | null) {
  if (amountCents == null) return "";
  return Number.isInteger(amountCents / 100)
    ? String(amountCents / 100)
    : (amountCents / 100).toFixed(2);
}

function formatPercentInput(percentBasisPoints: number | null) {
  if (percentBasisPoints == null) return "";
  const value = percentBasisPoints / 100;
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function makeDraft(rule: PieceworkRuleItem): DraftRule {
  return {
    mode: rule.mode,
    value: rule.mode === "fixed" ? formatFixedInput(rule.fixedCents) : formatPercentInput(rule.percentBasisPoints),
  };
}

function targetTypeLabel(targetType: PieceworkRuleItem["targetType"]) {
  return targetType === "service" ? "Услуга" : "Группа товара";
}

function roleLabel(role: PieceworkRuleItem["role"]) {
  return role === "master" ? "Мастер" : "Администратор";
}

function valueHint(rule: PieceworkRuleItem, mode: DraftRule["mode"]) {
  if (mode === "fixed") return "₽ за единицу";
  return rule.targetType === "product_group" ? "% от чистой прибыли" : "% от продажи";
}

export default function PieceworkRulesEditor({ onSaved }: { onSaved?: () => void }) {
  const [rules, setRules] = useState<PieceworkRuleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, DraftRule>>({});
  const autoLoadedRef = useRef(false);

  const loadRules = useCallback(() => {
    setLoading(true);
    setErrorMessage(null);
    fetch("/api/piecework-rules")
      .then(async (r) => {
        if (!r.ok) {
          let errorText = "Не удалось загрузить правила";
          try {
            const payload = await r.json();
            if (typeof payload?.error === "string" && payload.error.trim()) {
              errorText = payload.error;
            }
          } catch {}
          throw new Error(errorText);
        }
        return r.json();
      })
      .then((payload) => {
        const nextRules = Array.isArray(payload?.rules) ? (payload.rules as PieceworkRuleItem[]) : [];
        setRules(nextRules);
        setDrafts(Object.fromEntries(nextRules.map((rule) => [getRuleKey(rule), makeDraft(rule)])));
      })
      .catch((error: unknown) => {
        setRules([]);
        setErrorMessage(error instanceof Error ? error.message : "Не удалось загрузить правила");
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (autoLoadedRef.current) return;
    autoLoadedRef.current = true;
    loadRules();
  }, [loadRules]);

  const sections = useMemo(
    () => [
      {
        id: "service" as const,
        title: "Услуги",
        rows: rules.filter((rule) => rule.targetType === "service"),
      },
      {
        id: "product_group" as const,
        title: "Группы товаров",
        rows: rules.filter((rule) => rule.targetType === "product_group"),
      },
    ],
    [rules]
  );

  async function saveRule(rule: PieceworkRuleItem) {
    const key = getRuleKey(rule);
    const draft = drafts[key] ?? makeDraft(rule);
    const numericValue = parseFloat(draft.value.replace(",", "."));
    if (Number.isNaN(numericValue) || numericValue < 0) return;

    setSavingKey(key);
    setMessage(null);
    setErrorMessage(null);
    try {
      const response = await fetch("/api/piecework-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetType: rule.targetType,
          targetId: rule.targetId,
          targetName: rule.targetName,
          role: rule.role,
          mode: draft.mode,
          fixedCents: draft.mode === "fixed" ? Math.round(numericValue * 100) : null,
          percentBasisPoints: draft.mode === "percent" ? Math.round(numericValue * 100) : null,
        }),
      });
      if (!response.ok) {
        let errorText = "Не удалось сохранить правило";
        try {
          const payload = await response.json();
          if (typeof payload?.error === "string" && payload.error.trim()) {
            errorText = payload.error;
          }
        } catch {}
        throw new Error(errorText);
      }

      setRules((prev) =>
        prev.map((item) =>
          getRuleKey(item) === key
            ? {
                ...item,
                mode: draft.mode,
                fixedCents: draft.mode === "fixed" ? Math.round(numericValue * 100) : null,
                percentBasisPoints: draft.mode === "percent" ? Math.round(numericValue * 100) : null,
                isDefault: false,
              }
            : item
        )
      );
      setMessage(`Правило "${rule.targetName}" для роли "${roleLabel(rule.role)}" сохранено`);
      onSaved?.();
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : "Не удалось сохранить правило");
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-800">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="font-semibold text-zinc-900 dark:text-zinc-50">Правила сдельной части</h3>
          <p className="text-sm text-zinc-500">
            Для мастера начисления считаются только по услугам, для администратора - только по
            группам товаров. Для каждой строки можно выбрать фикс или процент от суммы продажи.
          </p>
          {!loading && !errorMessage && (
            <p className="mt-1 text-xs text-zinc-500">Загружено правил: {rules.length}</p>
          )}
        </div>
        {message && <p className="text-sm text-emerald-600">{message}</p>}
      </div>

      {errorMessage && (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
          {errorMessage}
        </p>
      )}

      {loading ? (
        <p className="mt-4 text-sm text-zinc-500">Загрузка правил…</p>
      ) : rules.length === 0 ? (
        <p className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-300">
          Правила пока не отображаются. Обновите страницу, и если список все равно пустой, значит
          запрос не дошел до клиента.
        </p>
      ) : (
        <div className="mt-4 space-y-6">
          {sections.map((section) =>
            section.rows.length > 0 ? (
              <div key={section.id}>
                <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{section.title}</h4>
                <div className="mt-3 overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-700">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead className="bg-zinc-50 dark:bg-zinc-900/60">
                      <tr className="border-b border-zinc-200 text-left dark:border-zinc-700">
                        <th className="px-4 py-3 font-medium text-zinc-500">Тип</th>
                        <th className="px-4 py-3 font-medium text-zinc-500">Название</th>
                        <th className="px-4 py-3 font-medium text-zinc-500">Роль</th>
                        <th className="px-4 py-3 font-medium text-zinc-500">Режим</th>
                        <th className="px-4 py-3 font-medium text-zinc-500">Значение</th>
                        <th className="px-4 py-3 font-medium text-zinc-500">Статус</th>
                        <th className="px-4 py-3 font-medium text-zinc-500" />
                      </tr>
                    </thead>
                    <tbody>
                      {section.rows.map((rule) => {
                        const key = getRuleKey(rule);
                        const draft = drafts[key] ?? makeDraft(rule);
                        const isSaving = savingKey === key;
                        return (
                          <tr key={key} className="border-b border-zinc-100 dark:border-zinc-700">
                            <td className="px-4 py-3">{targetTypeLabel(rule.targetType)}</td>
                            <td className="px-4 py-3">
                              <div className="font-medium text-zinc-900 dark:text-zinc-100">
                                {rule.targetName}
                              </div>
                              <div className="text-xs text-zinc-500">{rule.targetId}</div>
                            </td>
                            <td className="px-4 py-3">{roleLabel(rule.role)}</td>
                            <td className="px-4 py-3">
                              <select
                                value={draft.mode}
                                onChange={(e) =>
                                  setDrafts((prev) => ({
                                    ...prev,
                                    [key]: {
                                      ...draft,
                                      mode: e.target.value as DraftRule["mode"],
                                      value:
                                        e.target.value === "fixed"
                                          ? formatFixedInput(rule.fixedCents)
                                          : formatPercentInput(rule.percentBasisPoints),
                                    },
                                  }))
                                }
                                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-900"
                              >
                                <option value="fixed">Фикс</option>
                                <option value="percent">Процент</option>
                              </select>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                {draft.mode === "fixed" ? (
                                  <MoneyInput
                                    value={draft.value}
                                    onValueChange={(value, valueDraft) =>
                                      setDrafts((prev) => ({
                                        ...prev,
                                        [key]: { ...draft, value: valueDraft ? String(value) : "" },
                                      }))
                                    }
                                    className="w-32 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-900"
                                  />
                                ) : (
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    value={draft.value}
                                    onChange={(e) =>
                                      setDrafts((prev) => ({
                                        ...prev,
                                        [key]: { ...draft, value: e.target.value },
                                      }))
                                    }
                                    className="w-32 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-900"
                                  />
                                )}
                                <span className="text-xs text-zinc-500">
                                  {valueHint(rule, draft.mode)}
                                </span>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-xs text-zinc-500">
                              {rule.isDefault ? "Дефолт" : "Изменено"}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <button
                                type="button"
                                onClick={() => saveRule(rule)}
                                disabled={isSaving}
                                className="rounded-lg bg-amber-500 px-3 py-1.5 text-sm text-white hover:bg-amber-600 disabled:opacity-50"
                              >
                                {isSaving ? "…" : "Сохранить"}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null
          )}
        </div>
      )}
    </div>
  );
}
