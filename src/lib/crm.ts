import { prisma } from "@/lib/db";

export const DEFAULT_CRM_STAGES = [
  { name: "Новый запрос", sortOrder: 10, color: "sky" },
  { name: "Нужно связаться", sortOrder: 20, color: "emerald" },
  { name: "Ждёт расчёт", sortOrder: 30, color: "amber" },
  { name: "Ждём ответ", sortOrder: 40, color: "blue" },
  { name: "Ждём расходники", sortOrder: 50, color: "orange" },
  { name: "Нужно записать", sortOrder: 60, color: "violet" },
  { name: "В работе", sortOrder: 70, color: "zinc" },
  { name: "Закрыто", sortOrder: 80, color: "emerald" },
] as const;

export async function ensureDefaultCrmStages() {
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
