import type { Metadata, Viewport } from "next";
import "./globals.css";
import { MessengerProvider } from "@/components/messenger/MessengerProvider";
import PlatformShell from "@/components/platform/PlatformShell";
import RouteTitle from "@/components/platform/RouteTitle";

export const metadata: Metadata = {
  title: "Главная | ИП ЕЛИСЕЕНКО ИЛЬЯ СЕРГЕЕВИЧ",
  description: "Личный кабинет ИП ЕЛИСЕЕНКО ИЛЬЯ СЕРГЕЕВИЧ: отгрузки, касса, выплаты и организации",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className="antialiased">
        <MessengerProvider>
          <RouteTitle />
          <PlatformShell />
          {children}
        </MessengerProvider>
      </body>
    </html>
  );
}
