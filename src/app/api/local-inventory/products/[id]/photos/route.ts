import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { invalidateProductFilterOptions } from "@/lib/local-inventory-admin";
import { requireBranchApi } from "@/lib/branch-api";

const MAX_PRODUCT_PHOTOS = 12;
const MAX_PHOTO_SIZE_BYTES = 8 * 1024 * 1024;

function safeFileName(value: unknown) {
  const name = String(value ?? "").trim();
  return name ? name.slice(0, 180) : null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const branchAccess = await requireBranchApi();
  if (!branchAccess.ok) return branchAccess.response;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id не указан" }, { status: 400 });

  const product = await prisma.localProduct.findFirst({
    where: { branchId: branchAccess.context.branchId!, OR: [{ id }, { id: id }] },
    select: { id: true },
  });
  if (!product) return NextResponse.json({ error: "Товар не найден" }, { status: 404 });

  const existingCount = await prisma.localProductPhoto.count({ where: { productId: product.id } });
  if (existingCount >= MAX_PRODUCT_PHOTOS) {
    return NextResponse.json({ error: `Можно прикрепить не больше ${MAX_PRODUCT_PHOTOS} фото` }, { status: 400 });
  }

  const form = await request.formData();
  const files = form.getAll("files").filter((value): value is File => value instanceof File);
  if (files.length === 0) return NextResponse.json({ error: "Выберите фото" }, { status: 400 });
  if (existingCount + files.length > MAX_PRODUCT_PHOTOS) {
    return NextResponse.json({ error: `Можно прикрепить не больше ${MAX_PRODUCT_PHOTOS} фото` }, { status: 400 });
  }

  for (const file of files) {
    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ error: "Можно прикреплять только изображения" }, { status: 400 });
    }
    if (file.size > MAX_PHOTO_SIZE_BYTES) {
      return NextResponse.json({ error: "Размер одного фото не должен превышать 8 МБ" }, { status: 400 });
    }
  }

  const preparedFiles = await Promise.all(
    files.map(async (file) => ({
      data: Buffer.from(await file.arrayBuffer()),
      fileName: safeFileName(file.name),
      contentType: file.type || "image/jpeg",
    }))
  );

  const created = await prisma.$transaction(
    preparedFiles.map((file) =>
      prisma.localProductPhoto.create({
        data: {
          productId: product.id,
          fileName: file.fileName,
          contentType: file.contentType,
          sizeBytes: file.data.byteLength,
          data: file.data,
        },
        select: {
          id: true,
          fileName: true,
          contentType: true,
          sizeBytes: true,
          createdAt: true,
        },
      })
    )
  );

  invalidateProductFilterOptions();

  return NextResponse.json({
    photos: created.map((photo) => ({
      id: photo.id,
      fileName: photo.fileName ?? "",
      contentType: photo.contentType,
      sizeBytes: photo.sizeBytes,
      createdAt: photo.createdAt.toISOString(),
      url: `/api/local-inventory/products/${product.id}/photos/${photo.id}`,
    })),
  });
}
