import type { MetadataRoute } from "next";
import { CLIENT_SITE_ORIGIN } from "@/lib/client-site-seo";
import { headers } from "next/headers";
import { isClientSiteRoot } from "@/lib/client-site-domain";

export const dynamic = "force-dynamic";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const root = isClientSiteRoot(await headers());
  return {
    rules: root
      ? { userAgent: "*", allow: ["/", "/_next/", "/api/public/oils/"], disallow: ["/api/", "/account", "/vin", "/booking/manage/"] }
      : { userAgent: "*", disallow: ["/", "/client-site/account", "/client-site/vin"], allow: ["/client-site", "/_next/", "/api/public/oils/", "/team/", "/cases/", "/products/", "/assets/"] },
    sitemap: `${CLIENT_SITE_ORIGIN}/sitemap.xml`,
  };
}
