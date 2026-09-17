import type { MetadataRoute } from "next";
import { CLIENT_SITE_ORIGIN } from "@/lib/client-site-seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", disallow: ["/", "/client-site/account", "/client-site/vin"], allow: ["/client-site", "/_next/", "/api/public/oils/", "/team/", "/cases/", "/products/", "/assets/"] },
    sitemap: `${CLIENT_SITE_ORIGIN}/sitemap.xml`,
  };
}
