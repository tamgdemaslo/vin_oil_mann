import { NextRequest, NextResponse } from "next/server";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { BankCategoryError, saveBankOperationCategory } from "@/lib/bank-operation-categories";

async function mutate(request: NextRequest, editing = false) {
  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access.response;
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Неверное тело запроса." }, { status: 400 }); }
  return runWithBranchApiContext(access.context, async () => {
    try {
      const result = await saveBankOperationCategory(body, access.context.user, editing);
      return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
    } catch (error) {
      if (error instanceof BankCategoryError) return NextResponse.json({ error: error.message }, { status: error.status });
      console.error("[tbank-category] save failed", { code: error && typeof error === "object" && "code" in error ? String(error.code) : "unknown" });
      return NextResponse.json({ error: "Не удалось сохранить категорию. Повторите попытку." }, { status: 500 });
    }
  });
}

export async function POST(request: NextRequest) { return mutate(request); }

export async function PATCH(request: NextRequest) { return mutate(request, true); }
