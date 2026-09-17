import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";
import PlatformChrome from "@/components/platform/PlatformChrome";
import { BROWSER_REQUEST_CONTEXT_SCRIPT } from "@/lib/browser-request-context";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
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
        <PlatformChrome>
          {children}
        </PlatformChrome>
      </body>
    </html>
  );
}
