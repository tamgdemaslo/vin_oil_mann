import type { MetadataRoute } from "next";
import { prisma } from "@/lib/db";
import { resolvePublicStorefront } from "@/lib/public-storefront";
import { clientSiteUrl, SITE_PAGES } from "@/lib/client-site-seo";
import siteData from "@/lib/client-site-data.json";

export const dynamic = "force-dynamic";
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const storefront = await resolvePublicStorefront();
  const products = await prisma.storefrontProduct.findMany({
    where: { storefrontId: storefront.id, publicationState: "PUBLISHED" },
    select: { id: true }, orderBy: { id: "asc" },
  });
  return [
    ...Object.keys(SITE_PAGES).map(path => ({ url: clientSiteUrl(path ? `/${path}` : "") })),
    ...siteData.CASES.map(item => ({ url: clientSiteUrl(`/case/${item.id}`) })),
    ...products.map(item => ({ url: clientSiteUrl(`/product/${item.id}`) })),
  ];
}
