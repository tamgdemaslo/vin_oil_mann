import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { prisma } from "@/lib/db";
import { MAINTENANCE_STOCK_FLUID_SYSTEMS } from "@/lib/maintenance-fluid-stock";
import { loadMaintenanceFluidReferences, loadMaintenanceFluidRosskoOffers } from "@/lib/maintenance-fluid-rossko";
import { rosskoIntegrationError } from "@/lib/rossko-integration";
const schema = z.object({ mode: z.enum(["references", "offers"]), storeId: z.string().trim().min(1).max(160), systemCode: z.enum(MAINTENANCE_STOCK_FLUID_SYSTEMS), specifications: z.array(z.string().trim().min(1).max(2000)).min(1).max(20), viscosity: z.string().trim().max(120).optional(), productId: z.string().trim().min(1).max(160).optional() }).strict().refine(value => value.mode !== "offers" || Boolean(value.productId));
export async function POST(request: NextRequest) {
  if (!await getSession()) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const branch = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!branch.ok) return branch.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Укажите склад, требования жидкости и выбранную цифровую карточку." }, { status: 400 });
  try { return await runWithBranchApiContext(branch.context, async () => {
    const branchId = branch.context.branchId!, organizationId = branch.context.organizationId!;
    const { mode, productId, ...input } = parsed.data;
    const store = await prisma.localStore.findFirst({ where: { id: input.storeId, branchId }, select: { id: true } });
    if (!store) return NextResponse.json({ error: "Склад недоступен" }, { status: 404 });
    const result = mode === "references" ? await loadMaintenanceFluidReferences({ ...input, branchId })
      : await loadMaintenanceFluidRosskoOffers({ ...input, branchId, organizationId, productId: productId!, timeZone: branch.context.branch?.timezone ?? "Europe/Kaliningrad" });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  }); } catch (error) {
    const safe = rosskoIntegrationError(error, "search");
    return NextResponse.json(safe, { status: safe.code === "ROSSKO_NOT_CONFIGURED" ? 409 : 502 });
  }
}
