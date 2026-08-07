import { NextResponse } from "next/server";
import { requireBranchApi } from "@/lib/branch-api";

export async function POST() {
  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access.response;
  if (access.context.user.role !== "owner") {
    return NextResponse.json({ error: "Прямой платёж доступен только владельцу." }, { status: 403 });
  }
  return NextResponse.json(
    { error: "Прямые платежи T-Bank выключены в первом этапе. Используйте создание черновика." },
    { status: 409 }
  );
}
