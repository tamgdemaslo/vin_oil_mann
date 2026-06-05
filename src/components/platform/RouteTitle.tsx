"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

const APP_SUFFIX = "Эко-платформа";

type RouteTitleRule = {
  match: (pathname: string) => boolean;
  title: (pathname: string) => string;
};

function segment(pathname: string, index: number) {
  return decodeURIComponent(pathname.split("/").filter(Boolean)[index] ?? "");
}

const routeTitleRules: RouteTitleRule[] = [
  { match: (pathname) => pathname === "/client-site", title: () => "Сайт | Там где масло." },
  { match: (pathname) => pathname === "/login", title: () => `Вход | ${APP_SUFFIX}` },
  { match: (pathname) => pathname === "/", title: () => `Главная | ${APP_SUFFIX}` },
  { match: (pathname) => pathname === "/dashboard", title: () => `Сводка | ${APP_SUFFIX}` },
  { match: (pathname) => pathname === "/notifications", title: () => `Уведомления | ${APP_SUFFIX}` },

  { match: (pathname) => pathname === "/shipment/new", title: () => `Новая отгрузка | ${APP_SUFFIX}` },
  {
    match: (pathname) => /^\/shipment\/[^/]+\/edit\/?$/.test(pathname),
    title: (pathname) => `Редактирование ${segment(pathname, 1)} | Отгрузка`,
  },
  {
    match: (pathname) => /^\/shipment\/[^/]+\/precheck\/?$/.test(pathname),
    title: (pathname) => `Предчек ${segment(pathname, 1)} | Отгрузка`,
  },
  {
    match: (pathname) => /^\/shipment\/[^/]+\/poster\/?$/.test(pathname),
    title: (pathname) => `Постер ${segment(pathname, 1)} | Отгрузка`,
  },
  {
    match: (pathname) => /^\/shipment\/[^/]+\/tags\/?$/.test(pathname),
    title: (pathname) => `Бирки ${segment(pathname, 1)} | Отгрузка`,
  },
  {
    match: (pathname) => /^\/shipment\/[^/]+\/?$/.test(pathname),
    title: (pathname) => `Отгрузка ${segment(pathname, 1)} | ${APP_SUFFIX}`,
  },
  { match: (pathname) => pathname === "/shipment", title: () => `Отгрузки | ${APP_SUFFIX}` },

  { match: (pathname) => pathname === "/inventory/products", title: () => `Товары | Склад` },
  { match: (pathname) => pathname === "/inventory/receipts", title: () => `Приемка | Склад` },
  { match: (pathname) => pathname === "/inventory/writeoffs", title: () => `Списание | Склад` },
  { match: (pathname) => pathname === "/inventory/restock", title: () => `Пополнение | Склад` },
  { match: (pathname) => pathname === "/inventory/profit", title: () => `Прибыль склада | ${APP_SUFFIX}` },
  { match: (pathname) => pathname === "/inventory/counterparties", title: () => `Контрагенты | Склад` },
  { match: (pathname) => pathname === "/inventory", title: () => `Склад | ${APP_SUFFIX}` },

  { match: (pathname) => pathname === "/cash", title: () => `Касса | ${APP_SUFFIX}` },
  { match: (pathname) => pathname === "/finance", title: () => `Финансы | ${APP_SUFFIX}` },
  { match: (pathname) => pathname === "/finance/invoices", title: () => `Счета поставщиков | Финансы` },
  { match: (pathname) => pathname === "/finance/profit", title: () => `Прибыль | Финансы` },
  { match: (pathname) => pathname === "/salary", title: () => `Зарплата | ${APP_SUFFIX}` },

  { match: (pathname) => pathname === "/crm", title: () => `CRM | ${APP_SUFFIX}` },
  { match: (pathname) => pathname === "/records", title: () => `Записи | CRM` },
  { match: (pathname) => pathname === "/clients", title: () => `Клиенты | CRM` },
  { match: (pathname) => pathname === "/clients/counterparties", title: () => `Клиенты | Контрагенты` },

  { match: (pathname) => pathname === "/cabinet", title: () => `Кабинет | ${APP_SUFFIX}` },
  { match: (pathname) => pathname === "/cabinet/shifts", title: () => `Смены | Кабинет` },
  { match: (pathname) => pathname === "/cabinet/customer-analytics", title: () => `Аналитика клиентов | Кабинет` },
  { match: (pathname) => pathname === "/cabinet/integrations", title: () => `Интеграции | Кабинет` },
  { match: (pathname) => pathname === "/cabinet/salary", title: () => `Зарплата | Кабинет` },
  { match: (pathname) => pathname === "/cabinet/analytics", title: () => `Аналитика | Кабинет` },
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

function getRouteTitle(pathname: string) {
  const normalized = pathname.endsWith("/") && pathname !== "/" ? pathname.slice(0, -1) : pathname;
  const rule = routeTitleRules.find((item) => item.match(normalized));
  if (rule) return rule.title(normalized);

  return `${APP_SUFFIX} | Там где масло.`;
}

export default function RouteTitle() {
  const pathname = usePathname();

  useEffect(() => {
    document.title = getRouteTitle(pathname);
  }, [pathname]);

  return null;
}
