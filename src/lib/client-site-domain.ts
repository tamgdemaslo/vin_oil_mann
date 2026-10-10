// Domain routing is opt-in. The current CRM deployment keeps its routes until
// the public host is configured or a dedicated client application is enabled.
export function clientSiteOnly() {
  return process.env.CLIENT_SITE_ONLY === "true";
}

export function clientSiteCanonicalBasePath() {
  const value = process.env.PUBLIC_CLIENT_SITE_BASE_PATH;
  return value === "" || value === "/" ? "" : "/client-site";
}

export function isClientSiteRoot(headers: Pick<Headers, "get">) {
  if (clientSiteOnly()) return true;
  const configured = (process.env.PUBLIC_CLIENT_SITE_HOSTS ?? "")
    .split(",").map(host => host.trim().toLowerCase()).filter(Boolean);
  return [headers.get("host"), headers.get("x-forwarded-host")].some(value => {
    const supplied = (value ?? "").split(",")[0].trim().toLowerCase().replace(/:\d+$/, "");
    return configured.includes(supplied);
  });
}

export function clientSitePublicBackend(pathname: string) {
  const origin = process.env.PUBLIC_CLIENT_VIN_ORIGIN;
  const delegated = ["/api/vin/lookup", "/api/vin/recommendations", "/api/vin/raw-lookup", "/api/public/vin-oil"].includes(pathname)
    || /^\/api\/public\/booking(?:\/|$)/.test(pathname);
  if (!clientSiteOnly() || !origin || !delegated) return null;
  const url = new URL(origin);
  if (url.protocol !== "https:") throw new Error("PUBLIC_CLIENT_VIN_ORIGIN must use HTTPS");
  url.pathname = pathname;
  return url;
}

export function clientSiteRequestBasePath(headers: Pick<Headers, "get">) {
  return isClientSiteRoot(headers) ? "" : "/client-site";
}

export function clientSiteLegacyRedirectEnabled() {
  return process.env.PUBLIC_CLIENT_SITE_REDIRECT_LEGACY === "true";
}

const READ_ONLY = new Set(["GET", "HEAD", "OPTIONS"]);
const PUBLIC_METHODS = new Set(["GET", "HEAD", "POST", "OPTIONS"]);

export function isClientSitePublicPath(pathname: string, method: string) {
  if (READ_ONLY.has(method)) {
    if (["/robots.txt", "/sitemap.xml", "/favicon.ico", "/api/health/live", "/api/health/ready", "/api/stats", "/api/services", "/api/cases", "/api/account/demo", "/api/oils", "/api/oils/filters", "/api/appointments/slots"].includes(pathname)) return true;
    if (/^\/api\/(?:oils|cases)\/[^/]+$/.test(pathname)) return true;
    if (pathname === "/booking" || /^\/booking\/manage\/[^/]+$/.test(pathname)) return true;
    if (pathname.startsWith("/_next/static/") || pathname === "/_next/image") return true;
    if (/^\/(?:assets|products|cases|team|brand|fonts)\/.+\.(?:avif|webp|png|jpe?g|gif|svg|woff2?|mp4|css)$/i.test(pathname)) return true;
  }
  if (!PUBLIC_METHODS.has(method)) return false;
  if (["/api/public/stats", "/api/public/vin-oil", "/api/public/leads", "/api/public/oils", "/api/public/oils/filters", "/api/public/booking"].includes(pathname)) return true;
  if (/^\/api\/public\/oils\/[^/]+(?:\/image\/[^/]+)?$/.test(pathname)) return true;
  if (/^\/api\/public\/booking\/(?:status|nearest|branches|services|availability|customer-lookup)$/.test(pathname)) return true;
  if (/^\/api\/public\/booking\/manage\/[^/]+(?:\/(?:telegram-link|cancel|reschedule|availability))?$/.test(pathname)) return true;
  return method === "POST" && ["/api/vin/lookup", "/api/vin/recommendations", "/api/vin/raw-lookup"].includes(pathname);
}

export function clientSitePagePath(pathname: string) {
  if (pathname === "/") return "/client-site";
  if (/^\/(?:shop|services|contacts|cases|team|privacy|offer|vin|account)\/?$/.test(pathname) || /^\/(?:product|case)\/[^/]+\/?$/.test(pathname)) return `/client-site${pathname}`;
  return null;
}

// Published Tilda URLs retained when switching the domain to the new site.
export const CLIENT_SITE_OLD_PATHS: Record<string, string> = {
  "/catalog": "/shop",
  "/zamena_masla": "/services",
  "/zamena_masla_kaliningrad": "/services",
  "/zamena_masla_skoda": "/case/skoda-karoq-aisin-aq300",
  "/skoda": "/case/skoda-karoq-aisin-aq300",
  "/zamena_masla_toyota": "/case/toyota-camry-70-u760",
  "/zamena_masla_audi": "/case/audi-a8-zf-09l",
  "/bmwg30": "/case/bmw-x5-f15-zf8hp",
};
