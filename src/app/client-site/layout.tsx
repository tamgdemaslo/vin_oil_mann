import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "Там где масло. — Калининград",
  description: "Клиентский сайт Там где масло: запись по VIN, каталог масел, кейсы и контакты.",
};

export default function ClientSiteLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
