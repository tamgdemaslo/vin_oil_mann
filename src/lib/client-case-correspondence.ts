export const CASE_CORRESPONDENCE_CHANNELS = ["Telegram", "WhatsApp", "MAX", "ВКонтакте", "Avito", "SMS", "Другое"] as const;
export type CaseCorrespondenceChannel = typeof CASE_CORRESPONDENCE_CHANNELS[number] | "";

// Keep optional correspondence metadata in the existing notes field, separate
// from lead origin and linked messenger conversation IDs. No migration needed.
const PREFIX = "Переписка: ";
const LINK_PREFIX = "Ссылка на переписку: ";
const isLinkLine = (line: string) => /^Ссылка на переписку: (https:\/\/\S+|\/messages\?conversationId=\S+)$/.test(line);

export function caseCorrespondenceLink(notes: string | null | undefined): string {
  return notes?.split(/\r?\n/).find(isLinkLine)?.slice(LINK_PREFIX.length) ?? "";
}
const isChannelLine = (line: string) => line.startsWith(PREFIX) && CASE_CORRESPONDENCE_CHANNELS.some(channel => line.slice(PREFIX.length).trim() === channel);

export function validCaseCorrespondence(value: unknown): value is CaseCorrespondenceChannel {
  return value === "" || CASE_CORRESPONDENCE_CHANNELS.some(channel => value === channel);
}

export function caseCorrespondence(notes: string | null | undefined): CaseCorrespondenceChannel {
  const line = notes?.split(/\r?\n/).find(isChannelLine);
  return line ? line.slice(PREFIX.length).trim() as CaseCorrespondenceChannel : "";
}

export function withoutCaseCorrespondence(notes: string | null | undefined): string {
  return (notes ?? "").split(/\r?\n/).filter(line => !isChannelLine(line) && !isLinkLine(line)).join("\n").trim();
}

export function withCaseCorrespondence(notes: string | null | undefined, channel: CaseCorrespondenceChannel, link?: string): string | null {
  const savedLink = channel ? link ?? (caseCorrespondence(notes) === channel ? caseCorrespondenceLink(notes) : "") : "";
  return [channel ? PREFIX + channel : "", savedLink ? LINK_PREFIX + savedLink : "", withoutCaseCorrespondence(notes)].filter(Boolean).join("\n") || null;
}
