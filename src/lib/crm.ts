import { prisma } from "@/lib/db";

export const DEFAULT_CRM_STAGES = [
  { name: "Новый запрос", sortOrder: 10, color: "sky" },
  { name: "Уточнить данные", sortOrder: 20, color: "blue" },
  { name: "Рассчитать", sortOrder: 30, color: "amber" },
  { name: "Расчёт отправлен", sortOrder: 40, color: "sky" },
  { name: "Проверить расходники", sortOrder: 50, color: "orange" },
  { name: "Ждём расходники", sortOrder: 60, color: "orange" },
  { name: "Запись создана", sortOrder: 70, color: "violet" },
  { name: "На визите / в документе", sortOrder: 80, color: "zinc" },
  { name: "Контроль после визита", sortOrder: 90, color: "blue" },
  { name: "Закрыто", sortOrder: 100, color: "emerald" },
] as const;

export async function ensureDefaultCrmStages() {
  const legacyClosedStage = await prisma.crmStage.findUnique({ where: { sortOrder: 80 } });
  if (legacyClosedStage?.name.toLowerCase().includes("закры")) {
    const closedStage = await prisma.crmStage.upsert({
      where: { sortOrder: 100 },
      update: { name: "Закрыто", color: "emerald" },
      create: { name: "Закрыто", sortOrder: 100, color: "emerald" },
    });
    await prisma.crmDeal.updateMany({
      where: { stageId: legacyClosedStage.id, status: { not: "open" } },
      data: { stageId: closedStage.id },
    });
  }

  await prisma.$transaction(
    DEFAULT_CRM_STAGES.map((stage) =>
      prisma.crmStage.upsert({
        where: { sortOrder: stage.sortOrder },
        update: {
          name: stage.name,
          color: stage.color,
        },
        create: stage,
      })
    )
  );
}

export async function getFirstCrmStage() {
  await ensureDefaultCrmStages();
  return prisma.crmStage.findFirst({ orderBy: { sortOrder: "asc" } });
}

export async function getCrmStageBySortOrder(sortOrder: number) {
  await ensureDefaultCrmStages();
  return prisma.crmStage.findUnique({ where: { sortOrder } });
}
