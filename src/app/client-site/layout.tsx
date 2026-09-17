import type { Metadata } from "next";
import { clientSiteUrl, serializeJsonLd } from "@/lib/client-site-seo";
import "./styles.css";

export const metadata: Metadata = {
  robots: { index: true, follow: true },
  title: "Там где масло. — Калининград",
  description: "Клиентский сайт Там где масло: запись по VIN, каталог масел, кейсы и контакты.",
};

export default function ClientSiteLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd({
      "@context": "https://schema.org", "@type": "AutoRepair", "@id": `${clientSiteUrl()}#business`,
      name: "Там где масло", url: clientSiteUrl(),
      department: [
        { "@type": "AutoRepair", name: "Там где масло — Дачная", telephone: "+79950545859", address: { "@type": "PostalAddress", addressCountry: "RU", addressLocality: "Калининград", streetAddress: "ул. Дачная, 6В" } },
        { "@type": "AutoRepair", name: "Там где масло — Гагарина", telephone: "+79650545858", address: { "@type": "PostalAddress", addressCountry: "RU", addressLocality: "Калининград", streetAddress: "ул. Юрия Гагарина, 116" } },
      ],
    }) }} />
    {children}
  </>;
}
