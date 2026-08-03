"use client";

import Link from "next/link";
import { Bot, Check, CircleAlert, Clock3, RefreshCw, Settings, UserRoundCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { EcoBadge, EcoButton, EcoCard, EcoKpi, EcoSelect } from "@/components/platform/EcoUI";

type Analytics = {
  period: { days: number; since: string };
  metrics: {
    conversations: number;
    runs: number;
    completedRuns: number;
    failedRuns: number;
    handledWithoutHumanRate: number;
    handoffRate: number;
    quotes: number;
    appointments: number;
    dialogToQuoteRate: number;
    quoteToAppointmentRate: number;
    averageResponseMs: number;
    inputTokens: number;
    outputTokens: number;
    estimatedCostMicros: number;
    handoffs: number;
    rosskoCalls: number;
    failedSelectionCalls: number;
  };
  handoffReasons: Array<{ reasonCode: string; count: number }>;
  recentErrors: Array<{ id: string; conversationId: string; intent: string | null; errorMessage: string | null; createdAt: string }>;
};

const reasonLabels: Record<string, string> = {
  vehicle_ambiguous: "Неоднозначный автомобиль",
  technical_conflict: "Противоречивые технические данные",
  low_confidence: "Низкая уверенность",
  complaint: "Жалоба клиента",
  customer_request: "Клиент попросил сотрудника",
  high_amount: "Высокая сумма",
  nonstandard: "Нестандартный запрос",
  rossko_ambiguous: "Неоднозначные предложения ROSSKO",
  employee_takeover: "Сотрудник перехватил диалог",
  agent_stopped: "Агент остановлен сотрудником",
  other: "Другая причина",
};

function duration(ms: number) {
  if (!ms) return "—";
  if (ms < 60_000) return `${Math.round(ms / 1000)} сек`;
  return `${Math.round(ms / 60_000)} мин`;
}

function compactNumber(value: number) {
  return new Intl.NumberFormat("ru-RU", { notation: value >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
}

export default function AIAgentAnalyticsClient() {
  const [days, setDays] = useState("30");
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/ai-agent/analytics?days=${days}`, { cache: "no-store" });
      const payload = await response.json().catch(() => null) as (Analytics & { error?: string }) | null;
      if (!response.ok || !payload?.metrics) throw new Error(payload?.error || "Аналитика не загрузилась");
      setData(payload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Аналитика не загрузилась");
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { void load(); }, [load]);

  const metrics = data?.metrics;
  return (
    <main className="eco-page eco-agent-analytics">
      <section className="eco-page-head">
        <div>
          <div className="eco-page-crumbs"><Link href="/">Главная</Link><span className="sep">/</span><Link href="/crm">CRM</Link><span className="sep">/</span><span className="cur">ИИ-помощник</span></div>
          <div className="eco-title-row"><h1 className="eco-page-title">Результаты ИИ-помощника</h1><EcoBadge tone="rust" dot>реальные действия</EcoBadge></div>
          <p className="eco-page-subtitle">Диалоги, расчёты и записи — с отдельным контролем передач сотруднику и ошибок подбора.</p>
        </div>
        <div className="eco-page-actions">
          <EcoSelect value={days} onChange={(event) => setDays(event.target.value)} aria-label="Период"><option value="7">7 дней</option><option value="30">30 дней</option><option value="90">90 дней</option><option value="365">Год</option></EcoSelect>
          <EcoButton variant="secondary" onClick={() => void load()} disabled={loading}><RefreshCw size={15} className={loading ? "is-spin" : ""} />Обновить</EcoButton>
          <Link href="/cabinet/ai-agent" className="eco-btn eco-btn--ghost"><Settings size={15} />Настройки</Link>
        </div>
      </section>

      {error && <div className="eco-agent-settings__notice is-danger"><CircleAlert size={15} />{error}</div>}

      <div className="eco-grid eco-grid--kpi">
        <EcoKpi label="Диалоги" value={metrics ? compactNumber(metrics.conversations) : "—"} tone="neutral" sub={`${metrics?.runs ?? 0} запусков помощника`} />
        <EcoKpi label="Без сотрудника" value={metrics ? `${metrics.handledWithoutHumanRate}%` : "—"} tone="success" sub={`Передано человеку: ${metrics?.handoffRate ?? 0}%`} />
        <EcoKpi label="Расчёты" value={metrics ? compactNumber(metrics.quotes) : "—"} tone="rust" sub={`Диалог → расчёт: ${metrics?.dialogToQuoteRate ?? 0}%`} />
        <EcoKpi label="Записи" value={metrics ? compactNumber(metrics.appointments) : "—"} tone="success" sub={`Расчёт → запись: ${metrics?.quoteToAppointmentRate ?? 0}%`} />
        <EcoKpi label="Средний ответ" value={metrics ? duration(metrics.averageResponseMs) : "—"} tone="neutral" sub="От сообщения до готового результата" />
        <EcoKpi label="Ошибки подбора" value={metrics ? compactNumber(metrics.failedSelectionCalls) : "—"} tone={metrics?.failedSelectionCalls ? "warning" : "success"} sub={`Всего ошибок запусков: ${metrics?.failedRuns ?? 0}`} />
      </div>

      <div className="eco-agent-analytics__grid">
        <EcoCard padded={false}>
          <div className="eco-card__head"><div><div className="eco-page-kicker">Передача человеку</div><h2 className="eco-stock-doc-title">Основные причины</h2></div><EcoBadge tone={data?.handoffReasons.length ? "warning" : "success"}>{metrics?.handoffs ?? 0}</EcoBadge></div>
          <div className="eco-agent-analytics__reasons">
            {data?.handoffReasons.length ? data.handoffReasons.map((item) => {
              const width = Math.max(4, Math.round((item.count / Math.max(...data.handoffReasons.map((reason) => reason.count))) * 100));
              return <div key={item.reasonCode}><span><strong>{reasonLabels[item.reasonCode] ?? item.reasonCode}</strong><b>{item.count}</b></span><i><em style={{ width: `${width}%` }} /></i></div>;
            }) : <div className="eco-agent-analytics__empty"><UserRoundCheck size={18} /><span><strong>Передач пока нет</strong><small>На выбранном периоде помощник не создавал очередь сотруднику.</small></span></div>}
          </div>
        </EcoCard>

        <EcoCard padded={false}>
          <div className="eco-card__head"><div><div className="eco-page-kicker">Надёжность</div><h2 className="eco-stock-doc-title">Последние ошибки</h2></div><EcoBadge tone={data?.recentErrors.length ? "danger" : "success"}>{data?.recentErrors.length ?? 0}</EcoBadge></div>
          <div className="eco-agent-analytics__errors">
            {data?.recentErrors.length ? data.recentErrors.map((item) => <Link key={item.id} href={`/messages?conversationId=${encodeURIComponent(item.conversationId)}`}><CircleAlert size={14} /><span><strong>{item.errorMessage || "Запуск завершился с ошибкой"}</strong><small>{item.intent || "запрос не определён"} · {new Date(item.createdAt).toLocaleString("ru-RU")}</small></span></Link>) : <div className="eco-agent-analytics__empty"><Check size={18} /><span><strong>Ошибок нет</strong><small>На выбранном периоде все запуски завершились штатно.</small></span></div>}
          </div>
        </EcoCard>
      </div>

      <EcoCard className="eco-agent-analytics__usage">
        <div><Bot size={17} /><span><strong>Использование модели</strong><small>{compactNumber((metrics?.inputTokens ?? 0) + (metrics?.outputTokens ?? 0))} токенов за период</small></span></div>
        <div><Clock3 size={17} /><span><strong>ROSSKO</strong><small>{metrics?.rosskoCalls ?? 0} поисков наличия; заказы агент не оформляет</small></span></div>
      </EcoCard>
    </main>
  );
}
