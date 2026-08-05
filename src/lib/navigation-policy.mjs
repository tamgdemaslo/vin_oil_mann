const GROUP_MANAGERS = new Set(["group_owner", "group_admin"]);
const BRANCH_MANAGERS = new Set(["branch_owner", "administrator"]);
const CUSTOMER_MANAGERS = new Set(["group_owner", "group_admin", "branch_owner", "administrator"]);
const WORK_ROLES = new Set(["group_owner", "group_admin", "branch_owner", "administrator", "master", "mechanic"]);
const FINANCE_ROLES = new Set(["group_owner", "group_admin", "group_analyst", "branch_owner", "administrator", "accountant"]);
const WAREHOUSE_ROLES = new Set(["group_owner", "group_admin", "group_analyst", "branch_owner", "administrator", "master", "mechanic", "accountant"]);

function permissionsFrom(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "object") {
    return Object.entries(value).filter(([, enabled]) => Boolean(enabled)).map(([permission]) => permission);
  }
  return [];
}

function legacyRole(user) {
  if (user?.role === "owner") return "group_owner";
  if (user?.role === "admin") return "administrator";
  return "master";
}

function item(href, label, description, options = {}) {
  return { href, label, description, ...options };
}

/**
 * Resolve the complete navigation contract from verified memberships and capabilities.
 * The UI consumes this result and does not branch on legacy role names.
 * @param {{
 *   user?: { role?: string } | null,
 *   businessGroupMembership?: { role?: string } | null,
 *   branchMemberships?: Array<{ branchId?: string, roleId?: string | null, permissions?: string[] | Record<string, boolean>, permissionsJson?: string[] | Record<string, boolean> }>,
 *   permissions?: string[] | Record<string, boolean>,
 *   activeBranchMode?: "branch" | "all",
 *   activeBranchId?: string | null,
 * }} options
 */
