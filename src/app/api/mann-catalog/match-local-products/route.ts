import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { matchMannArticlesToLocalProducts } from "@/lib/mann-catalog";

type Body = {
  mannArticles?: Array<string | { mannArticle?: string; filterType?: string; filterSubtype?: string | null }>;
  organizationId?: string | null;
  warehouseId?: string | null;
};

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

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

  return NextResponse.json({
    matches: await matchMannArticlesToLocalProducts({
      mannArticles,
      organizationId: body?.organizationId,
      warehouseId: body?.warehouseId,
    }),
  });
}
