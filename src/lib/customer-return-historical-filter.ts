import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getScopedBranchId } from "@/lib/request-tenant-store";
import { mannProductBrandEvidence } from "@/lib/mann-catalog";
import { buildPartNumberCollisionIndex, isSafeCompactKey, normalizePartNumberForCrossMatch, parseOemParts } from "@/lib/part-number-cross-reference";

type SourceProduct={id:string;name:string;brand?:string|null;article?:string|null;code?:string|null;oemParts?:string|null};
type CatalogueArticle={article:string;normalized:string;filterType:string};

/** Resolve the already fitted filter, not the vehicle/engine. Never calls a provider or writes. */
export async function resolveHistoricalFilterMannArticles(input:{product?:SourceProduct;historicalName:string;organizationId:string}):Promise<string[]> {
  const branchId=getScopedBranchId();
  const p=input.product;
  const links=p?await prisma.productMannLink.findMany({where:{branchId,organizationId:input.organizationId,productId:p.id},select:{mannArticleNormalized:true}}):[];
  const references=[
    ...(p&&mannProductBrandEvidence(p)?[p.article||p.code||""]:[]),
    ...parseOemParts(p?.oemParts).filter(ref=>!ref.brand||ref.brand==="MANN").map(ref=>ref.articleRaw),
    ...links.map(link=>link.mannArticleNormalized),
    // Parenthetical crosses are explicit service-history data, not a fuzzy
    // extraction of arbitrary numbers from the product name.
    ...[input.historicalName,p?.name??""].flatMap(name=>[...name.matchAll(/\(([^()]*)\)/g)].flatMap(m=>m[1].split(/[,;|]/))),
  ].map(normalizePartNumberForCrossMatch).filter(ref=>ref.canonical.length>=3&&/\d/.test(ref.canonical));
  const compact=[...new Set(references.map(ref=>ref.compactCandidate))];
  if(!compact.length)return [];
  // Read all colliding catalogue identities, including other filter types,
  // before allowing a compact (slash-less) reference to identify an oil SKU.
  const rows=await prisma.$queryRaw<CatalogueArticle[]>(Prisma.sql`
    SELECT DISTINCT mann_article AS article,mann_article_normalized AS normalized,filter_type AS "filterType"
    FROM mann_filter_applications
    WHERE regexp_replace(upper(mann_article_normalized),'[^A-Z0-9]','','g') IN (${Prisma.join(compact)})
  `);
  const collisionIndex=buildPartNumberCollisionIndex(rows.map(row=>row.article));
  return [...new Set(rows.filter(row=>/^(oil|oil-filter)$/i.test(row.filterType)&&references.some(ref=>{
    const article=normalizePartNumberForCrossMatch(row.article);
    return article.canonical===ref.canonical || article.compactCandidate===ref.compactCandidate&&isSafeCompactKey(collisionIndex,ref.compactCandidate);
  })).map(row=>row.normalized))].sort();
}