export function resolveNavigationForUser({
  user,
  businessGroupMembership = null,
  branchMemberships = [],
  permissions = [],
  activeBranchMode = "branch",
  activeBranchId = null,
} = /** @type {any} */ ({})) {
  const permissionSet = new Set(permissionsFrom(permissions));
  for (const membership of branchMemberships) {
    for (const permission of permissionsFrom(membership?.permissionsJson ?? membership?.permissions)) permissionSet.add(permission);
  }

  const groupRole = businessGroupMembership?.role ?? null;
  const activeMembership = branchMemberships.find((membership) => !activeBranchId || membership?.branchId === activeBranchId)
    ?? branchMemberships[0]
    ?? null;
  const branchRole = activeMembership?.roleId ?? null;
  const effectiveRole = groupRole || branchRole || legacyRole(user);
  const isAllBranches = activeBranchMode === "all";
  const isGroupManager = GROUP_MANAGERS.has(groupRole || effectiveRole);
  const isBranchManager = BRANCH_MANAGERS.has(branchRole || effectiveRole);
  const canManageBranch = isGroupManager || isBranchManager || permissionSet.has("branches.manage") || permissionSet.has("branch.members.manage");
  const canViewOrganizations = isGroupManager || effectiveRole === "accountant" || permissionSet.has("organizations.view") || permissionSet.has("organizations.manage");
  const canManageIntegrations = isGroupManager || effectiveRole === "branch_owner" || permissionSet.has("integrations.manage");
  const canManageClientCommunications = canManageIntegrations || permissionSet.has("communications.client_automation.manage");
  const canCustomerManage = CUSTOMER_MANAGERS.has(effectiveRole) || permissionSet.has("crm.write") || permissionSet.has("crm.manage");
  const canCustomerRead = canCustomerManage || ["group_analyst", "master", "mechanic", "accountant"].includes(effectiveRole) || permissionSet.has("crm.view");
  const canUseAi = ["group_owner", "group_admin", "branch_owner", "administrator", "master"].includes(effectiveRole) || permissionSet.has("ai.use");
  const canViewWarehouseAnalytics = isGroupManager || effectiveRole === "group_analyst" || permissionSet.has("warehouse.analytics.view");
  const canWork = WORK_ROLES.has(effectiveRole) || permissionSet.has("operations.view");
  const canViewWarehouse = WAREHOUSE_ROLES.has(effectiveRole) || permissionSet.has("warehouse.view");
  const canViewFinance = FINANCE_ROLES.has(effectiveRole) || permissionSet.has("finances.view");
  const canViewAllBranches = Boolean(groupRole);

  const branchOnly = (href, label, description, options = {}) => item(href, label, description, {
    ...options,
    requiresBranch: true,
    disabled: isAllBranches,
    disabledReason: isAllBranches ? "Для действия выберите филиал" : undefined,
  });

  const sections = [
    {
      id: "home",
      label: "Главное",
      href: isAllBranches ? "/owner" : "/",
      items: [item(isAllBranches ? "/owner" : "/", isAllBranches ? "Все филиалы" : "Дашборд", isAllBranches ? "Сводный обзор без изменений данных." : "Смена, задачи и быстрый старт.")],
    },
  ];

  if (canWork) {
    const workItems = [];
    if (canCustomerManage) workItems.push(branchOnly("/records", "Записи", "Рабочий журнал YCLIENTS.", { requiresShift: true }));
    workItems.push(branchOnly("/shipment", "Журнал отгрузок", "Поиск и контроль документов.", { requiresShift: true }));
    if (effectiveRole !== "mechanic") workItems.push(branchOnly("/shipment/new", "Новая отгрузка", "Создать рабочий документ.", { requiresShift: true }));
    sections.push({ id: "work", label: "Работа", href: workItems[0]?.href ?? "/shipment", items: workItems });
  }

  if (canCustomerRead) {
    const clientItems = [branchOnly("/clients/counterparties", "Клиенты", "Клиенты, контакты и история.")];
    if (canCustomerManage) {
      clientItems.push(branchOnly("/crm", "Дела клиентов", "Следующие действия и контроль."));
      clientItems.push(branchOnly("/messages", "Сообщения", "Рабочая переписка с клиентами."));
      clientItems.push(item("/cabinet/customer-analytics", "Аналитика клиентов", "Повторы, спящие клиенты и услуги."));
    }
    sections.push({ id: "clients", label: "Клиенты", href: clientItems[0].href, items: clientItems });
  }

  if (canViewWarehouse) {
    const warehouseItems = [branchOnly("/inventory/products", "Товары", "Карточки и доступные остатки.")];
    if (effectiveRole !== "mechanic") {
      warehouseItems.push(branchOnly("/inventory/receipts", "Приёмка товара", "Поступления на склад."));
      warehouseItems.push(branchOnly("/inventory/writeoffs", "Корректировки", "Списания и технические изменения."));
      warehouseItems.push(branchOnly("/warehouse/inventory", "Инвентаризации", "Сверка фактических остатков."));
      warehouseItems.push(branchOnly("/inventory/restock", "Пополнение", "Дефицит и заказ поставщикам."));
      warehouseItems.push(branchOnly("/clients/counterparties", "Поставщики", "Контакты и документы поставщиков."));
    }
    if (canViewWarehouseAnalytics) warehouseItems.push(item("/warehouse/product-analytics", "Аналитика товаров", "Продажи, маржа и неликвид."));
    sections.push({ id: "warehouse", label: "Склад", href: warehouseItems[0].href, items: warehouseItems });
  }

  if (canViewFinance) {
    const financeItems = [
      item("/finance", "Обзор", "P&L, движение денег и план/факт."),
      branchOnly("/cash", "Касса", "Смена, расходы и закрытие."),
      branchOnly("/finance/invoices", "Счета поставщиков", "Документы из приёмок."),
      item("/finance?tab=expenses", "Расходы", "Статьи и динамика расходов."),
      item("/salary", "Зарплата", "Расчёт и выплаты команды."),
      item("/finance/profit", "Рентабельность", "Прибыльность товаров и документов."),
      item("/finance?tab=taxes", "Налоги и отчёты", "Налоги, документы и экспорт."),
    ];
    sections.push({ id: "finance", label: "Финансы", href: "/finance", items: financeItems });
  }

  if (canUseAi) {
    sections.push({
      id: "ai-assistant",
      label: "ИИ-помощник",
      href: "/ai-assistant",
      items: [item("/ai-assistant", "Открыть помощника", "Рабочий поиск и расчёты без действий от имени клиента.", { disabled: isAllBranches, disabledReason: isAllBranches ? "Выберите филиал для рабочего запроса" : undefined })],
    });
  }

  const managementItems = [];
  if (canManageBranch || canViewOrganizations || canManageIntegrations) managementItems.push(item("/management", "Обзор управления", "Структура бизнеса, подключения и система."));
  if (canManageBranch) {
    managementItems.push(item("/cabinet/branches", "Филиалы", "Настройки физических точек."));
    managementItems.push(item(activeBranchId ? `/cabinet/branches?branch=${encodeURIComponent(activeBranchId)}&tab=employees` : "/cabinet/branches?tab=employees", "Сотрудники и роли", "Доступ сотрудников к филиалам."));
  }
  if (canViewOrganizations) managementItems.push(item("/cabinet/organizations", "Организации", "Юридические лица и реквизиты."));
  if (canManageIntegrations) {
    managementItems.push(item("/cabinet/integrations", "Интеграции", "Финансы, учёт, каталоги и внешние API."));
    managementItems.push(item("/cabinet/integrations/messenger", "Каналы связи", "Рабочий Telegram филиала и другие каналы."));
  }
  if (canManageClientCommunications) managementItems.push(item("/cabinet/notifications", "Уведомления клиентам", "Сценарии, шаблоны и журнал отправок."));
  if (canManageIntegrations) managementItems.push(item("/cabinet/ai-assistant", "Настройки ИИ", "Доступ, модель и правила расчёта."));
  if (managementItems.length) sections.push({ id: "management", label: "Управление", href: "/management", items: managementItems });

  const personalItems = [
    item("/cabinet", "Мой профиль", "Личные данные и роль."),
    item("/salary?view=mine", "Моя зарплата", "Собственные начисления и выплаты."),
    item("/notifications", "Мои уведомления", "Личные и рабочие напоминания."),
    item("/cabinet?tab=telegram", "Мой Telegram", "Персональные уведомления сотрудника."),
    item("/cabinet?tab=security", "Безопасность", "Смена пароля для входа."),
    item("/cabinet?tab=branches", "Доступные филиалы", "Ваши филиалы и роли."),
    { id: "logout", label: "Выйти", action: "logout" },
  ];

  return {
    effectiveRole,
    capabilities: [...permissionSet],
    sections: sections.filter((section) => section.items.length > 0),
    personalItems,
    managementActions: managementItems,
    canViewAllBranches,
    canManageBranches: canManageBranch,
  };
}
