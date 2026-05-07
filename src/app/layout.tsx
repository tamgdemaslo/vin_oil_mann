import type { Metadata } from "next";
import "./globals.css";
import AppHeader from "@/components/AppHeader";
import IdleLockGuard from "@/components/IdleLockGuard";

export const metadata: Metadata = {
  title: "Эко-платформа — продажи и деньги",
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
        <AppHeader />
        <IdleLockGuard />
        {children}
      </body>
    </html>
  );
}
