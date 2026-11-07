export const journalContactSources = ["Телефон", "Авито", "ВКонтакте", "Telegram", "WhatsApp", "Сайт", "Лично", "Другое"] as const;

const prefix = "booking-journal-contact:v1\n";

export function journalContactUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

export function readJournalContact(value: string | null | undefined): { comment: string | null; source: string | null; link: string | null } {
  if (value?.startsWith(prefix)) {
    try {
      const data = JSON.parse(value.slice(prefix.length));
      if (data && (data.comment === null || typeof data.comment === "string")
        && (data.source === null || journalContactSources.some(source => source === data.source))
        && (data.link === null || (typeof data.link === "string" && journalContactUrl(data.link)))) {
        return { comment: data.comment, source: data.source, link: data.link };
      }
    } catch {
      // Older records can contain arbitrary text.
    }
  }
  return { comment: value ?? null, source: null, link: null };
}

export function writeJournalContact({ comment, source, link }: ReturnType<typeof readJournalContact>) {
  // The existing private field keeps the contact details atomic with the booking.
  return source || link || comment?.startsWith(prefix) ? prefix + JSON.stringify({ comment, source, link }) : comment;
}
