import { normalizePhoneKey } from "@/lib/phone-normalize";
import type { CaseCorrespondenceChannel } from "@/lib/client-case-correspondence";

const HOSTS: Record<string, string[]> = {
  Telegram: ["t.me", "telegram.me", "web.telegram.org"],
  WhatsApp: ["wa.me", "whatsapp.com"],
  MAX: ["max.ru"],
  "ВКонтакте": ["vk.com", "vk.ru", "vk.me"],
  Avito: ["avito.ru"],
};
export const CASE_CHAT_CHANNELS: Record<string, string> = { Telegram: "telegram", WhatsApp: "whatsapp", MAX: "max", "ВКонтакте": "vk", Avito: "avito", SMS: "sms" };

export function validCaseChatLink(value: unknown, channel: CaseCorrespondenceChannel, platformOrigin?: string): value is string {
  if (typeof value !== "string" || value.length > 2000 || /[\s\u0000-\u001f]/u.test(value)) return false;
  if (!value) return true;
  if (!channel) return false;
  if (/^\/messages\?conversationId=[^\s&#]+$/.test(value)) return true;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
    if (platformOrigin && url.origin === new URL(platformOrigin).origin && url.pathname === "/messages" && url.searchParams.get("conversationId") && [...url.searchParams.keys()].every(key => key === "conversationId")) return true;
    return channel === "Другое" || Boolean(HOSTS[channel]?.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`)));
  } catch { return false; }
}

export function caseChatPhoneLink(channel: CaseCorrespondenceChannel, phone?: string | null): string | null {
  let digits = normalizePhoneKey(phone);
  if (!digits) return null;
  if (/^9\d{9}$/.test(digits)) digits = `7${digits}`;
  if (channel === "Telegram") return `https://t.me/+${digits}`;
  if (channel === "WhatsApp") return `https://wa.me/${digits}`;
  if (channel === "SMS") return `sms:+${digits}`;
  return null;
}
