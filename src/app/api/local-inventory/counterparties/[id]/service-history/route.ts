import { NextRequest, NextResponse } from "next/server";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { prisma } from "@/lib/db";
import { hasOpenCashShiftAccess } from "@/lib/cash-shift-access";
import { loadCustomerServiceHistory, parseServiceHistoryCursor } from "@/lib/customer-service-history";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access.response;

  const { id } = await params;
  const rawCursor = request.nextUrl.searchParams.get("cursor");
  const cursor = parseServiceHistoryCursor(rawCursor);
  if (rawCursor && !cursor) return NextResponse.json({ error: "Неверная страница истории" }, { status: 400 });

  const { context } = access;
  const result = await runWithBranchApiContext(context, async () => {
    const role = context.user.role;
    const shift = role === "owner" ? null : await prisma.cashShift.findFirst({
      where: { branchId: context.branchId!, status: "open" },
      select: { status: true },
    }).catch(() => null);
    return loadCustomerServiceHistory({
      cardId: id,
      branchId: context.branchId!,
      businessGroupId: context.businessGroupId,
      canOpenActiveBranchDocuments: hasOpenCashShiftAccess(role, shift),
      cursor,
      recentOnly: request.nextUrl.searchParams.get("recent") === "1",
    });
  });
  if (!result) return NextResponse.json({ error: "Контрагент не найден" }, { status: 404 });
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
}
