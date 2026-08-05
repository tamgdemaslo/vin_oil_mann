import Link from "next/link";
import { redirect } from "next/navigation";
import { Bot, Building2, Cable, Landmark, MessageSquareText, PackageSearch, Settings, ShieldCheck, UsersRound, Warehouse } from "lucide-react";
import { requireAuthenticatedSession } from "@/lib/app-access";
import { getBranchContext } from "@/lib/branch-context";
import { resolveNavigationForUser } from "@/lib/navigation-policy.mjs";
import { canViewOrganizations } from "@/lib/organizations";

type ManagementCard = {
  href: string;
  label: string;
  description: string;
  icon: typeof Building2;
};

function Group({ title, description, cards }: { title: string; description: string; cards: ManagementCard[] }) {
  if (!cards.length) return null;
  return (
    <section className="eco-management-group">
      <header><h2>{title}</h2><span>{description}</span></header>
      <div className="eco-management-grid">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <Link href={card.href} key={`${card.href}-${card.label}`} className="eco-management-card">
              <span className="eco-management-card__icon"><Icon aria-hidden size={19} /></span>
              <span><strong>{card.label}</strong><small>{card.description}</small></span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

export default async function ManagementPage() {
  const session = await requireAuthenticatedSession("/management");
  const context = await getBranchContext({ allowAll: true, requireActive: false });
  const organizationsVisible = await canViewOrganizations(session.user);
  const permissions = new Set(context?.permissions ?? []);
  if (organizationsVisible) permissions.add("organizations.view");
  const navigation = resolveNavigationForUser({
    user: session.user,
    businessGroupMembership: context?.groupRole ? { role: context.groupRole } : null,
    branchMemberships: context?.branchId ? [{ branchId: context.branchId, roleId: context.branchRole, permissions: context.permissions }] : [],
    permissions: [...permissions],
    activeBranchMode: context?.mode ?? "branch",
    activeBranchId: context?.branchId ?? null,
  });
  const management = navigation.sections.find((section: { id: string }) => section.id === "management");
  if (!management) redirect("/");
  const allowed = new Set(management.items.map((entry: { href: string }) => entry.href.split("?")[0].split("#")[0]));
  const canManageBranches = allowed.has("/cabinet/branches");
  const canManageIntegrations = allowed.has("/cabinet/integrations");
  const canManageCommunications = allowed.has("/cabinet/notifications") || allowed.has("/cabinet/integrations/messenger");

  const structure: ManagementCard[] = [
    ...(canManageBranches ? [
      { href: "/cabinet/branches", label: "Филиалы", description: "Физические точки, адреса и рабочие настройки.", icon: Building2 },
      { href: context?.branchId ? `/cabinet/branches?branch=${context.branchId}&tab=employees` : "/cabinet/branches?tab=employees", label: "Сотрудники и роли", description: "Назначение людей и доступ к филиалам.", icon: UsersRound },
    ] : []),
    ...(allowed.has("/cabinet/organizations") ? [{ href: "/cabinet/organizations", label: "Организации", description: "ИП и ООО, реквизиты, налоги и документы.", icon: Landmark }] : []),
  ];

  const communications: ManagementCard[] = [
    ...(allowed.has("/cabinet/integrations/messenger") ? [{ href: "/cabinet/integrations/messenger", label: "Каналы связи", description: "Рабочий Telegram филиала и подключения каналов.", icon: MessageSquareText }] : []),
    ...(allowed.has("/cabinet/notifications") ? [
      { href: "/cabinet/notifications", label: "Уведомления клиентам", description: "Автоматические сценарии и журнал отправок.", icon: Cable },
      { href: "/cabinet/notifications?tab=templates", label: "Шаблоны сообщений", description: "Тексты клиентских уведомлений.", icon: MessageSquareText },
    ] : []),
  ];

  const integrations: ManagementCard[] = canManageIntegrations ? [
    { href: "/cabinet/integrations#finance", label: "Финансы · T-Bank", description: "Банковское подключение и платежи.", icon: Landmark },
    { href: "/cabinet/integrations#inventory", label: "Учёт и склад · МойСклад", description: "Статусы складских синхронизаций.", icon: Warehouse },
    { href: "/records", label: "Запись и клиенты · YCLIENTS", description: "Рабочий журнал клиентских записей.", icon: UsersRound },
    { href: "/inventory/integrations/mann-pdf", label: "Поставщики и каталоги · MANN", description: "Импорт каталога применимости фильтров.", icon: PackageSearch },
    { href: "/cabinet/ai-assistant", label: "ИИ и внешние API", description: "Настройки ИИ-помощника и правил расчёта.", icon: Bot },
  ] : [];

  const system: ManagementCard[] = navigation.effectiveRole === "group_owner" ? [
    { href: "/inventory/products/audit", label: "Аудит карточек товаров", description: "Техническая проверка заполненности данных.", icon: ShieldCheck },
    { href: "/cabinet/integrations#system", label: "Диагностика интеграций", description: "Служебные статусы и ручные проверки.", icon: Settings },
  ] : [];

  return (
    <main className="eco-page eco-page--wide eco-management-page">
      <section className="eco-page-head">
        <div>
          <div className="eco-page-crumbs"><Link href="/">Главное</Link><span className="sep">/</span><span className="cur">Управление</span></div>
          <h1 className="eco-page-title">Управление бизнесом</h1>
          <p className="eco-page-subtitle">Филиалы, организации, рабочие каналы и внешние подключения — отдельно от личного профиля.</p>
        </div>
      </section>
      <Group title="Структура бизнеса" description="Физические точки, юридические лица и доступ сотрудников." cards={structure} />
      {canManageCommunications && <Group title="Коммуникации" description="Каналы бизнеса и автоматические сообщения клиентам." cards={communications} />}
      <Group title="Интеграции" description="Подключения сгруппированы по бизнес-задаче." cards={integrations} />
      <Group title="Система" description="Служебные инструменты доступны только владельцу." cards={system} />
    </main>
  );
}
