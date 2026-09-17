import { cache } from "react";
import { notFound, permanentRedirect } from "next/navigation";
import type { Metadata } from "next";
import { getClientCatalogForPage, publicOilToClientOil } from "@/lib/client-site-api";
import { getPublicOilById } from "@/lib/public-oil";
import { breadcrumbs, pageMetadata, productMetadata, productStructuredData, serializeJsonLd, SITE_PAGES } from "@/lib/client-site-seo";
import siteData from "@/lib/client-site-data.json";
import ClientSiteApp from "../ClientSiteApp";

export const dynamic = "force-dynamic";
const product = cache(getPublicOilById);
type Props = { params: Promise<{ segments: string[] }> };

async function resolvePage(segments: string[]) {
  const [section, id] = segments;
  if (section === "product" && segments.length === 2) {
    const card = await product(id);
    if (!card) notFound();
    if (card.id !== id) permanentRedirect(`/client-site/product/${card.id}`);
    return { card, title: card.name, description: card.description || "" };
  }
  if (section === "case" && segments.length === 2) {
    const item = siteData.CASES.find(item => item.id === id);
    if (!item) notFound();
    return { title: `${item.title} | Там где масло`, description: item.summary || item.title };
  }
  if (segments.length === 1 && SITE_PAGES[section]) return SITE_PAGES[section];
  if (segments.length === 1 && ["privacy", "offer", "vin", "account"].includes(section)) return { title: "Там где масло", description: "Информация сервиса «Там где масло»", noindex: true };
  notFound();
}
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { segments } = await params;
  const info = await resolvePage(segments);
  if ("card" in info && info.card) return productMetadata(info.card);
  return { ...pageMetadata(`/${segments.join("/")}`, info.title, info.description), ...("noindex" in info ? { robots: { index: false, follow: true } } : {}) };
}
export default async function ClientSiteRoute({ params }: Props) {
  const { segments } = await params;
  const info = await resolvePage(segments);
  const card = "card" in info ? info.card : undefined;
  const oils = card ? [publicOilToClientOil(card)] : segments[0] === "shop" ? await getClientCatalogForPage() : [];
  return <>
    {card ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd([
      productStructuredData(card), breadcrumbs(card.name, `/product/${card.id}`),
    ]) }} /> : null}
    <ClientSiteApp initialPath={`/${segments.join("/")}`} initialOils={oils} />
  </>;
}
