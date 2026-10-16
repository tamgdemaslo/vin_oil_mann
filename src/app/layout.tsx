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
  const requestHeaders = await headers();
  const clientSiteRoot = isClientSiteRoot(requestHeaders);
  const pagePath = requestHeaders.get("x-eco-page-path") ?? "";
  const clientSiteAnalytics = clientSiteRoot || pagePath === "/client-site" || pagePath.startsWith("/client-site/");
  return (
    <html lang="ru">
      <head>
        {clientSiteAnalytics && (
          <script id="yandex-metrika" dangerouslySetInnerHTML={{ __html: `
            (function(m,e,t,r,i,k,a){
                m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
                m[i].l=1*new Date();
                for (var j = 0; j < document.scripts.length; j++) {if (document.scripts[j].src === r) { return; }}
                k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)
            })(window, document,'script','https://mc.yandex.ru/metrika/tag.js?id=113656120', 'ym');
            ym(113656120, 'init', {ssr:true, webvisor:true, clickmap:true, ecommerce:"dataLayer", referrer: document.referrer, url: location.href, accurateTrackBounce:true, trackLinks:true});
          ` }} />
        )}
      </head>
      <body className="antialiased">
        {clientSiteAnalytics && (
          <noscript>
            <div>
              {/* eslint-disable-next-line @next/next/no-img-element -- Metrika fallback must load directly without JavaScript. */}
              <img src="https://mc.yandex.ru/watch/113656120" style={{ position: "absolute", left: "-9999px" }} alt="" />
            </div>
          </noscript>
        )}
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
