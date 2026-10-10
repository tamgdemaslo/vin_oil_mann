import { headers } from "next/headers";
import { clientSiteRequestBasePath } from "@/lib/client-site-domain";
import { pageMetadata, SITE_PAGES } from "@/lib/client-site-seo";
import ClientSiteApp from "./ClientSiteApp";
import "./styles.css";

export const metadata = pageMetadata("", SITE_PAGES[""].title, SITE_PAGES[""].description);

export default async function ClientSitePage() {
  const basePath = clientSiteRequestBasePath(await headers());
  return <ClientSiteApp initialPath="/" basePath={basePath} />;
}
