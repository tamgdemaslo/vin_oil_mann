import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getTelegramStoredSettings } from "@/lib/messenger/messenger-channel-settings";
import { requireSingleBranchSqlContext } from "@/lib/branch-sql-context";

type MessengerErrorLogRow = {
  id: string;
  source: "webhook" | "outbox";
  channel: string;
  status: string;
  message: string;
  createdAt: Date;
  processedAt: Date | null;
};

function normalizeLimit(value: string | null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 30;
  return Math.min(100, Math.max(1, Math.trunc(parsed)));
}

async function redactKnownSecrets(value: string) {
  let result = value;
  for (const key of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET"]) {
    const secret = process.env[key]?.trim();
    if (secret) result = result.split(secret).join(`[${key}]`);
  }
  const telegram = await getTelegramStoredSettings().catch(() => null);
  if (telegram?.botToken) result = result.split(telegram.botToken).join("[TELEGRAM_BOT_TOKEN]");
  if (telegram?.webhookSecret) result = result.split(telegram.webhookSecret).join("[TELEGRAM_WEBHOOK_SECRET]");
  return result;
}

async function requireIntegrationManager() {
  const session = await getSession();
  if (!session) return { response: NextResponse.json({ error: "Необходима авторизация" }, { status: 401 }) };
  if (session.user.role !== "owner" && session.user.role !== "admin") {
    return { response: NextResponse.json({ error: "Недостаточно прав" }, { status: 403 }) };
  }
  return { session };
}

async function messengerError(error: unknown) {
  const message = error instanceof Error ? error.message : "Не удалось получить логи Messenger";
  if (message.includes("messenger_") && message.includes("does not exist")) {
    return NextResponse.json({ error: "Миграция Messenger Gateway ещё не применена к базе данных" }, { status: 500 });
  }
  return NextResponse.json({ error: await redactKnownSecrets(message) }, { status: 500 });
}

export async function GET(request: NextRequest) {
  const auth = await requireIntegrationManager();
  if ("response" in auth) return auth.response;

  const limit = normalizeLimit(request.nextUrl.searchParams.get("limit"));
  try {
    const { branchId } = requireSingleBranchSqlContext();
    const rows = await prisma.$queryRaw<MessengerErrorLogRow[]>`
      SELECT *
      FROM (
        SELECT
          id,
          'webhook'::text AS source,
          channel::text AS channel,
          CASE WHEN processed_at IS NULL THEN 'received' ELSE 'failed' END AS status,
          error AS message,
          created_at AS "createdAt",
          processed_at AS "processedAt"
        FROM messenger_webhook_events
        WHERE error IS NOT NULL
          AND error <> ''
          AND branch_id = ${branchId}
        UNION ALL
        SELECT
          id,
          'outbox'::text AS source,
          channel::text AS channel,
          status::text AS status,
          COALESCE(error_message, error_code, 'Messenger outbox failed') AS message,
          created_at AS "createdAt",
          updated_at AS "processedAt"
        FROM messenger_outbox
        WHERE branch_id = ${branchId}
          AND (status = 'failed' OR COALESCE(error_message, error_code) IS NOT NULL)
      ) logs
      ORDER BY "createdAt" DESC
      LIMIT ${limit}
    `;
    const redactedRows = [];
    for (const row of rows) {
      redactedRows.push({
        id: row.id,
        source: row.source,
        channel: row.channel,
        status: row.status,
        message: await redactKnownSecrets(row.message),
        createdAt: row.createdAt.toISOString(),
        processedAt: row.processedAt?.toISOString() ?? null,
      });
    }
    return NextResponse.json({
      logs: redactedRows,
    });
  } catch (error) {
    return messengerError(error);
  }
}
