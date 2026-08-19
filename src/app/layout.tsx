import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";
import { MessengerProvider } from "@/components/messenger/MessengerProvider";
import { MessengerWidget } from "@/components/messenger/MessengerUi";
import PlatformShell from "@/components/platform/PlatformShell";
import RouteTitle from "@/components/platform/RouteTitle";
import { BROWSER_REQUEST_CONTEXT_SCRIPT } from "@/lib/browser-request-context";

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
        <Script
          id="eco-request-context"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: BROWSER_REQUEST_CONTEXT_SCRIPT }}
        />
        <MessengerProvider>
          <RouteTitle />
          <PlatformShell />
          {children}
          <MessengerWidget />
        </MessengerProvider>
      </body>
    </html>
  );
}
