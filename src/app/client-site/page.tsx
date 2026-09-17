import { pageMetadata, SITE_PAGES } from "@/lib/client-site-seo";
import ClientSiteApp from "./ClientSiteApp";
import "./styles.css";

export const metadata = pageMetadata("", SITE_PAGES[""].title, SITE_PAGES[""].description);

export default function ClientSitePage() {
  return <ClientSiteApp initialPath="/" />;
}
