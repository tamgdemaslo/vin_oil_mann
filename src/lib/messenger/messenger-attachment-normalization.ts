import type { Attachment, AttachmentType } from "./messenger-types";

type AttachmentLike = {
  type?: string | null;
  name?: string | null;
  mimeType?: string | null;
  metadataJson?: unknown;
};

const DOCUMENT_EXTENSIONS = new Set([
  "pdf",
  "zip",
  "rar",
  "7z",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "txt",
  "rtf",
  "csv",
]);

function lower(value?: string | null) {
  return value?.trim().toLowerCase() ?? "";
}

function extensionFromName(name?: string | null) {
  const text = lower(name);
  const match = text.match(/\.([a-z0-9]{2,8})(?:$|\?)/);
  return match?.[1] ?? "";
}

function metadataText(metadata: unknown) {
  if (!metadata) return "";
  try {
    return JSON.stringify(metadata).toLowerCase();
  } catch {
    return "";
  }
}

function hasTelegramFlag(metadata: unknown, flag: string) {
  return metadataText(metadata).includes(flag.toLowerCase());
}

export function isTechnicalMessengerAttachmentName(name?: string | null) {
  const text = lower(name);
  if (!text) return false;
  return (
    /^(attachment|photo|video|audio|voice|document)-telegram:message:/.test(text) ||
    /^(attachment|photo|video|audio|voice|document)-telegram%3amessage%3a/.test(text) ||
    /^attachment-[a-f0-9-]{24,}\./.test(text)
  );
}

export function normalizeMessengerAttachmentType(input: AttachmentLike): AttachmentType {
  const rawType = lower(input.type);
  const mimeType = lower(input.mimeType);
  const ext = extensionFromName(input.name);
  const metadata = input.metadataJson;
  const meta = metadataText(metadata);

  if (rawType === "image") return "photo";
  if (rawType === "photo") return "photo";
  if (rawType === "voice") return "voice";
  if (rawType === "video_note") return "video_note";
  if (rawType === "animation" || rawType === "gif") return "animation";
  if (rawType === "sticker") return "sticker";
  if (rawType === "video") return "video";
  if (rawType === "audio") {
    return hasTelegramFlag(metadata, "\"voice\":true") ||
      (mimeType === "audio/ogg" && isTechnicalMessengerAttachmentName(input.name))
      ? "voice"
      : "audio";
  }
  if (rawType === "document" || rawType === "file") {
    if (mimeType.startsWith("image/")) return mimeType === "image/gif" ? "animation" : "photo";
    if (mimeType.startsWith("video/")) return meta.includes("roundmessage") ? "video_note" : "video";
    if (mimeType.startsWith("audio/")) return mimeType === "audio/ogg" && meta.includes("voice") ? "voice" : "audio";
    if (mimeType === "application/x-tgsticker" || meta.includes("sticker")) return "sticker";
    return "document";
  }
  if (rawType === "link" || rawType === "location" || rawType === "contact" || rawType === "unsupported") return rawType;

  if (mimeType === "application/x-tgsticker" || meta.includes("sticker")) return "sticker";
  if (mimeType === "image/gif" || ext === "gif" || meta.includes("animation")) return "animation";
  if (mimeType.startsWith("image/")) return "photo";
  if (mimeType.startsWith("video/")) return meta.includes("roundmessage") ? "video_note" : "video";
  if (mimeType.startsWith("audio/")) return mimeType === "audio/ogg" && meta.includes("voice") ? "voice" : "audio";
  if (DOCUMENT_EXTENSIONS.has(ext)) return "document";
  return "unsupported";
}

export function messengerAttachmentFallbackName(type: AttachmentType) {
  if (type === "photo" || type === "image") return "Фото Telegram";
  if (type === "video") return "Видео Telegram";
  if (type === "voice") return "Голосовое сообщение";
  if (type === "audio") return "Аудио Telegram";
  if (type === "sticker") return "Стикер Telegram";
  if (type === "animation") return "GIF Telegram";
  if (type === "video_note") return "Видеосообщение Telegram";
  if (type === "document") return "Документ Telegram";
  if (type === "link") return "Ссылка";
  if (type === "contact") return "Контакт";
  if (type === "location") return "Геопозиция";
  return "Файл Telegram";
}

export function messengerAttachmentDisplayName(input: AttachmentLike) {
  const type = normalizeMessengerAttachmentType(input);
  const name = input.name?.trim();
  if (!name || isTechnicalMessengerAttachmentName(name)) return messengerAttachmentFallbackName(type);
  return name;
}

export function normalizeMessengerAttachment<T extends AttachmentLike>(attachment: T): T & { type: AttachmentType; name?: string } {
  const type = normalizeMessengerAttachmentType(attachment);
  return {
    ...attachment,
    type,
    name: messengerAttachmentDisplayName({ ...attachment, type }),
  };
}

export function isPhotoAttachmentType(type?: string | null) {
  const normalized = normalizeMessengerAttachmentType({ type });
  return normalized === "photo" || normalized === "sticker" || normalized === "animation";
}

export function isVideoAttachmentType(type?: string | null) {
  const normalized = normalizeMessengerAttachmentType({ type });
  return normalized === "video" || normalized === "video_note";
}

export function isAudioAttachmentType(type?: string | null) {
  const normalized = normalizeMessengerAttachmentType({ type });
  return normalized === "voice" || normalized === "audio";
}

export function isDocumentAttachmentType(type?: string | null) {
  const normalized = normalizeMessengerAttachmentType({ type });
  return normalized === "document" || normalized === "file" || normalized === "unsupported";
}

export function normalizeAttachmentList(attachments: Attachment[] | null | undefined) {
  return Array.isArray(attachments) ? attachments.map((attachment) => normalizeMessengerAttachment(attachment)) : [];
}
