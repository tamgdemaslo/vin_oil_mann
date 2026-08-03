import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const shell = read("src/components/platform/PlatformShell.tsx");
const cabinet = read("src/app/cabinet/CabinetDashboard.tsx");
const list = read("src/app/cabinet/branches/page.tsx");
const detail = read("src/app/cabinet/branches/[branchId]/BranchSettingsClient.tsx");
const detailRoute = read("src/app/api/branches/[branchId]/route.ts");
const telegramRoute = read("src/app/api/cabinet/telegram-link/route.ts");
const telegramCard = read("src/app/cabinet/EmployeeTelegramCard.tsx");
const branchContext = read("src/lib/branch-context.ts");
const branches = read("src/lib/branches.ts");

assert.match(shell, /Настройки текущего филиала/);
assert.match(shell, /Управление филиалами/);
assert.match(shell, /POST|method: "POST"/);
assert.match(shell, /\/api\/session\/active-branch/);
assert.match(shell, /invalidateDashboardClientBundle\(\)/);
assert.match(shell, /router\.refresh\(\)/);
assert.match(shell, /Переключаем филиал…/);
assert.match(list, /const sessionResponse = await fetch\("\/api\/session\/active-branch", \{ cache: "no-store" \}\)/);
assert.match(detail, /const sessionResponse = await fetch\("\/api\/session\/active-branch", \{ cache: "no-store" \}\)/);

assert.match(cabinet, /label: "Филиалы"/);
assert.match(cabinet, /label: "Организации"/);
assert.match(cabinet, /Адреса, телефоны, графики, сотрудники и настройки точек/);

for (const label of ["Открыть", "Настроить", "Переключиться", "Архивировать", "Создать филиал"]) {
  assert.match(list, new RegExp(label));
}
for (const tab of ["Основное", "Работа точки", "Юридические данные", "Связь и уведомления", "Интеграции", "Сотрудники", "Документы и нумерация", "Опасная зона"]) {
  assert.match(detail, new RegExp(tab));
}

assert.match(detailRoute, /businessGroupId: context\.businessGroupId/);
assert.match(detailRoute, /context\.branches\.some/);
assert.match(branches, /hasBranchPermission\(context, "branches\.update", branchId\)/);
assert.match(branches, /hasBranchPermission\(context, "branches\.archive", branchId\)/);
assert.match(branches, /runWithRequestTenant\(createdBranchTenant, async \(\) =>/);
assert.match(branches, /tx\.branchMembership\.create/);
assert.match(branchContext, /branches\.manage_members/);
assert.match(branchContext, /integrations\.manage/);

assert.match(telegramRoute, /requireBranchContext\(\{ allowAll: true, requireActive: false \}\)/);
assert.match(telegramRoute, /runWithRequestTenant/);
assert.match(telegramRoute, /Для настройки Telegram выберите конкретный филиал/);
assert.match(telegramCard, /branchMode === "all"/);
assert.match(telegramCard, /data\?\.branchId !== activeBranchId/);

console.log("Branch management UI and context regression checks passed.");
