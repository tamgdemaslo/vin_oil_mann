import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import {
  acknowledgeClientCaseNotification,
  closeClientCaseFromNotification,
  getCrmNotificationConfig,
  listClientCaseNotificationsForUser,
  logBrowserPush,
  processClientCaseDeadlineNotifications,
  snoozeClientCase,
  type ClientCaseNotificationType,
} from "@/lib/crm-deadline-notifications";

export const dynamic = "force-dynamic";

const DEFAULT_PROCESSING_INTERVAL_MS = 60_000;
const MIN_PROCESSING_INTERVAL_MS = 30_000;

type DeadlineProcessingState = {
  inFlight?: Promise<void>;
  nextAllowedAt?: number;
};

const deadlineProcessingGlobal = globalThis as typeof globalThis & {
  __crmDeadlineProcessingByBranch?: Map<string, DeadlineProcessingState>;
};

function processingIntervalMs() {
  const configured = Number(process.env.CRM_CASE_PROCESSING_INTERVAL_MS);
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_PROCESSING_INTERVAL_MS;
  return Math.max(Math.floor(configured), MIN_PROCESSING_INTERVAL_MS);
}

function safeError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function scheduleDeadlineProcessing(branchId: string) {
  deadlineProcessingGlobal.__crmDeadlineProcessingByBranch ??= new Map();
  const states = deadlineProcessingGlobal.__crmDeadlineProcessingByBranch;
  const current = states.get(branchId) ?? {};
  states.set(branchId, current);

  const now = Date.now();
  if (current.inFlight || now < (current.nextAllowedAt ?? 0)) return;
  current.nextAllowedAt = now + processingIntervalMs();

  const task = Promise.resolve()
    .then(() => processClientCaseDeadlineNotifications())
    .then(() => undefined)
    .catch((error) => {
      console.warn("[crm-deadline-notifications]", {
        action: "processing_failed",
        branchId,
        error: safeError(error),
      });
    })
    .finally(() => {
      if (current.inFlight === task) current.inFlight = undefined;
    });
  current.inFlight = task;
}

async function requireSession() {
  const session = await getSession();
  if (!session) {
    return { session: null, response: NextResponse.json({ error: "Необходима авторизация" }, { status: 401 }) };
  }
  return { session, response: null };
}

function countsByUrgency(items: Awaited<ReturnType<typeof listClientCaseNotificationsForUser>>) {
  return items.reduce(
    (acc, item) => {
      acc.total += 1;
      acc[item.urgency] += 1;
      return acc;
    },
    { total: 0, overdue: 0, next_hour: 0, today: 0, info: 0 }
  );
}

export async function GET() {
  const access = await requireSession();
  if (access.response) return access.response;
  const branch = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!branch.ok) return branch.response;
  const branchId = branch.context.branchId;
  if (!branchId) return NextResponse.json({ error: "Выберите филиал" }, { status: 409 });

  return runWithBranchApiContext(branch.context, async () => {
    const items = await listClientCaseNotificationsForUser(access.session!.user.login, branchId);
    // Generating reminders can scan hundreds of CRM cases and send Telegram
    // notifications. Run it at most once per branch/interval and never make
    // every browser tab wait for the same background work.
    scheduleDeadlineProcessing(branchId);
    return NextResponse.json({
      config: getCrmNotificationConfig(),
      notifications: items,
      notificationCounts: countsByUrgency(items),
    });
  });
}

export async function POST(request: NextRequest) {
  const access = await requireSession();
  if (access.response) return access.response;
  const branch = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!branch.ok) return branch.response;
  const branchId = branch.context.branchId;
  if (!branchId) return NextResponse.json({ error: "Выберите филиал" }, { status: 409 });
  const userId = access.session!.user.login;
  const body = await request.json().catch(() => ({}));
  const action = typeof body.action === "string" ? body.action : "";
  const caseId = typeof body.caseId === "string" ? body.caseId : "";
  const notificationId = typeof body.notificationId === "string" ? body.notificationId : "";

  return runWithBranchApiContext(branch.context, async () => {
    if (action === "acknowledge") {
      if (!notificationId) return NextResponse.json({ error: "notificationId не задан" }, { status: 400 });
      await acknowledgeClientCaseNotification(notificationId, userId, branchId);
      return NextResponse.json({ ok: true });
    }

    if (action === "snooze") {
      if (!caseId) return NextResponse.json({ error: "caseId не задан" }, { status: 400 });
      const minutes = Number(body.minutes);
      const snoozedUntil = await snoozeClientCase(caseId, userId, Number.isFinite(minutes) ? minutes : 15, branchId);
      return NextResponse.json({ ok: true, snoozedUntil: snoozedUntil.toISOString() });
    }

    if (action === "close") {
      if (!caseId) return NextResponse.json({ error: "caseId не задан" }, { status: 400 });
      await closeClientCaseFromNotification(caseId, branchId);
      return NextResponse.json({ ok: true });
    }

    if (action === "browser_push") {
      if (!caseId) return NextResponse.json({ error: "caseId не задан" }, { status: 400 });
      const type = typeof body.type === "string" ? (body.type as ClientCaseNotificationType) : "deadline_soon";
      const status = body.status === "failed" ? "failed" : body.status === "skipped" ? "skipped" : "sent";
      await logBrowserPush(caseId, userId, type, status, typeof body.errorMessage === "string" ? body.errorMessage : null, branchId);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
  });
}
