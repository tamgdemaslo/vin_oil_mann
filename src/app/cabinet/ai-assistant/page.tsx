import Link from "next/link";
import { redirect } from "next/navigation";
import { Bot, ShieldCheck } from "lucide-react";
import { requireAuthenticatedSession } from "@/lib/app-access";
import { adminAssistantConfig } from "@/lib/ai-assistant/config";

export default async function AIAssistantSettingsPage() {
  const session = await requireAuthenticatedSession("/cabinet/ai-assistant");
  if (session.user.role !== "owner" && session.user.role !== "admin") redirect("/cabinet");
  const config = adminAssistantConfig();
  return (
    <main className="eco-page">
      <header className="eco-page-head">
        <div>
          <div className="eco-page-kicker">Кабинет / ИИ-помощник</div>
          <h1 className="eco-page-title">Настройки ИИ-помощника</h1>
          <p className="eco-page-subtitle">Внутренний режим для сотрудников. Клиентские диалоги и отправка сообщений отключены.</p>
        </div>
      </header>
      <section className="eco-card eco-aiw-settings">
        <div className="eco-aiw-settings__icon"><Bot size={21} /></div>
        <div><h2>Рабочее пространство</h2><p>Помощник использует Responses API, web search и read-only инструменты Эко-платформы. Создание документов, запись и заказы будут добавляться только отдельными подтверждаемыми действиями.</p></div>
        <dl><div><dt>Доступ</dt><dd>Владелец и администраторы</dd></div><div><dt>Модель</dt><dd>{config.model}</dd></div><div><dt>Уровень проверки</dt><dd>{config.reasoning} · {config.deepReasoning}</dd></div><div><dt>Режим данных</dt><dd>Только чтение</dd></div></dl>
        <div className="eco-aiw-settings__footer"><span><ShieldCheck size={16} /> Клиентский агент выключен feature flag’ом</span><div><Link href="/cabinet/ai-assistant/pricing" className="eco-btn eco-btn--quiet">Правила расчёта</Link><Link href="/ai-assistant" className="eco-btn eco-btn--primary">Открыть ИИ-помощник</Link></div></div>
      </section>
    </main>
  );
}
