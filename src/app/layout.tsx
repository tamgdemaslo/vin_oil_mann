import type { Metadata } from "next";
import "./globals.css";
import IdleLockGuard from "@/components/IdleLockGuard";
import PlatformShell from "@/components/platform/PlatformShell";

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
        <PlatformShell />
        <IdleLockGuard />
        {children}
      </body>
    </html>
  );
}
