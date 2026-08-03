import type { Metadata } from "next";
import ClientSiteApp from "./ClientSiteApp";
import "./styles.css";

export const metadata: Metadata = {
  title: "Там где масло. — Калининград, Московский пр. 244",
  description: "Клиентский сайт Там где масло: запись по VIN, каталог масел, кейсы и контакты.",
};

export default function ClientSitePage() {
  return <ClientSiteApp />;
}
