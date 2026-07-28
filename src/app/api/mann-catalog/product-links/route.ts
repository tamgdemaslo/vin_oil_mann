import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { normalizeMannArticle } from "@/lib/mann-catalog";
import { getScopedBranchId } from "@/lib/request-tenant-store";

type Body = {
  productId?: string;
  mannArticle?: string;
  organizationId?: string | null;
  linkType?: string;
  confidence?: number;
};

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Body | null;
  const productId = body?.productId?.trim() ?? "";
  const mannArticle = body?.mannArticle?.trim() ?? "";
  const mannArticleNormalized = normalizeMannArticle(mannArticle);
  if (!productId || !mannArticleNormalized) {
    return NextResponse.json({ error: "Укажите productId и mannArticle" }, { status: 400 });
  }

  const product = await prisma.localProduct.findUnique({ where: { id: productId }, select: { id: true } });
  if (!product) return NextResponse.json({ error: "Товар не найден" }, { status: 404 });

  const organizationId = body?.organizationId?.trim() || "default";
  const link = await prisma.productMannLink.upsert({
    where: {
      branchId_organizationId_productId_mannArticleNormalized: {
        branchId: getScopedBranchId(),
        organizationId,
        productId,
        mannArticleNormalized,
      },
    },
    create: {
      organizationId,
      productId,
      mannArticle,
      mannArticleNormalized,
      linkType: body?.linkType?.trim() || "manual",
      confidence: Math.max(1, Math.min(100, Number(body?.confidence) || 100)),
      createdById: session.user.login,
    },
    update: {
      mannArticle,
      linkType: body?.linkType?.trim() || "manual",
      confidence: Math.max(1, Math.min(100, Number(body?.confidence) || 100)),
      createdById: session.user.login,
    },
  });

  return NextResponse.json({ ok: true, link });
}
