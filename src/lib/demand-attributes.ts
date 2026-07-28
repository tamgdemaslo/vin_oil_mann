import { prisma } from "@/lib/db";
import { getScopedBranchId } from "@/lib/request-tenant-store";

export type DemandAttributeMeta = {
  id: string;
  name: string;
  type: string;
  required: boolean;
  order: number;
  isSystem: boolean;
  meta: { href: string; type: string; mediaType: string };
};

const DEFAULT_DEMAND_ATTRIBUTES = [
  { name: "vin номер", type: "string", required: false, order: 10, isSystem: false },
  { name: "модель авто", type: "string", required: false, order: 20, isSystem: false },
  { name: "год", type: "string", required: false, order: 30, isSystem: false },
  { name: "гос. номер", type: "string", required: false, order: 40, isSystem: false },
  { name: "пробег", type: "string", required: false, order: 50, isSystem: false },
  { name: "Объем", type: "string", required: true, order: 60, isSystem: false },
  { name: "Моторное масло", type: "string", required: true, order: 70, isSystem: false },
  { name: "двигатель", type: "string", required: false, order: 75, isSystem: false },
  { name: "объем двигателя", type: "string", required: false, order: 76, isSystem: false },
  { name: "мощность", type: "string", required: false, order: 77, isSystem: false },
  { name: "коробка", type: "string", required: false, order: 78, isSystem: false },
  { name: "привод", type: "string", required: false, order: 79, isSystem: false },
  { name: "Эко пользователь", type: "string", required: false, order: 1000, isSystem: true },
];

function toMeta(definition: {
  id: string;
  name: string;
  type: string;
  required: boolean;
  order: number;
  isSystem: boolean;
}): DemandAttributeMeta {
  return {
    id: definition.id,
    name: definition.name,
    type: definition.type,
    required: definition.required,
    order: definition.order,
    isSystem: definition.isSystem,
    meta: {
      href: `local://demand-attribute/${definition.id}`,
      type: "demandattribute",
      mediaType: "application/json",
    },
  };
}

export async function ensureDemandAttributeMetadata(): Promise<
  | { ok: true; attributes: DemandAttributeMeta[] }
  | { ok: false; error: string; attributes: DemandAttributeMeta[] }
> {
  const branchId = getScopedBranchId();
  try {
    for (const attr of DEFAULT_DEMAND_ATTRIBUTES) {
      await prisma.demandAttributeDefinition.upsert({
        where: { branchId_name: { branchId, name: attr.name } },
        update: attr,
        create: { ...attr, branchId },
      });
    }

    const attributes = await prisma.demandAttributeDefinition.findMany({
      orderBy: [{ order: "asc" }, { name: "asc" }],
    });

    return { ok: true, attributes: attributes.map(toMeta) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Не удалось загрузить локальные доп. поля отгрузки",
      attributes: [],
    };
  }
}
