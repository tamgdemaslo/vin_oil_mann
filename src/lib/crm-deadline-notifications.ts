import crypto from "crypto";
import { getUsersFromEnv, type User } from "@/lib/auth";
import { prisma } from "@/lib/db";

export type ClientCaseNotificationType = "deadline_soon" | "due_now" | "overdue_repeat";
export type ClientCaseNotificationChannel = "in_app" | "browser_push" | "telegram";
export type ClientCaseNotificationStatus = "sent" | "failed" | "skipped";
export type ClientCaseNotificationUrgency = "overdue" | "next_hour" | "today" | "info";

type CrmCaseRow = {
  id: string;
  title: string;
  customerName: string | null;
  phoneNormalized: string | null;
  nextAction: string | null;
  nextContactAt: Date | null;
  snoozeUntil: Date | null;
  responsibleLogin: string | null;
  status: string;
  stageName: string | null;
};

type NotificationLogRow = {
  id: string;
  caseId: string;
  userId: string;
  type: ClientCaseNotificationType;
  channel: ClientCaseNotificationChannel;
  sentAt: Date;
  acknowledgedAt: Date | null;
  snoozedUntil: Date | null;
  status: ClientCaseNotificationStatus;
  errorMessage: string | null;
};

export type ClientCaseNotificationItem = {
  id: string;
  caseId: string;
  userId: string;
  type: ClientCaseNotificationType;
  urgency: ClientCaseNotificationUrgency;
  title: string;
  body: string;
  caseTitle: string;
  client: string;
  nextAction: string;
  deadline: string | null;
  overdueText: string | null;
  responsible: string;
  phone: string | null;
  href: string;
  sentAt: string;
  acknowledgedAt: string | null;
  snoozedUntil: string | null;
};

const CLOSED_STATUSES = new Set(["won", "lost", "done", "closed", "cancelled", "completed", "archive"]);
const CLOSED_STAGE_WORDS = ["закры", "выполн", "отмен", "архив", "lost"];
const DEFAULT_WARNING_MINUTES = [15];
const DEFAULT_REPEAT_MINUTES = 15;

export function getCrmNotificationConfig() {
  return {
    enabled: process.env.CRM_CASE_NOTIFICATIONS_ENABLED !== "false",
    warningMinutes: parseMinutesList(process.env.CRM_CASE_DEADLINE_WARNING_MINUTES, DEFAULT_WARNING_MINUTES),
    repeatMinutes: parsePositiveInt(process.env.CRM_CASE_OVERDUE_REPEAT_MINUTES, DEFAULT_REPEAT_MINUTES),
    ownerOverdueMode: process.env.CRM_CASE_OWNER_OVERDUE_MODE === "without_responsible" ? "without_responsible" : "all",
    watcherLogins: parseLoginList(process.env.CRM_CASE_WATCHER_LOGINS),
    telegramEnabled: process.env.CRM_CASE_TELEGRAM_NOTIFICATIONS !== "false",
  };
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
}

function parseMinutesList(value: string | undefined, fallback: number[]) {
  if (!value) return fallback;
  const parsed = value
    .split(",")
    .map((part) => parsePositiveInt(part.trim(), 0))
    .filter((part) => part > 0);
  return parsed.length ? parsed : fallback;
}

