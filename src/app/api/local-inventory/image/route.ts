import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireBranchApi } from "@/lib/branch-api";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  if (!(await getSession())) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const access = await requireBranchApi({ requireActive: false }); if (!access.ok) return access.response;
  const id = request.nextUrl.searchParams.get("productId")?.trim();
  if (!id) return NextResponse.json({ error: "Не указан товар" }, { status: 400 });
  const product = await prisma.localProduct.findFirst({ where: { branchId: access.context.branchId!, id }, include: { photos: { take: 1, orderBy: { createdAt: "desc" } } } });
  const photo = product?.photos[0];
  return photo ? new NextResponse(photo.data, { headers: { "Content-Type": photo.contentType || "image/jpeg", "Cache-Control": "private, max-age=3600" } }) : NextResponse.json({ error: "Изображение не найдено в локальном каталоге" }, { status: 404 });
}
