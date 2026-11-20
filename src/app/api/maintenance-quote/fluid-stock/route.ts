import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { prisma } from "@/lib/db";
import { loadMaintenanceFluidStock, MAINTENANCE_STOCK_FLUID_SYSTEMS } from "@/lib/maintenance-fluid-stock";

const schema = z.object({
  storeId: z.string().trim().min(1).max(160),
  systemCode: z.enum(MAINTENANCE_STOCK_FLUID_SYSTEMS),
  specifications: z.array(z.string().trim().min(1).max(2000)).min(1).max(20),
  viscosity: z.string().trim().max(120).optional(),
}).strict();

export async function POST(request: NextRequest) {
  if (!await getSession()) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Укажите склад и точные требования жидкости агрегата" }, { status: 400 });
  try {
    return await runWithBranchApiContext(access.context, async () => {
      const branchId = access.context.branchId!;
      const { storeId, systemCode, specifications, viscosity } = parsed.data;
      const store = await prisma.localStore.findFirst({ where: { id: storeId, branchId }, select: { id: true } });
      if (!store) return NextResponse.json({ error: "Склад недоступен" }, { status: 404 });
      return NextResponse.json(await loadMaintenanceFluidStock({ branchId, storeId, systemCode, specifications, viscosity }), { headers: { "Cache-Control": "no-store" } });
    });
  } catch {
    return NextResponse.json({ error: "Не удалось проверить товары для выбранной жидкости. Повторите поиск." }, { status: 500 });
  }
}
