import { getRouteTitle } from "@/lib/route-title";
import { headers } from "next/headers";
import { isClientSiteRoot } from "@/lib/client-site-domain";
import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";
import PlatformChrome from "@/components/platform/PlatformChrome";
import { BROWSER_REQUEST_CONTEXT_SCRIPT } from "@/lib/browser-request-context";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  return {
  robots: { index: false, follow: false },
  title: isClientSiteRoot(requestHeaders) ? "Там где масло. — Калининград" : getRouteTitle(requestHeaders.get("x-eco-page-path") ?? "/"),
  description: "Личный кабинет ИП ЕЛИСЕЕНКО ИЛЬЯ СЕРГЕЕВИЧ: отгрузки, касса, выплаты и организации",
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const clientSiteRoot = isClientSiteRoot(await headers());
  return (
    <html lang="ru">
      <body className="antialiased">
        <Script
          id="eco-request-context"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: BROWSER_REQUEST_CONTEXT_SCRIPT }}
        />
        <PlatformChrome clientSiteRoot={clientSiteRoot}>
          {children}
        </PlatformChrome>
      </body>
    </html>
  );
}
