import type { Metadata } from "next";
import ClientSiteApp from "./ClientSiteApp";
import "./styles.css";

export const metadata: Metadata = {
  title: "Там где масло. — Дачная 6В и Юрия Гагарина 116",
  description: "Замена моторного и трансмиссионного масла в Калининграде: услуги, цены, запись и контакты двух филиалов.",
};

export default function ClientSitePage() {
  return <ClientSiteApp initialPath={null} />;
}
