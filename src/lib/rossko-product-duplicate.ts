import { Prisma } from "@prisma/client";
import { normalizePartNumberForCrossMatch } from "@/lib/part-number-cross-reference";
import { normalizeProductIdentityArticle, normalizeProductIdentityBrand } from "@/lib/product-identity";

export type RosskoDuplicateProduct = {
  id: string; name: string; article: string | null; brand: string | null;
  rosskoPartNumber?: string | null; rosskoBrand?: string | null;
};

export function isRosskoArticleDuplicate(product: RosskoDuplicateProduct, input: { article: string; brand: string }): boolean {
  const article = normalizeProductIdentityArticle(input.article);
  const brand = normalizeProductIdentityBrand(input.brand);
  if (!article) return false;
  const matches = (candidateArticle: unknown, candidateBrand: unknown) => {
    const candidateBrandKey = normalizeProductIdentityBrand(candidateBrand);
    return normalizeProductIdentityArticle(candidateArticle) === article &&
      (!brand || !candidateBrandKey || brand === candidateBrandKey);
  };
  return matches(product.article, product.brand) || matches(product.rosskoPartNumber, product.rosskoBrand || product.brand);
}

export async function findRosskoArticleDuplicate(
  client: Pick<Prisma.TransactionClient, "$queryRaw">,
  input: { branchId: string; article: string; brand: string },
) {
  const compact = normalizePartNumberForCrossMatch(input.article).compactCandidate.toLocaleLowerCase("ru-RU");
  if (!compact) return null;
  const products = await client.$queryRaw<RosskoDuplicateProduct[]>(Prisma.sql`
    SELECT id, name, article, brand, rossko_part_number AS "rosskoPartNumber", rossko_brand AS "rosskoBrand"
    FROM local_products
    WHERE branch_id = ${input.branchId} AND archived = false AND entity_type <> 'service'
      AND (
        regexp_replace(lower(COALESCE(article, '')), '[^0-9a-zа-я]', '', 'g') = ${compact}
        OR regexp_replace(lower(COALESCE(rossko_part_number, '')), '[^0-9a-zа-я]', '', 'g') = ${compact}
      )
    ORDER BY created_at, id
  `);
  return products.find((product) => isRosskoArticleDuplicate(product, input)) ?? null;
}

export async function lockRosskoArticleCreation(tx: Pick<Prisma.TransactionClient, "$queryRaw">, branchId: string, article: string) {
  const compact = normalizePartNumberForCrossMatch(article).compactCandidate;
  await tx.$queryRaw(Prisma.sql`
    SELECT pg_advisory_xact_lock(hashtextextended(${`product-article:${branchId}:${compact}`}, 0))::text AS locked
  `);
}

export function rosskoDuplicateResponse(product: RosskoDuplicateProduct) {
  return { ok: false as const, code: "ROSSKO_PRODUCT_EXISTS", error: `Товар с таким артикулом уже есть в текущем филиале: ${product.name}`, existingProduct: { id: product.id, name: product.name } };
}
