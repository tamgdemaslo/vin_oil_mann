import { prisma } from "@/lib/db";

export const DEFAULT_CRM_STAGES = [
  { name: "Нужно рассчитать", sortOrder: 10, color: "amber" },
  { name: "Расчёт отправлен", sortOrder: 20, color: "sky" },
  { name: "Проверить ответ", sortOrder: 30, color: "blue" },
  { name: "Клиент ответил", sortOrder: 40, color: "violet" },
  { name: "Ожидает запчасти", sortOrder: 50, color: "orange" },
  { name: "Запчасти пришли", sortOrder: 60, color: "emerald" },
  { name: "Отложено", sortOrder: 70, color: "zinc" },
  { name: "Клиент отказался", sortOrder: 80, color: "rose" },
  { name: "Дубль / архив", sortOrder: 90, color: "zinc" },
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
