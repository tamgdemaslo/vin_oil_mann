import { MOYSKLAD_BASE, moyskladFetch, type MoySkladMeta } from "@/lib/moysklad";

type ProductRow = {
  id: string;
  name: string;
  article?: string;
  salePrices?: { value: number; currency?: { name?: string } }[];
  meta?: { href: string };
};

/** Первый товар по поиску с ценой продажи (копейки → рубли). */
export async function findFirstProductBySearchHint(
  hint: string
): Promise<{ id: string; name: string; priceRub: number; meta: MoySkladMeta } | null> {
  const q = hint.trim();
  if (q.length < 2) return null;
  const res = await moyskladFetch<{ rows?: ProductRow[] }>(
    `/entity/product?search=${encodeURIComponent(q)}&limit=5&expand=`
  );
  if (!res.ok || !res.data.rows?.length) return null;
  for (const row of res.data.rows) {
    const priceCents = row.salePrices?.[0]?.value ?? 0;
    if (!row.meta?.href) continue;
    return {
      id: row.id,
      name: row.name,
      priceRub: priceCents / 100,
      meta: {
        href: row.meta.href,
        type: "product",
        mediaType: "application/json",
      },
    };
  }
  return null;
}

export function productMetaFromId(id: string): MoySkladMeta {
  return {
    href: `${MOYSKLAD_BASE}/entity/product/${id}`,
    type: "product",
    mediaType: "application/json",
  };
}

/** Для вариантов оффера: перебор подсказок, первая найденная позиция. */
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
