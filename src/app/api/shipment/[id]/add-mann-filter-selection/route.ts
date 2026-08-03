import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { loadLocalDemandDetailPayload, updateLocalDemand } from "@/lib/local-demand-write";

type Body = {
  selections?: Array<{
    productId?: string;
    mannArticle?: string;
    filterType?: string;
    quantity?: number;
  }>;
};

function localProductMeta(productId: string) {
  return {
    href: `local://product/${productId}`,
    type: "product",
    mediaType: "application/json",
  };
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as Body | null;
  const selections = Array.isArray(body?.selections) ? body.selections.filter((item) => item.productId) : [];
  if (selections.length === 0) return NextResponse.json({ error: "Выберите локальные товары для добавления" }, { status: 400 });

  const demand = await loadLocalDemandDetailPayload(id);
  if (!demand.ok) return NextResponse.json({ error: demand.error }, { status: demand.notFound ? 404 : 400 });
  if (demand.data.header.applicable) {
    return NextResponse.json({ error: "Проведённую отгрузку нельзя редактировать напрямую. Сначала верните документ в черновик." }, { status: 400 });
  }

  const productIds = [...new Set(selections.map((item) => item.productId).filter((value): value is string => Boolean(value)))];
  const products = await prisma.localProduct.findMany({
    where: { id: { in: productIds }, archived: false },
    include: {
      stockBalances: {
        where: demand.data.header.storeId ? { storeId: demand.data.header.storeId } : undefined,
        take: demand.data.header.storeId ? 1 : 5,
      },
    },
  });
  const productById = new Map(products.map((product) => [product.id, product]));
  const nextPositions: Array<{
    id?: string;
    quantity: number;
    price: number;
    discount: number;
    assortment?: { meta: ReturnType<typeof localProductMeta> };
  }> = demand.data.positions.map((position) => ({
    id: position.id,
    quantity: position.quantity,
    price: position.price,
    discount: position.discount ?? 0,
    assortment: position.assortmentMeta ? { meta: position.assortmentMeta } : undefined,
  }));
  const indexByProductId = new Map<string, number>();
  demand.data.positions.forEach((position, index) => {
    const href = position.assortmentMeta?.href ?? "";
    const match = href.match(/^local:\/\/product\/([^/?#]+)/i);
    if (match?.[1]) indexByProductId.set(decodeURIComponent(match[1]), index);
  });

  const skipped: Array<{ productId?: string; reason: string }> = [];
  for (const selection of selections) {
    const productId = selection.productId;
    if (!productId) continue;
    const product = productById.get(productId);
    if (!product) {
      skipped.push({ productId, reason: "Товар не найден в локальном каталоге" });
      continue;
    }
    const quantity = Math.max(1, Number(selection.quantity) || 1);
    const existingIndex = indexByProductId.get(product.id);
    if (existingIndex != null) {
      nextPositions[existingIndex] = {
        ...nextPositions[existingIndex],
        quantity: nextPositions[existingIndex].quantity + quantity,
      };
      continue;
    }
    nextPositions.push({
      quantity,
      price: product.salePriceCents,
      discount: 0,
      assortment: { meta: localProductMeta(product.id) },
    });
    indexByProductId.set(product.id, nextPositions.length - 1);
  }

  const result = await updateLocalDemand(
    id,
    {
      description: demand.data.header.description,
      applicable: false,
      attributes: demand.data.attributes,
      positions: nextPositions,
    },
    session.user
  );
  if (!result.ok) return NextResponse.json({ error: result.error, skipped }, { status: result.notFound ? 404 : 400 });

  return NextResponse.json({ ok: true, added: selections.length - skipped.length, skipped });
}
