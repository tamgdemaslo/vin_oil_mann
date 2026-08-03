import { NextResponse } from "next/server";
import { branchErrorResponse, requireBranchContext } from "@/lib/branch-context";
import { getOwnerDashboard } from "@/lib/owner-dashboard";

export async function GET() {
  try {
    const context = await requireBranchContext({ allowAll: true, requireActive: false });
    if (!context.groupRole) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
    if (context.mode !== "all") return NextResponse.json({ error: "Выберите режим «Все филиалы»" }, { status: 409 });
    return NextResponse.json(await getOwnerDashboard(context));
  } catch (error) {
    const result = branchErrorResponse(error);
    return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
  }
}
