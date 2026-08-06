import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { invalidateProductFilterOptions } from "@/lib/local-inventory-admin";
import { requireBranchApi } from "@/lib/branch-api";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; photoId: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const branchAccess = await requireBranchApi({ requireActive: false });
  if (!branchAccess.ok) return branchAccess.response;

  const { id, photoId } = await params;
  if (!id || !photoId) return NextResponse.json({ error: "id не указан" }, { status: 400 });

  const photo = await prisma.localProductPhoto.findFirst({
    where: {
      id: photoId,
      product: { branchId: branchAccess.context.branchId!, OR: [{ id }, { id: id }] },
    },
    select: {
      data: true,
      contentType: true,
    },
  });
  if (!photo) return NextResponse.json({ error: "Фото не найдено" }, { status: 404 });

  return new NextResponse(photo.data, {
    headers: {
      "Content-Type": photo.contentType,
      "Cache-Control": "private, max-age=3600",
    },
  });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; photoId: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const branchAccess = await requireBranchApi();
  if (!branchAccess.ok) return branchAccess.response;

  const { id, photoId } = await params;
  if (!id || !photoId) return NextResponse.json({ error: "id не указан" }, { status: 400 });

  const photo = await prisma.localProductPhoto.findFirst({
    where: {
      id: photoId,
      product: { branchId: branchAccess.context.branchId!, OR: [{ id }, { id: id }] },
    },
    select: { id: true },
  });
  if (!photo) return NextResponse.json({ error: "Фото не найдено" }, { status: 404 });

  await prisma.localProductPhoto.delete({ where: { id: photo.id } });
  invalidateProductFilterOptions();

  return NextResponse.json({ ok: true });
}
