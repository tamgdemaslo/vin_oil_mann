import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const schemaPath = path.join(root, "prisma/schema.prisma");
const dbPolicyPath = path.join(root, "src/lib/db.ts");
const migrationPath = path.join(root, "prisma/migrations/20260728120000_branch_architecture_foundation/migration.sql");
const markdownPath = path.join(root, "docs/branch-model-classification.md");
const jsonPath = path.join(root, "docs/branch-model-classification.json");

const schema = fs.readFileSync(schemaPath, "utf8");
const dbPolicy = fs.readFileSync(dbPolicyPath, "utf8");
const migration = fs.readFileSync(migrationPath, "utf8");

const explicitNonBranchModels = {
  BusinessGroup: ["BUSINESS_GROUP_SCOPED", "Корневая сущность сети; сама задаёт businessGroupId для дочерних объектов."],
  User: ["GLOBAL", "Глобальная identity авторизации; доступ к группе и филиалам задают memberships."],
  Branch: ["BUSINESS_GROUP_SCOPED", "Филиал является границей scope и принадлежит BusinessGroup."],
  BusinessGroupMembership: ["BUSINESS_GROUP_SCOPED", "Права владельца/аналитика на уровне сети."],
  BranchStockTransfer: ["BUSINESS_GROUP_SCOPED", "Межфилиальный документ с явными sourceBranchId и destinationBranchId."],
  BranchStockTransferItem: ["BUSINESS_GROUP_SCOPED", "Строка межфилиального документа; scope наследуется через transfer."],
  AuthPassword: ["GLOBAL", "Секрет аутентификации глобального User."],
  VehicleModelAlias: ["GLOBAL", "Общий технический нормализатор марки/модели без операционных данных."],
  IntegrationProvider: ["GLOBAL", "Системный справочник поддерживаемых providers; credentials хранятся отдельно."],
  LocalOrganization: ["BUSINESS_GROUP_SCOPED", "Legacy control-plane организация, временно сопоставленная Branch через legacyOrganizationId."],
  MannPdfImportBatch: ["GLOBAL", "Техническая загрузка общего каталога MANN."],
  MannPdfApplicationRaw: ["GLOBAL", "Необработанные общие строки каталога MANN."],
  MannFilterApplication: ["GLOBAL", "Общий технический каталог применимости фильтров MANN."],
  FluidCatalogImportBatch: ["GLOBAL", "Техническая загрузка общего каталога жидкостей."],
  FluidSourceRow: ["GLOBAL", "Необработанные общие строки каталога жидкостей."],
  VehicleFluidRequirement: ["GLOBAL", "Общие технические требования автомобиля к жидкостям."],
  MannFluidRequirementLink: ["GLOBAL", "Общая техническая связь MANN и требований к жидкостям."],
};

const branchControlPlaneModels = new Set([
  "BranchMembership",
  "BranchLegalEntity",
  "BranchCommunicationSettings",
  "BranchTelegramIntegration",
  "BranchAuditLog",
]);

function modelPurpose(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^AI /, "AI ")
    .toLocaleLowerCase("ru-RU");
}

function mappedTable(body, name) {
  return body.match(/@@map\("([^"]+)"\)/)?.[1] ?? name;
}

