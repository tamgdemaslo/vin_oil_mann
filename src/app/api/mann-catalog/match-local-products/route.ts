import { NextRequest, NextResponse } from "next/server";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { matchMannArticlesToLocalProducts } from "@/lib/mann-catalog";

type Body = {
  mannArticles?: Array<string | { mannArticle?: string; filterType?: string; filterSubtype?: string | null }>;
  organizationId?: string | null;
  warehouseId?: string | null;
};

export async function POST(request: NextRequest) {
  const branch = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!branch.ok) return branch.response;

  const body = (await request.json().catch(() => null)) as Body | null;
  const mannArticles: Array<string | { mannArticle: string; filterType?: string; filterSubtype?: string | null }> = [];
  for (const item of Array.isArray(body?.mannArticles) ? body.mannArticles : []) {
    if (typeof item === "string") {
      if (item.trim()) mannArticles.push(item);
      continue;
    }
    const mannArticle = item.mannArticle?.trim();
    if (mannArticle) mannArticles.push({ mannArticle, filterType: item.filterType, filterSubtype: item.filterSubtype });
  }
  if (mannArticles.length === 0) return NextResponse.json({ error: "Передайте mannArticles[]" }, { status: 400 });

  try {
    const matches = await runWithBranchApiContext(branch.context, () =>
      matchMannArticlesToLocalProducts({
        mannArticles,
        organizationId: body?.organizationId,
        warehouseId: body?.warehouseId,
      })
    );
    return NextResponse.json({ matches });
  } catch (error) {
    console.error("MANN local product matching failed", error);
    return NextResponse.json(
      { error: "Не удалось сопоставить фильтры с локальным каталогом" },
      { status: 500 }
    );
  }
}
