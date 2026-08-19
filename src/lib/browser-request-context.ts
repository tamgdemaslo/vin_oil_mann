export const BROWSER_REQUEST_CONTEXT_SCRIPT = String.raw`
(() => {
  try {
    if (window.__ecoRequestContextInstalled) return;
    window.__ecoRequestContextInstalled = true;

    const originalFetch = window.fetch.bind(window);
    const storageKey = "eco-request-tab-id";
    let tabId = null;
    try {
      tabId = window.sessionStorage.getItem(storageKey);
    } catch {}
    if (!tabId || !/^[a-zA-Z0-9_-]{8,80}$/.test(tabId)) {
      tabId = typeof window.crypto?.randomUUID === "function"
        ? window.crypto.randomUUID()
        : Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
      try {
        window.sessionStorage.setItem(storageKey, tabId);
      } catch {}
    }

    window.fetch = function ecoRequestContextFetch(input, init) {
      try {
        const requestUrl = new URL(
          input instanceof Request ? input.url : input instanceof URL ? input.href : String(input),
          window.location.href
        );
        if (requestUrl.origin === window.location.origin) {
          const headers = new Headers(input instanceof Request ? input.headers : undefined);
          if (init?.headers) {
            new Headers(init.headers).forEach((value, key) => headers.set(key, value));
          }
          headers.set("X-Eco-Tab-Id", tabId);
          headers.set("X-Eco-Page-Visibility", document.visibilityState);
          if (input instanceof Request) {
            return originalFetch(new Request(input, { ...init, headers }));
          }
          return originalFetch(input, { ...init, headers });
        }
      } catch {}
      return originalFetch(input, init);
    };
  } catch {}
})();
`;
