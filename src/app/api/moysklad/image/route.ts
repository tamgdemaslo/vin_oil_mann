import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { extractMoyskladEntityId } from "@/lib/piecework-rules";
import { getSession } from "@/lib/auth";
import { requireBranchApi } from "@/lib/branch-api";

function isMoySkladHost(host: string): boolean {
  return host === "api.moysklad.ru" || host.endsWith(".moysklad.ru");
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const branchAccess = await requireBranchApi({ requireActive: false });
  if (!branchAccess.ok) return branchAccess.response;
  const href = request.nextUrl.searchParams.get("href")?.trim();
  const productIdParam = request.nextUrl.searchParams.get("productId")?.trim();
  const lookupId = productIdParam || extractMoyskladEntityId(href);

  const product = lookupId
    ? await prisma.localProduct.findFirst({
        where: { branchId: branchAccess.context.branchId!, OR: [{ id: lookupId }, { moyskladId: lookupId }, { imageHref: href || undefined }] },
        include: { photos: { take: 1, orderBy: { createdAt: "desc" } } },
      })
    : href
      ? await prisma.localProduct.findFirst({
          where: { branchId: branchAccess.context.branchId!, imageHref: href },
          include: { photos: { take: 1, orderBy: { createdAt: "desc" } } },
        })
      : null;

  const photo = product?.photos[0];
  if (photo) {
    return new NextResponse(photo.data, {
      headers: {
        "Content-Type": photo.contentType || "image/jpeg",
        "Cache-Control": "private, max-age=3600",
      },
    });
  }

  if (product?.imageHref) {
    try {
      const url = new URL(product.imageHref);
      if (!isMoySkladHost(url.host)) {
        return NextResponse.redirect(url);
      }
    } catch {
      // Fall through to the JSON error below.
    }
  }

  return NextResponse.json({ error: "Изображение не найдено в локальном каталоге" }, { status: 404 });
}
