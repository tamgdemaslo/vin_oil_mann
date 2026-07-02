const forbiddenOutboundPatterns: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /закуп|закупочн/i, reason: "закупочные данные" },
  { pattern: /себестоим/i, reason: "себестоимость" },
  { pattern: /марж|margin/i, reason: "маржа" },
  { pattern: /internal\s*comment|master\s*comment|комментар(ий|ии)\s+мастер/i, reason: "внутренний комментарий" },
  { pattern: /внутренн(ий|ие|яя|яя)\s+комментар/i, reason: "внутренний комментарий" },
];

const internalPathPrefixes = [
  "/api/",
  "/cabinet",
  "/crm",
  "/diagnostic",
  "/diagnostics",
  "/inventory",
  "/operations",
  "/finance",
  "/settings",
  "/admin",
  "/messages",
  "/clients",
  "/records",
  "/salary",
];

function isPrivateHostname(hostname: string) {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (host === "127.0.0.1" || host === "::1" || host.startsWith("127.")) return true;
  if (host.startsWith("10.")) return true;
  if (host.startsWith("192.168.")) return true;
  const match = host.match(/^172\.(\d+)\./);
  if (match) {
    const second = Number(match[1]);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

function linkTokens(text: string) {
  const tokens = text.match(/https?:\/\/[^\s<>"')]+|\/[A-Za-zА-Яа-я0-9._~:/?#\[\]@!$&*+,;=%-]+/g);
  return tokens ?? [];
}

function assertSafeLink(token: string) {
  if (token.startsWith("/")) {
    if (token.startsWith("/report/")) return;
    if (internalPathPrefixes.some((prefix) => token === prefix || token.startsWith(`${prefix}/`))) {
      throw new Error("Нельзя отправлять внутренние ссылки платформы клиенту");
    }
    return;
  }

  const url = new URL(token);
  if (isPrivateHostname(url.hostname)) {
    throw new Error("Нельзя отправлять внутренние ссылки платформы клиенту");
  }
  if (internalPathPrefixes.some((prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`))) {
    throw new Error("Нельзя отправлять внутренние ссылки платформы клиенту");
  }
}

export function assertMessengerOutboundTextSafe(text: string) {
  const normalized = text.trim();
  if (!normalized) throw new Error("Сообщение не может быть пустым");

  for (const item of forbiddenOutboundPatterns) {
    if (item.pattern.test(normalized)) {
      throw new Error(`Нельзя отправлять клиенту: ${item.reason}`);
    }
  }

  for (const token of linkTokens(normalized)) {
    assertSafeLink(token);
  }
}