function parseLoginList(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizeLogin(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function isClosedCase(row: CrmCaseRow) {
  const status = normalizeLogin(row.status);
  if (CLOSED_STATUSES.has(status)) return true;
  const stageName = normalizeLogin(row.stageName);
  return CLOSED_STAGE_WORDS.some((word) => stageName.includes(word));
}

function minutesBetween(from: Date, to: Date) {
  return Math.round((to.getTime() - from.getTime()) / 60_000);
}

function formatTime(date: Date) {
  return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(date);
}

function humanDuration(minutesRaw: number) {
  const minutes = Math.max(0, Math.floor(minutesRaw));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours && rest) return `${hours} ч ${rest} мин`;
  if (hours) return `${hours} ч`;
  return `${rest} мин`;
}

function caseClient(row: CrmCaseRow) {
  return row.customerName || row.title || row.phoneNormalized || "клиент";
}

function caseAction(row: CrmCaseRow) {
  return row.nextAction || row.title || "Связаться с клиентом";
}

function notificationText(row: CrmCaseRow, type: ClientCaseNotificationType, now: Date) {
  const action = caseAction(row);
  const client = caseClient(row);
  const deadline = row.nextContactAt;
  if (type === "overdue_repeat") {
    const overdue = deadline ? humanDuration(minutesBetween(deadline, now)) : "";
    return {
      title: `Просрочено: ${action} ${client}`,
      body: `Просрочено${overdue ? ` на ${overdue}` : ""} · Ответственный: ${row.responsibleLogin || "не назначен"}`,
    };
  }
  if (type === "due_now") {
    return {
      title: `Срок сейчас: ${action} ${client}`,
      body: `Дедлайн сейчас${deadline ? ` в ${formatTime(deadline)}` : ""} · Ответственный: ${row.responsibleLogin || "не назначен"}`,
    };
  }
  return {
    title: `Скоро срок: ${action} ${client}`,
    body: `Дедлайн сегодня${deadline ? ` в ${formatTime(deadline)}` : ""} · Ответственный: ${row.responsibleLogin || "не назначен"}`,
  };
}

function notificationUrgency(row: CrmCaseRow, type: ClientCaseNotificationType, now: Date): ClientCaseNotificationUrgency {
  if (type === "overdue_repeat") return "overdue";
  if (!row.nextContactAt) return "info";
  const minutes = minutesBetween(now, row.nextContactAt);
  if (minutes <= 60 && minutes >= 0) return "next_hour";
  if (row.nextContactAt.toDateString() === now.toDateString()) return "today";
  return "info";
}

async function loadActiveCases(now: Date): Promise<CrmCaseRow[]> {
  return prisma.$queryRaw<CrmCaseRow[]>`
    SELECT
      d.id,
      d.title,
      d.customer_name AS "customerName",
      d.phone_normalized AS "phoneNormalized",
      d.next_action AS "nextAction",
      d.next_contact_at AS "nextContactAt",
      d.snooze_until AS "snoozeUntil",
      d.responsible_login AS "responsibleLogin",
      d.status,
      s.name AS "stageName"
    FROM crm_deals d
    LEFT JOIN crm_stages s ON s.id = d.stage_id
    WHERE d.next_contact_at IS NOT NULL
      AND (d.snooze_until IS NULL OR d.snooze_until <= ${now})
      AND d.status = 'open'
    ORDER BY d.next_contact_at ASC
    LIMIT 500
  `;
}

async function loadRecentLog(caseId: string, userId: string, type: ClientCaseNotificationType, channel: ClientCaseNotificationChannel) {
  const rows = await prisma.$queryRaw<NotificationLogRow[]>`
    SELECT
      id,
      case_id AS "caseId",
      user_id AS "userId",
      type,
      channel,
      sent_at AS "sentAt",
      acknowledged_at AS "acknowledgedAt",
      snoozed_until AS "snoozedUntil",
      status,
      error_message AS "errorMessage"
    FROM client_case_notification_log
    WHERE case_id = ${caseId}
      AND user_id = ${userId}
      AND type = ${type}
      AND channel = ${channel}
      AND status = 'sent'
    ORDER BY sent_at DESC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function writeLog(input: {
  caseId: string;
  userId: string;
  type: ClientCaseNotificationType;
  channel: ClientCaseNotificationChannel;
  status: ClientCaseNotificationStatus;
  errorMessage?: string | null;
  snoozedUntil?: Date | null;
}) {
  const id = crypto.randomUUID();
  await prisma.$executeRaw`
    INSERT INTO client_case_notification_log
      (id, case_id, user_id, type, channel, sent_at, status, error_message, snoozed_until)
    VALUES
      (${id}, ${input.caseId}, ${input.userId}, ${input.type}, ${input.channel}, now(), ${input.status}, ${input.errorMessage ?? null}, ${input.snoozedUntil ?? null})
  `;
}

async function ownerLogins(users: User[]) {
  return users.filter((user) => user.role === "owner").map((user) => user.login);
}

async function recipientsForCase(row: CrmCaseRow, type: ClientCaseNotificationType, users: User[]) {
  const recipients = new Set<string>();
  if (row.responsibleLogin) recipients.add(row.responsibleLogin);
  const owners = await ownerLogins(users);
  if (!row.responsibleLogin) owners.forEach((owner) => recipients.add(owner));
  if (type === "overdue_repeat" && getCrmNotificationConfig().ownerOverdueMode === "all") {
    owners.forEach((owner) => recipients.add(owner));
  }
  getCrmNotificationConfig().watcherLogins.forEach((login) => recipients.add(login));
  return [...recipients].filter(Boolean);
}

function typeForCase(row: CrmCaseRow, now: Date, warningMinutes: number[], repeatMinutes: number): ClientCaseNotificationType | null {
  if (!row.nextContactAt) return null;
  const minutesToDue = minutesBetween(now, row.nextContactAt);
  if (minutesToDue < 0) return "overdue_repeat";
  if (minutesToDue === 0) return "due_now";
  if (warningMinutes.some((minutes) => minutesToDue <= minutes && minutesToDue > Math.max(0, minutes - repeatMinutes))) {
    return "deadline_soon";
  }
  return null;
}

function telegramChatIds() {
  const raw = process.env.TELEGRAM_USER_CHAT_IDS?.trim() || process.env.CRM_CASE_TELEGRAM_CHAT_IDS?.trim() || "";
  const map = new Map<string, string>();
  if (!raw) return map;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const [login, chatId] of Object.entries(parsed)) {
      if (typeof chatId === "string" || typeof chatId === "number") map.set(normalizeLogin(login), String(chatId));
    }
    return map;
  } catch {
    for (const pair of raw.split(",")) {
      const [login, chatId] = pair.split(":").map((part) => part.trim());
      if (login && chatId) map.set(normalizeLogin(login), chatId);
    }
    return map;
  }
}

async function sendTelegram(userId: string, item: { title: string; body: string; href: string }) {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = telegramChatIds().get(normalizeLogin(userId));
  if (!token || !chatId) return { status: "skipped" as const, error: null };
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.APP_URL?.trim() || "";
  const text = `${item.title}\n${item.body}${baseUrl ? `\n${baseUrl}${item.href}` : ""}`;
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
  if (!res.ok) return { status: "failed" as const, error: await res.text().catch(() => "telegram failed") };
  return { status: "sent" as const, error: null };
}

export async function processClientCaseDeadlineNotifications(now = new Date()) {
  const config = getCrmNotificationConfig();
  if (!config.enabled) return { sent: 0, skipped: 0, failed: 0 };
  const users = await getUsersFromEnv();
  const cases = (await loadActiveCases(now)).filter((row) => !isClosedCase(row));
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of cases) {
    const type = typeForCase(row, now, config.warningMinutes, config.repeatMinutes);
    if (!type) continue;
    const recipients = await recipientsForCase(row, type, users);
    const text = notificationText(row, type, now);
    for (const userId of recipients) {
      const recent = await loadRecentLog(row.id, userId, type, "in_app");
      if (recent) {
        const elapsed = now.getTime() - recent.sentAt.getTime();
        const limit = config.repeatMinutes * 60_000;
        if (elapsed < limit) {
          skipped += 1;
          continue;
        }
      }
      await writeLog({ caseId: row.id, userId, type, channel: "in_app", status: "sent" });
      sent += 1;

      if (config.telegramEnabled && type === "overdue_repeat") {
        const result = await sendTelegram(userId, { ...text, href: `/crm?dealId=${encodeURIComponent(row.id)}` });
        await writeLog({
          caseId: row.id,
          userId,
          type,
          channel: "telegram",
          status: result.status,
          errorMessage: result.error,
        });
        if (result.status === "failed") failed += 1;
        if (result.status === "skipped") skipped += 1;
      }
    }
  }
  return { sent, skipped, failed };
}

export async function listClientCaseNotificationsForUser(userId: string, now = new Date()): Promise<ClientCaseNotificationItem[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      logId: string;
      caseId: string;
      userId: string;
      type: ClientCaseNotificationType;
      sentAt: Date;
      acknowledgedAt: Date | null;
      logSnoozedUntil: Date | null;
      title: string;
      customerName: string | null;
      phoneNormalized: string | null;
      nextAction: string | null;
      nextContactAt: Date | null;
      snoozeUntil: Date | null;
      responsibleLogin: string | null;
      dealStatus: string;
      stageName: string | null;
    }>
  >`
    SELECT DISTINCT ON (l.case_id, l.type)
      l.id AS "logId",
      l.case_id AS "caseId",
      l.user_id AS "userId",
      l.type,
      l.sent_at AS "sentAt",
      l.acknowledged_at AS "acknowledgedAt",
      l.snoozed_until AS "logSnoozedUntil",
      d.title,
      d.customer_name AS "customerName",
      d.phone_normalized AS "phoneNormalized",
      d.next_action AS "nextAction",
      d.next_contact_at AS "nextContactAt",
      d.snooze_until AS "snoozeUntil",
      d.responsible_login AS "responsibleLogin",
      d.status AS "dealStatus",
      s.name AS "stageName"
    FROM client_case_notification_log l
    JOIN crm_deals d ON d.id = l.case_id
    LEFT JOIN crm_stages s ON s.id = d.stage_id
    WHERE l.user_id = ${userId}
      AND l.channel = 'in_app'
      AND l.status = 'sent'
      AND (l.acknowledged_at IS NULL OR d.next_contact_at < ${now})
      AND d.status = 'open'
      AND (d.snooze_until IS NULL OR d.snooze_until <= ${now})
    ORDER BY l.case_id, l.type, l.sent_at DESC
    LIMIT 80
  `;

  return rows
    .filter((row) => !isClosedCase({ ...row, id: row.caseId, status: row.dealStatus }))
    .map((row) => {
      const crmCase = { ...row, id: row.caseId, status: row.dealStatus };
      const text = notificationText(crmCase, row.type, now);
      const overdueMinutes = row.nextContactAt && row.nextContactAt < now ? minutesBetween(row.nextContactAt, now) : null;
      return {
        id: row.logId,
        caseId: row.caseId,
        userId: row.userId,
        type: row.type,
        urgency: notificationUrgency(crmCase, row.type, now),
        title: text.title,
        body: text.body,
        caseTitle: row.title,
        client: caseClient(crmCase),
        nextAction: caseAction(crmCase),
        deadline: row.nextContactAt?.toISOString() ?? null,
        overdueText: overdueMinutes == null ? null : humanDuration(overdueMinutes),
        responsible: row.responsibleLogin || "Без ответственного",
        phone: row.phoneNormalized,
        href: `/crm?dealId=${encodeURIComponent(row.caseId)}`,
        sentAt: row.sentAt.toISOString(),
        acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
        snoozedUntil: row.logSnoozedUntil?.toISOString() ?? row.snoozeUntil?.toISOString() ?? null,
      };
    })
    .sort((a, b) => urgencySort(a.urgency) - urgencySort(b.urgency) || (a.deadline ?? "").localeCompare(b.deadline ?? ""));
}

function urgencySort(urgency: ClientCaseNotificationUrgency) {
  if (urgency === "overdue") return 0;
  if (urgency === "next_hour") return 1;
  if (urgency === "today") return 2;
  return 3;
}

export async function acknowledgeClientCaseNotification(logId: string, userId: string) {
  await prisma.$executeRaw`
    UPDATE client_case_notification_log
    SET acknowledged_at = now()
    WHERE id = ${logId} AND user_id = ${userId}
  `;
}

export async function snoozeClientCase(caseId: string, userId: string, minutes: number) {
  const snoozedUntil = new Date(Date.now() + Math.max(1, minutes) * 60_000);
  await prisma.$transaction([
    prisma.$executeRaw`UPDATE crm_deals SET snooze_until = ${snoozedUntil}, updated_at = now() WHERE id = ${caseId}`,
    prisma.$executeRaw`
      UPDATE client_case_notification_log
      SET acknowledged_at = now(), snoozed_until = ${snoozedUntil}
      WHERE case_id = ${caseId} AND user_id = ${userId} AND acknowledged_at IS NULL
    `,
  ]);
  return snoozedUntil;
}

export async function closeClientCaseFromNotification(caseId: string) {
  await prisma.$executeRaw`
    UPDATE crm_deals
    SET status = 'won', close_reason = COALESCE(close_reason, 'закрыто из уведомления'), updated_at = now()
    WHERE id = ${caseId}
  `;
}

export async function logBrowserPush(caseId: string, userId: string, type: ClientCaseNotificationType, status: ClientCaseNotificationStatus, errorMessage?: string | null) {
  await writeLog({ caseId, userId, type, channel: "browser_push", status, errorMessage });
}
