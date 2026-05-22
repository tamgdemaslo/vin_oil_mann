"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  isRecognizedMotorOilMarkingCode,
  isLikelyMarkedMotorOilProductName,
  isMeasuredMotorOilQuantity,
  normalizeMarkingCodeInput,
  parseMarkingCodesInput,
  requiredMarkingCodeCount,
} from "@/lib/marking";

type Header = {
  id: string;
  name: string;
  moment: string;
  sum: number;
  agentName: string;
};

type Position = {
  id: string;
  name: string;
  quantity: number;
  price: number;
  discount?: number;
};

type DetailResponse = {
  header: Header;
  positions: Position[];
};

function rubles(valueKopecks: number): string {
  return ((Number(valueKopecks) || 0) / 100).toLocaleString("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function positionTotal(position: Position): number {
  const discount = typeof position.discount === "number" ? position.discount : 0;
  return (Number(position.price) || 0) * (Number(position.quantity) || 0) * (1 - discount / 100);
}

export default function ShipmentPrecheckPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [data, setData] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [markingInputs, setMarkingInputs] = useState<Record<string, string>>({});
  const [bypassed, setBypassed] = useState<Record<string, boolean>>({});
  const [bypassPassword, setBypassPassword] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const sess = await fetch("/api/auth/session").then((r) => r.json());
        if (!sess?.user) {
          router.push(`/login?from=/shipment/${id}/precheck`);
          return;
        }
        const res = await fetch(`/api/demands/${id}`, { cache: "no-store" });
        const json = await res.json();
        if (!res.ok) {
          setError(json.error ?? "Ошибка загрузки предчека");
          return;
        }
        if (!cancelled) setData(json);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Ошибка сети");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (id) void load();
    return () => {
      cancelled = true;
    };
  }, [id, router]);

  const requiredPositions = useMemo(
    () => (data?.positions ?? []).filter((position) => isLikelyMarkedMotorOilProductName(position.name)),
    [data?.positions]
  );

  const missingPositions = useMemo(
    () =>
      requiredPositions.filter((position) => {
        const measuredPour = isMeasuredMotorOilQuantity(position.name, position.quantity);
        const codes = parseMarkingCodesInput(markingInputs[position.id] ?? "");
        const needed = requiredMarkingCodeCount(position.quantity, { measuredPour });
        const hasEnoughCodes = codes.length >= needed;
        const codesRecognized = codes.slice(0, needed).every(isRecognizedMotorOilMarkingCode);
        return !bypassed[position.id] && (!hasEnoughCodes || !codesRecognized);
      }),
    [bypassed, markingInputs, requiredPositions]
  );

  async function handleBypass(position: Position) {
    const password = window.prompt(`Пароль для пропуска маркировки: ${position.name}`);
    if (!password) return;
    setBypassPassword(password);
    setBypassed((prev) => ({ ...prev, [position.id]: true }));
    setError(null);
  }

  async function handleSend() {
    if (!data || sending || missingPositions.length > 0) return;
    setSending(true);
    setError(null);
    setSuccess(null);
    try {
      const markingCodes = Object.fromEntries(
        Object.entries(markingInputs).map(([positionId, value]) => [
          positionId,
          parseMarkingCodesInput(value),
        ])
      );
      const markingBypassPositionIds = Object.entries(bypassed)
        .filter(([, value]) => value)
        .map(([positionId]) => positionId);

      const res = await fetch(`/api/demands/${id}/payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          markingCodes,
          markingBypassPositionIds,
          markingBypassPassword:
            markingBypassPositionIds.length > 0 ? bypassPassword : undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof json.error === "string" ? json.error : "Не удалось отправить заказ в AQSI");
        return;
      }
      setSuccess(
        json.status
          ? `Заказ отправлен в AQSI. Статус: ${json.status}.`
          : "Заказ отправлен в AQSI и доступен в отложенных заказах."
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка отправки в AQSI");
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-10">
        <p className="text-sm text-zinc-500">Загрузка предчека...</p>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-10">
        <p className="text-sm text-red-600 dark:text-red-400">{error ?? "Предчек не найден"}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href={`/shipment/${id}`}
            className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
          >
            ← К отгрузке
          </Link>
          <h1 className="mt-3 text-2xl font-bold text-zinc-950 dark:text-zinc-50">
            Предчек {data.header.name}
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            {data.header.agentName || "Контрагент не указан"} · {data.header.moment}
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs text-zinc-500">Сумма</div>
          <div className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">
            {rubles(data.header.sum)} ₽
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
        <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-700">
          <thead className="bg-zinc-50 text-left text-xs font-medium uppercase text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
            <tr>
              <th className="px-4 py-3">Позиция</th>
              <th className="px-4 py-3 text-right">Кол-во</th>
              <th className="px-4 py-3 text-right">Цена</th>
              <th className="px-4 py-3 text-right">Итого</th>
              <th className="px-4 py-3">Маркировка</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {data.positions.map((position) => {
              const needsMarking = isLikelyMarkedMotorOilProductName(position.name);
              const measuredPour = isMeasuredMotorOilQuantity(position.name, position.quantity);
              const needed = requiredMarkingCodeCount(position.quantity, { measuredPour });
              const codes = parseMarkingCodesInput(markingInputs[position.id] ?? "");
              const codesRecognized = codes.slice(0, needed).every(isRecognizedMotorOilMarkingCode);
              const isMissing =
                needsMarking && !bypassed[position.id] && (codes.length < needed || !codesRecognized);
              return (
                <tr key={position.id} className={isMissing ? "bg-amber-50/70 dark:bg-amber-950/20" : ""}>
                  <td className="max-w-xs px-4 py-3 align-top">
                    <div className="font-medium text-zinc-950 dark:text-zinc-50">{position.name}</div>
                    {needsMarking && (
                      <div className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                        {measuredPour
                          ? `Литры/розлив · один код на ${position.quantity} л`
                          : `Автомасло · нужно кодов: ${needed}`}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right align-top">
                    {position.quantity}
                    {measuredPour ? " л" : ""}
                  </td>
                  <td className="px-4 py-3 text-right align-top">{rubles(position.price)} ₽</td>
                  <td className="px-4 py-3 text-right align-top">{rubles(positionTotal(position))} ₽</td>
                  <td className="min-w-72 px-4 py-3 align-top">
                    {needsMarking ? (
                      <div className="space-y-2">
                        <textarea
                          value={markingInputs[position.id] ?? ""}
                          onChange={(e) => {
                            const value = e.target.value;
                            setMarkingInputs((prev) => ({ ...prev, [position.id]: value }));
                            if (parseMarkingCodesInput(value).length >= needed) {
                              setBypassed((prev) => ({ ...prev, [position.id]: false }));
                            }
                          }}
                          rows={needed > 1 ? Math.min(needed, 4) : 2}
                          placeholder={measuredPour ? "Код маркировки" : "Код маркировки"}
                          wrap="off"
                          spellCheck={false}
                          autoCapitalize="off"
                          autoCorrect="off"
                          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-xs outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 dark:border-zinc-600 dark:bg-zinc-950"
                        />
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`text-xs ${
                              isMissing
                                ? "text-amber-700 dark:text-amber-300"
                                : "text-emerald-700 dark:text-emerald-300"
                            }`}
                          >
                            {bypassed[position.id]
                              ? "Пропуск разрешён"
                              : `${Math.min(codes.length, needed)} из ${needed}`}
                          </span>
                          {codes.length > 0 && !codes.every(isRecognizedMotorOilMarkingCode) && (
                            <span className="text-xs text-red-600 dark:text-red-400">
                              Формат кода не распознан
                            </span>
                          )}
                          {codes.some((code) => code !== normalizeMarkingCodeInput(markingInputs[position.id] ?? "")) && (
                            <span className="text-xs text-zinc-400">
                              GS-разделители будут восстановлены
                            </span>
                          )}
                          {bypassed[position.id] ? (
                            <button
                              type="button"
                              onClick={() => setBypassed((prev) => ({ ...prev, [position.id]: false }))}
                              className="rounded-lg border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
                            >
                              Отменить пропуск
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void handleBypass(position)}
                              className="rounded-lg border border-amber-300 px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:text-amber-200 dark:hover:bg-amber-950/50"
                            >
                              Пропустить без маркировки
                            </button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <span className="text-xs text-zinc-400">Не требуется</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {success && <p className="mt-4 text-sm text-emerald-600 dark:text-emerald-400">{success}</p>}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void handleSend()}
          disabled={sending || missingPositions.length > 0}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {sending ? "Отправка в AQSI..." : "Отправить заказ на кассу"}
        </button>
        {missingPositions.length > 0 && (
          <span className="text-sm text-amber-700 dark:text-amber-300">
            Заполните маркировку или оформите пропуск.
          </span>
        )}
      </div>
    </main>
  );
}
