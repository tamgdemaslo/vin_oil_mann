import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { resolveNavigationForUser } from "../src/lib/navigation-policy.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0;

function scenario(name, check) {
  check();
  passed += 1;
  process.stdout.write(`✓ ${name}\n`);
}

const owner = resolveNavigationForUser({
  user: { role: "owner" },
  businessGroupMembership: { role: "group_owner" },
  branchMemberships: [{ branchId: "branch-1", roleId: "branch_owner", permissions: [] }],
  activeBranchMode: "branch",
  activeBranchId: "branch-1",
});

scenario("1. Владелец видит семь целевых разделов", () => {
  assert.deepEqual(owner.sections.map((section) => section.label), [
    "Главное", "Работа", "Клиенты", "Склад", "Финансы", "ИИ-помощник", "Управление",
  ]);
});

scenario("2. Личное меню содержит только личные действия", () => {
  assert.deepEqual(owner.personalItems.map((entry) => entry.label), [
    "Мой профиль", "Моя зарплата", "Мои уведомления", "Мой Telegram", "Безопасность", "Доступные филиалы", "Выйти",
  ]);
  assert.equal(owner.personalItems.some((entry) => entry.label === "Интеграции" || entry.label === "Организации"), false);
});

scenario("3. Механик не видит финансы и управление", () => {
  const mechanic = resolveNavigationForUser({ user: { role: "user" }, branchMemberships: [{ branchId: "branch-1", roleId: "mechanic" }], activeBranchId: "branch-1" });
  assert.equal(mechanic.sections.some((section) => section.id === "finance"), false);
  assert.equal(mechanic.sections.some((section) => section.id === "management"), false);
});

scenario("4. Бухгалтер видит финансы", () => {
  const accountant = resolveNavigationForUser({ user: { role: "user" }, branchMemberships: [{ branchId: "branch-1", roleId: "accountant" }], activeBranchId: "branch-1" });
  assert.equal(accountant.sections.some((section) => section.id === "finance"), true);
});

scenario("5. Администратор филиала может управлять сотрудниками", () => {
  const administrator = resolveNavigationForUser({ user: { role: "admin" }, branchMemberships: [{ branchId: "branch-1", roleId: "administrator" }], activeBranchId: "branch-1" });
  assert.equal(administrator.canManageBranches, true);
  assert.equal(administrator.managementActions.some((entry) => entry.label === "Сотрудники и роли"), true);
});

scenario("6. Доступ к филиалам вычисляется из membership", () => {
  const member = resolveNavigationForUser({ user: { role: "user" }, branchMemberships: [{ branchId: "branch-1", roleId: "master", permissions: ["branches.manage"] }], activeBranchId: "branch-1" });
  assert.equal(member.canManageBranches, true);
  assert.equal(member.canViewAllBranches, false);
});

scenario("7. Режим всех филиалов блокирует действия конкретной точки", () => {
  const allBranches = resolveNavigationForUser({ user: { role: "owner" }, businessGroupMembership: { role: "group_owner" }, activeBranchMode: "all" });
  const branchItems = allBranches.sections.flatMap((section) => section.items).filter((entry) => entry.requiresBranch);
  assert.ok(branchItems.length > 0);
  assert.equal(branchItems.every((entry) => entry.disabled && entry.disabledReason), true);
});

scenario("8. Управление не содержит пустых разделов", () => {
  assert.equal(owner.sections.every((section) => section.items.length > 0), true);
});

scenario("9. Настройки ИИ находятся в управлении", () => {
  assert.equal(owner.managementActions.some((entry) => entry.href === "/cabinet/ai-assistant"), true);
  assert.equal(owner.personalItems.some((entry) => entry.href === "/cabinet/ai-assistant"), false);
});

scenario("10. Личный и рабочий Telegram разведены", () => {
  const personal = readFileSync(join(root, "src/app/cabinet/EmployeeTelegramCard.tsx"), "utf8");
  const working = readFileSync(join(root, "src/app/cabinet/integrations/messenger/MessengerIntegrationsClient.tsx"), "utf8");
  assert.match(personal, /Мой Telegram/);
  assert.doesNotMatch(personal, /cabinet\/integrations\/messenger/);
  assert.match(working, /Рабочий Telegram филиала/);
});

scenario("11. Безопасность доступна отдельной вкладкой", () => {
  assert.equal(owner.personalItems.find((entry) => entry.label === "Безопасность")?.href, "/cabinet?tab=security");
});

scenario("12. Аналитика клиентов находится в разделе клиентов", () => {
  const clients = owner.sections.find((section) => section.id === "clients");
  assert.equal(clients?.items.some((entry) => entry.href === "/cabinet/customer-analytics"), true);
});

scenario("13. Критические старые URL по-прежнему существуют", () => {
  for (const path of [
    "src/app/page.tsx",
    "src/app/shipment/page.tsx",
    "src/app/inventory/products/page.tsx",
    "src/app/finance/page.tsx",
    "src/app/ai-assistant/page.tsx",
    "src/app/cabinet/page.tsx",
    "src/app/cabinet/organizations/page.tsx",
    "src/app/cabinet/integrations/page.tsx",
  ]) assert.equal(existsSync(join(root, path)), true, path);
});

scenario("14. Новый маршрут управления существует", () => {
  assert.equal(existsSync(join(root, "src/app/management/page.tsx")), true);
  assert.equal(owner.sections.find((section) => section.id === "management")?.href, "/management");
});

scenario("15. Мобильная навигация сгруппирована", () => {
  const shell = readFileSync(join(root, "src/components/platform/PlatformShell.tsx"), "utf8");
  assert.match(shell, /platform-shell__mobile-groups/);
  assert.match(shell, /<details/);
  assert.doesNotMatch(shell, /navSections\.flatMap/);
});

process.stdout.write(`\n${passed}/15 сценариев пройдено.\n`);
