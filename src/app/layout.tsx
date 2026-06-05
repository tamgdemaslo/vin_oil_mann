import type { Metadata } from "next";
import "./globals.css";
import PlatformShell from "@/components/platform/PlatformShell";
import RouteTitle from "@/components/platform/RouteTitle";

export const metadata: Metadata = {
  title: "Главная | Эко-платформа",
  description: "Эко-платформа автосервиса: отгрузки, касса, выплаты и личный кабинет",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className="antialiased">
        <RouteTitle />
        <PlatformShell />
        {children}
      </body>
    </html>
  );
}
