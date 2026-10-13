const APP_SUFFIX = "ИП ЕЛИСЕЕНКО ИЛЬЯ СЕРГЕЕВИЧ";

type RouteTitleRule = {
  match: (pathname: string) => boolean;
  title: (pathname: string) => string;
};

function segment(pathname: string, index: number) {
  return decodeURIComponent(pathname.split("/").filter(Boolean)[index] ?? "");
}

const routeTitleRules: RouteTitleRule[] = [
  { match: (pathname) => pathname === "/ai-assistant", title: () => "ИИ-помощник | Главное" },
  { match: (pathname) => pathname === "/cabinet/ai-agent", title: () => "ИИ-агент | Управление" },
  { match: (pathname) => pathname === "/cabinet/ai-assistant", title: () => "ИИ-помощник | Управление" },
  { match: (pathname) => pathname === "/cabinet/ai-assistant/pricing", title: () => "Тарифы ИИ | Управление" },
  { match: (pathname) => pathname === "/crm/ai-agent", title: () => "ИИ-агент | Клиенты" },
  { match: (pathname) => pathname === "/inventory/products/audit", title: () => "Проверка товаров | Склад" },
  { match: (pathname) => pathname === "/inventory/integrations/mann-pdf", title: () => "Каталог MANN | Склад" },
  { match: (pathname) => pathname === "/management/booking", title: () => "Настройки записи | Управление" },
  { match: (pathname) => pathname === "/management/inventory-cost-cutover", title: () => "Себестоимость склада | Управление" },
  { match: (pathname) => pathname === "/operations/restock", title: () => "Пополнение | Склад" },
  { match: (pathname) => pathname === "/operations/supply", title: () => "Снабжение | Склад" },
  { match: (pathname) => pathname === "/owner", title: () => "Все филиалы | Главное" },
  { match: (pathname) => pathname === "/owner/storefront", title: () => "Витрина | Управление" },
  { match: (pathname) => pathname === "/warehouse/product-analytics", title: () => "Аналитика товаров | Склад" },
  { match: (pathname) => pathname === "/booking", title: () => "Запись на обслуживание | Там где масло." },
  { match: (pathname) => /^\/warehouse\/inventory\/[^/]+$/.test(pathname), title: (pathname) => `Инвентаризация ${segment(pathname, 2)} | Склад` },
  { match: (pathname) => /^\/shipment\/[^/]+\/closing$/.test(pathname), title: (pathname) => `Закрытие отгрузки ${segment(pathname, 1)} | Работа` },
  { match: (pathname) => pathname.startsWith("/booking/manage/"), title: () => "Управление записью | Там где масло." },

  { match: (pathname) => pathname === "/client-site" || pathname.startsWith("/client-site/"), title: () => "Сайт | Там где масло." },
  { match: (pathname) => pathname === "/login", title: () => `Вход | ${APP_SUFFIX}` },
  { match: (pathname) => pathname === "/", title: () => `Главная | ${APP_SUFFIX}` },
  { match: (pathname) => pathname === "/dashboard", title: () => `Сводка | ${APP_SUFFIX}` },
  { match: (pathname) => pathname === "/notifications", title: () => `Уведомления | ${APP_SUFFIX}` },
  { match: (pathname) => pathname === "/messages", title: () => `Сообщения | Клиенты` },

  { match: (pathname) => pathname === "/shipment/new", title: () => `Новая отгрузка | Работа` },
  {
    match: (pathname) => /^\/shipment\/[^/]+\/edit\/?$/.test(pathname),
    title: (pathname) => `Редактирование ${segment(pathname, 1)} | Работа`,
  },
  {
    match: (pathname) => /^\/shipment\/[^/]+\/precheck\/?$/.test(pathname),
    title: (pathname) => `Предчек ${segment(pathname, 1)} | Работа`,
  },
  {
    match: (pathname) => /^\/shipment\/[^/]+\/poster\/?$/.test(pathname),
    title: (pathname) => `Постер ${segment(pathname, 1)} | Работа`,
  },
  {
    match: (pathname) => /^\/shipment\/[^/]+\/tags\/?$/.test(pathname),
    title: (pathname) => `Бирки ${segment(pathname, 1)} | Работа`,
  },
  {
    match: (pathname) => /^\/shipment\/[^/]+\/?$/.test(pathname),
    title: (pathname) => `Отгрузка ${segment(pathname, 1)} | Работа`,
  },
  { match: (pathname) => pathname === "/shipment", title: () => `Журнал отгрузок | Работа` },

  { match: (pathname) => pathname === "/inventory/products", title: () => `Товары | Склад` },
  { match: (pathname) => pathname === "/warehouse/avito", title: () => `Авито | Склад` },
  { match: (pathname) => pathname === "/inventory/cells", title: () => `Ячейки | Склад` },
  { match: (pathname) => pathname === "/warehouse/inventory", title: () => `Инвентаризация | Склад` },
  { match: (pathname) => pathname === "/inventory/receipts", title: () => `Приемка | Склад` },
  { match: (pathname) => pathname === "/inventory/writeoffs" || pathname === "/warehouse/adjustments", title: () => `Корректировки | Склад` },
  { match: (pathname) => pathname === "/inventory/restock", title: () => `Пополнение | Склад` },
  { match: (pathname) => pathname === "/inventory/profit", title: () => `Прибыль | Склад` },
  { match: (pathname) => pathname === "/inventory/counterparties", title: () => `Контрагенты | Склад` },
  { match: (pathname) => pathname === "/inventory", title: () => `Склад | ${APP_SUFFIX}` },

  { match: (pathname) => pathname === "/cash", title: () => `Касса | Финансы` },
  { match: (pathname) => pathname === "/finance", title: () => `Обзор | Финансы` },
  { match: (pathname) => pathname === "/finance/invoices", title: () => `Счета поставщиков | Финансы` },
  { match: (pathname) => pathname === "/finance/profit", title: () => `Цены и прибыль | Финансы` },
  { match: (pathname) => pathname === "/finance/shifts", title: () => `Зарплата | Финансы` },
  { match: (pathname) => pathname === "/salary", title: () => `Зарплата | Финансы` },

  { match: (pathname) => pathname === "/crm", title: () => `Дела клиентов | Клиенты` },
  { match: (pathname) => pathname === "/crm/messages", title: () => `Сообщения | CRM` },
  { match: (pathname) => pathname === "/records", title: () => `Записи | Работа` },
  { match: (pathname) => pathname === "/clients", title: () => `Клиенты | CRM` },
  { match: (pathname) => pathname === "/clients/counterparties", title: () => `Контрагенты | Клиенты` },

  { match: (pathname) => pathname === "/management", title: () => `Управление | ${APP_SUFFIX}` },
  { match: (pathname) => pathname === "/cabinet", title: () => `Мой профиль | ${APP_SUFFIX}` },
  { match: (pathname) => pathname === "/cabinet/shifts", title: () => `Зарплата | Финансы` },
  { match: (pathname) => pathname === "/cabinet/customer-analytics", title: () => `Аналитика клиентов | Кабинет` },
  { match: (pathname) => pathname === "/cabinet/integrations", title: () => `Интеграции | Кабинет` },
  { match: (pathname) => pathname === "/cabinet/integrations/messenger", title: () => `Каналы связи | Управление` },
  { match: (pathname) => pathname === "/cabinet/branches", title: () => `Филиалы | Управление` },
  { match: (pathname) => pathname === "/cabinet/organizations", title: () => `Организации | Управление` },
  { match: (pathname) => pathname === "/cabinet/notifications", title: () => `Уведомления клиентам | Управление` },
  { match: (pathname) => pathname === "/cabinet/salary", title: () => `Зарплата | Финансы` },
  { match: (pathname) => pathname === "/cabinet/analytics", title: () => `Зарплата | Финансы` },
  { match: (pathname) => pathname === "/cabinet/penalties", title: () => `Штрафы и бонусы | Кабинет` },
  { match: (pathname) => pathname === "/cabinet/vehicles", title: () => `Автомобили | Кабинет` },

  {
    match: (pathname) => /^\/report\/[^/]+\/print\/?$/.test(pathname),
    title: () => "Печать отчета | Диагностика",
  },
  {
    match: (pathname) => /^\/report\/[^/]+\/?$/.test(pathname),
    title: () => "Отчет диагностики | Клиент",
  },
];

export function getRouteTitle(pathname: string) {
  const normalized = pathname.endsWith("/") && pathname !== "/" ? pathname.slice(0, -1) : pathname;
  const rule = routeTitleRules.find((item) => item.match(normalized));
  if (rule) return rule.title(normalized);

  return `${APP_SUFFIX} | Там где масло.`;
}

