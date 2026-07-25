import Link from "next/link";
import { ArrowLeft, Calculator } from "lucide-react";
import { redirect } from "next/navigation";
import { requireAuthenticatedSession } from "@/lib/app-access";
import PricingRulesClient from "./PricingRulesClient";

export default async function AIAssistantPricingRulesPage() {
  const session = await requireAuthenticatedSession("/cabinet/ai-assistant/pricing");
  if (session.user.role !== "owner" && session.user.role !== "admin") redirect("/cabinet");
  return <main className="eco-page eco-page--wide">
    <header className="eco-page-head">
      <div>
        <div className="eco-page-kicker">Кабинет / ИИ-помощник / Правила расчёта</div>
        <h1 className="eco-page-title">Правила расчёта</h1>
        <p className="eco-page-subtitle">Детерминированные тарифы работы для ИИ-помощника. Материалы и карточки услуг рассчитываются отдельно.</p>
      </div>
      <div className="eco-page-actions"><Link href="/cabinet/ai-assistant" className="eco-btn eco-btn--quiet"><ArrowLeft size={16} /> Настройки</Link><Link href="/ai-assistant" className="eco-btn eco-btn--primary"><Calculator size={16} /> Открыть помощник</Link></div>
    </header>
    <PricingRulesClient />
  </main>;
}