function hasBranchIndex(body) {
  return /@@(?:index|unique|id)\(\[\s*branchId(?:\s*,|\s*\])/.test(body) || /branchId\s+[^\n]*@(?:unique|id)/.test(body);
}

function globalUniqueConstraints(body) {
  const fields = [...body.matchAll(/^\s*(\w+)\s+[^\n]*@unique\b/gm)].map((match) => match[1]);
  const model = [...body.matchAll(/^\s*@@unique\(\[([^\]]+)\]/gm)]
    .map((match) => match[1].split(",").map((item) => item.trim()))
    .filter((fieldsList) => !fieldsList.includes("branchId"))
    .map((fieldsList) => fieldsList.join("+"));
  return [...fields, ...model];
}

const rows = [...schema.matchAll(/model\s+(\w+)\s*\{([\s\S]*?)\n\}/g)].map((match) => {
  const [, modelName, body] = match;
  const hasBranchId = /\bbranchId\s+String\??/.test(body);
  const branchRequired = /\bbranchId\s+String(?:\s|@)/.test(body);
  const hasBusinessGroupId = /\bbusinessGroupId\s+String\??/.test(body);
  const table = mappedTable(body, modelName);
  const scopeDecision = explicitNonBranchModels[modelName];
  if (!hasBranchId && !scopeDecision) throw new Error(`Нет явной scope-классификации для ${modelName}`);
  const scope = hasBranchId ? "BRANCH_SCOPED" : scopeDecision[0];
  const reason = hasBranchId
    ? branchControlPlaneModels.has(modelName)
      ? "Филиальный control-plane объект, обслуживаемый только management API."
      : "Операционные данные принадлежат одному активному филиалу."
    : scopeDecision[1];
  const branchRelation = /\bbranch\s+Branch\??\s+@relation\(/.test(body);
  const branchIndex = hasBranchIndex(body);
  const globalUniques = hasBranchId ? globalUniqueConstraints(body) : [];
  const guarded = hasBranchId && dbPolicy.includes(`"${modelName}"`);
  const migrationCovered = hasBranchId && migration.includes(`'${table}'`);
  const changes = [];
  if (hasBranchId && !branchRequired && modelName !== "BranchAuditLog") changes.push("make branchId required");
  if (hasBranchId && !branchRelation && !branchControlPlaneModels.has(modelName)) changes.push("add/justify Branch relation");
  if (hasBranchId && !branchIndex) changes.push("add branch index");
  if (globalUniques.length) changes.push(`audit uniques: ${globalUniques.join(", ")}`);
  if (hasBranchId && !guarded && !branchControlPlaneModels.has(modelName)) changes.push("add query guard");
  if (hasBranchId && !migrationCovered && !branchControlPlaneModels.has(modelName)) changes.push("add migration backfill");
  if (modelName === "LocalOrganization") changes.push("remove runtime dependency after legacy migration");
  const isolationRisk = scope === "GLOBAL"
    ? "LOW"
    : changes.some((item) => /guard|migration|required/.test(item))
      ? "CRITICAL"
      : changes.length
        ? "HIGH"
        : branchControlPlaneModels.has(modelName)
          ? "MEDIUM"
          : "LOW";
  return {
    modelName,
    purpose: modelPurpose(modelName),
    scope,
    hasBranchId,
    hasBusinessGroupId,
    reason,
    queryPolicy: scope === "GLOBAL"
      ? "global technical access"
      : branchControlPlaneModels.has(modelName) || scope === "BUSINESS_GROUP_SCOPED"
        ? "explicit control-plane service checks"
        : guarded
          ? "request tenant Prisma guard"
          : "MISSING",
    migrationPolicy: scope === "GLOBAL"
      ? "preserve globally"
      : hasBranchId
        ? migrationCovered || branchControlPlaneModels.has(modelName)
          ? "backfill/control-plane migration"
          : "MISSING"
        : "create/map at group level",
    isolationRisk,
    requiredChanges: changes.length ? changes.join("; ") : "none",
  };
});

const counts = Object.fromEntries(["GLOBAL", "BUSINESS_GROUP_SCOPED", "BRANCH_SCOPED"].map((scope) => [scope, rows.filter((row) => row.scope === scope).length]));
const generatedAt = "2026-07-28";
const header = `# Классификация Prisma-моделей по филиальному scope\n\n` +
  `Сгенерировано машинно из \`prisma/schema.prisma\`. Дата реестра: ${generatedAt}. ` +
  `Всего моделей: **${rows.length}**; GLOBAL: **${counts.GLOBAL}**; BUSINESS_GROUP_SCOPED: **${counts.BUSINESS_GROUP_SCOPED}**; BRANCH_SCOPED: **${counts.BRANCH_SCOPED}**.\n\n` +
  `Команда проверки: \`npm run audit:branch-models\`. Обновление: \`node scripts/generate-branch-model-classification.mjs --write\`.\n\n` +
  `| modelName | purpose | scope | branchId | businessGroupId | reason | queryPolicy | migrationPolicy | risk | requiredChanges |\n` +
  `|---|---|---|---:|---:|---|---|---|---|---|\n`;
const markdown = header + rows.map((row) =>
  `| ${row.modelName} | ${row.purpose} | ${row.scope} | ${row.hasBranchId ? "yes" : "no"} | ${row.hasBusinessGroupId ? "yes" : "no"} | ${row.reason} | ${row.queryPolicy} | ${row.migrationPolicy} | ${row.isolationRisk} | ${row.requiredChanges} |`
).join("\n") + "\n";
const json = JSON.stringify({ generatedAt, counts, models: rows }, null, 2) + "\n";

if (process.argv.includes("--write")) {
  fs.writeFileSync(markdownPath, markdown);
  fs.writeFileSync(jsonPath, json);
  console.log(`Wrote ${rows.length} model classifications.`);
} else {
  const currentMarkdown = fs.existsSync(markdownPath) ? fs.readFileSync(markdownPath, "utf8") : "";
  const currentJson = fs.existsSync(jsonPath) ? fs.readFileSync(jsonPath, "utf8") : "";
  if (currentMarkdown !== markdown || currentJson !== json) {
    console.error("Branch model classification is stale. Run generator with --write.");
    process.exit(1);
  }
  if (rows.length !== 145) {
    console.error(`Expected 145 Prisma models, found ${rows.length}. Update the explicit classification.`);
    process.exit(1);
  }
  console.log(`Branch model classification is current (${rows.length} models).`);
}
