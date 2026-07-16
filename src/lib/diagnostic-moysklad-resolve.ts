import { prisma } from "@/lib/db";

export type LocalProductMeta = {
  href: string;
  type: string;
  mediaType: string;
};

function productMeta(id: string): LocalProductMeta {
  return { href: `local://product/${id}`, type: "product", mediaType: "application/json" };
}

/** Первый локальный товар по поисковой подсказке с ценой продажи в рублях. */
export async function findFirstProductBySearchHint(
  hint: string
): Promise<{ id: string; name: string; priceRub: number; meta: LocalProductMeta } | null> {
  const q = hint.trim();
  if (q.length < 2) return null;

  const product = await prisma.localProduct.findFirst({
    where: {
      archived: false,
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { article: { contains: q, mode: "insensitive" } },
        { code: { contains: q, mode: "insensitive" } },
        { searchText: { contains: q.toLowerCase(), mode: "insensitive" } },
        { oem: { contains: q, mode: "insensitive" } },
        { oemParts: { contains: q, mode: "insensitive" } },
        { params: { contains: q, mode: "insensitive" } },
      ],
    },
    orderBy: [{ salePriceCents: "desc" }],
  });

  if (!product) return null;
  return {
    id: product.id,
    name: product.name,
    priceRub: product.salePriceCents / 100,
    meta: productMeta(product.id),
  };
}

export function productMetaFromId(id: string): LocalProductMeta {
  return productMeta(id);
}

/** Для вариантов оффера: перебор подсказок, первая найденная локальная позиция. */
export async function enrichVariantWithMoySklad(
  hints: string[] | undefined
): Promise<{ moySkladProductId?: string; priceRub?: number; name?: string }> {
  if (!hints?.length) return {};
  for (const h of hints) {
    const p = await findFirstProductBySearchHint(h);
    if (p) {
      return { moySkladProductId: p.id, priceRub: p.priceRub, name: p.name };
    }
  }
  return {};
}
