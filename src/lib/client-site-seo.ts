import type { Metadata } from "next";
import type { PublicOilCard } from "@/lib/public-oil";
import { buildClientProductContent } from "@/lib/client-product-content";

export const CLIENT_SITE_ORIGIN = (process.env.PUBLIC_CLIENT_SITE_ORIGIN || "https://www.tamgdemaslocrm.ru").replace(/\/+$/, "");
export const clientSiteUrl = (path = "") => `${CLIENT_SITE_ORIGIN}/client-site${path}`;
export const SITE_PAGES: Record<string, { title: string; description: string }> = {
  "": { title: "Замена масла в Калининграде — Там где масло", description: "Замена моторного и трансмиссионного масла в Калининграде. Каталог масел, цены, примеры работ и запись. Дачная, 6В и Юрия Гагарина, 116." },
  shop: { title: "Моторные масла в Калининграде — каталог и цены | Там где масло", description: "Каталог моторных масел: выбор по бренду, вязкости и OEM-спецификациям. Характеристики, фасовки, цены и наличие по филиалам в Калининграде." },
  services: { title: "Замена масла и технических жидкостей — цены в Калининграде", description: "Услуги сервиса «Там где масло»: замена моторного масла и жидкостей трансмиссии. Стоимость работ и запись в филиалы Калининграда." },
  contacts: { title: "Контакты «Там где масло» — адреса и телефоны в Калининграде", description: "Адреса, телефоны и режим работы: Дачная, 6В и Юрия Гагарина, 116. Карта проезда и запись на обслуживание автомобиля." },
  cases: { title: "Примеры замены масла и обслуживания трансмиссий | Там где масло", description: "Выполненные работы сервиса в Калининграде: замена масла в АКПП, DSG, раздатке и редукторах. Фотографии, материалы и этапы обслуживания." },
  team: { title: "Команда сервиса «Там где масло» в Калининграде", description: "Мастера и команда сервиса «Там где масло». Познакомьтесь со специалистами перед записью на обслуживание автомобиля." },
};
export function pageMetadata(path: string, title: string, description: string, image?: string): Metadata {
  const url = clientSiteUrl(path);
  return { title: { absolute: title }, description, alternates: { canonical: url }, robots: { index: true, follow: true },
    openGraph: { type: "website", locale: "ru_RU", siteName: "Там где масло", title, description, url, ...(image ? { images: [new URL(image, CLIENT_SITE_ORIGIN).href] } : {}) },
    twitter: { card: image ? "summary_large_image" : "summary", title, description } };
}
export function productMetadata(card: PublicOilCard) {
  const content = buildClientProductContent(card);
  return pageMetadata(`/product/${card.id}`, content.title, content.metaDescription, card.imageHref);
}
export function productStructuredData(card: PublicOilCard) {
  const content = buildClientProductContent(card);
  const url = clientSiteUrl(`/product/${card.id}`);
  const offers = card.offers.filter(offer => offer.price != null && offer.price > 0 && ["IN_STOCK", "OUT_OF_STOCK"].includes(offer.availability));
  return { "@context": "https://schema.org", "@type": "Product", "@id": `${url}#product`, url, name: content.name, description: content.description,
    ...(card.article ? { sku: card.article } : {}),
    ...(card.brand ? { brand: { "@type": "Brand", name: card.brand } } : {}),
    ...(card.imageHref ? { image: [new URL(card.imageHref, CLIENT_SITE_ORIGIN).href] } : {}),
    ...(offers.length ? { offers: offers.map(offer => ({ "@type": "Offer", url, price: offer.price, priceCurrency: "RUB",
      availability: `https://schema.org/${offer.availability === "IN_STOCK" ? "InStock" : "OutOfStock"}`,
      seller: { "@type": "AutoRepair", name: `Там где масло — ${offer.name}`, ...(offer.address ? { address: offer.address } : {}), ...(offer.phone ? { telephone: offer.phone } : {}) },
    })) } : {}) };
}
export function breadcrumbs(name: string, path: string) {
  return { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
    { "@type": "ListItem", position: 1, name: "Там где масло", item: clientSiteUrl() },
    { "@type": "ListItem", position: 2, name: "Каталог масел", item: clientSiteUrl("/shop") },
    { "@type": "ListItem", position: 3, name, item: clientSiteUrl(path) },
  ] };
}
export function serializeJsonLd(value: unknown) { return JSON.stringify(value).replace(/</g, "\\u003c"); }
