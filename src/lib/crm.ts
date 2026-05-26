import { prisma } from "@/lib/db";

export const DEFAULT_CRM_STAGES = [
  { name: "Новый лид", sortOrder: 10, color: "amber" },
  { name: "Связаться", sortOrder: 20, color: "sky" },
  { name: "Записан", sortOrder: 30, color: "blue" },
  { name: "Приехал", sortOrder: 40, color: "violet" },
  { name: "Согласование работ", sortOrder: 50, color: "orange" },
  { name: "В работе", sortOrder: 60, color: "zinc" },
  { name: "Оплачено", sortOrder: 70, color: "emerald" },
  { name: "Потерян / отложен", sortOrder: 80, color: "rose" },
] as const;

export async function ensureDefaultCrmStages() {
  const count = await prisma.crmStage.count();
  if (count > 0) return;

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
