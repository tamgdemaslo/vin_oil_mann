import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { invalidateProductFilterOptions } from "@/lib/local-inventory-admin";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; photoId: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  const { id, photoId } = await params;
  if (!id || !photoId) return NextResponse.json({ error: "id не указан" }, { status: 400 });

  const photo = await prisma.localProductPhoto.findFirst({
    where: {
      id: photoId,
      product: { OR: [{ id }, { moyskladId: id }] },
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

  const { id, photoId } = await params;
  if (!id || !photoId) return NextResponse.json({ error: "id не указан" }, { status: 400 });

  const photo = await prisma.localProductPhoto.findFirst({
    where: {
      id: photoId,
      product: { OR: [{ id }, { moyskladId: id }] },
    },
    select: { id: true },
  });
  if (!photo) return NextResponse.json({ error: "Фото не найдено" }, { status: 404 });

  await prisma.localProductPhoto.delete({ where: { id: photo.id } });
  invalidateProductFilterOptions();

  return NextResponse.json({ ok: true });
}
