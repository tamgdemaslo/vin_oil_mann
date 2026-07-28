import { prisma } from "@/lib/db";
import { getBranchContext } from "@/lib/branch-context";

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

async function currentBranchId(branchId?: string) {
  if (branchId) return branchId;
  const resolved = (await getBranchContext({ requireActive: true }))?.branchId;
  if (!resolved) throw new Error("Для CRM нужен активный филиал");
  return resolved;
}

export async function ensureDefaultCrmStages(branchId?: string) {
  const scopedBranchId = await currentBranchId(branchId);
  const legacyClosedStage = await prisma.crmStage.findUnique({ where: { branchId_sortOrder: { branchId: scopedBranchId, sortOrder: 80 } } });
  if (legacyClosedStage?.name.toLowerCase().includes("закры")) {
    const closedStage = await prisma.crmStage.upsert({
      where: { branchId_sortOrder: { branchId: scopedBranchId, sortOrder: 100 } },
      update: { name: "Закрыто", color: "emerald" },
      create: { branchId: scopedBranchId, name: "Закрыто", sortOrder: 100, color: "emerald" },
    });
    await prisma.crmDeal.updateMany({
      where: { branchId: scopedBranchId, stageId: legacyClosedStage.id, status: { not: "open" } },
      data: { stageId: closedStage.id },
    });
  }

  await prisma.$transaction(
    DEFAULT_CRM_STAGES.map((stage) =>
      prisma.crmStage.upsert({
        where: { branchId_sortOrder: { branchId: scopedBranchId, sortOrder: stage.sortOrder } },
        update: {
          name: stage.name,
          color: stage.color,
        },
        create: { ...stage, branchId: scopedBranchId },
      })
    )
  );
}

export async function getFirstCrmStage(branchId?: string) {
  const scopedBranchId = await currentBranchId(branchId);
  await ensureDefaultCrmStages(scopedBranchId);
  return prisma.crmStage.findFirst({ where: { branchId: scopedBranchId }, orderBy: { sortOrder: "asc" } });
}

export async function getCrmStageBySortOrder(sortOrder: number, branchId?: string) {
  const scopedBranchId = await currentBranchId(branchId);
  await ensureDefaultCrmStages(scopedBranchId);
  return prisma.crmStage.findUnique({ where: { branchId_sortOrder: { branchId: scopedBranchId, sortOrder } } });
}
