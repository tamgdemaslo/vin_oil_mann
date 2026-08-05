import { randomUUID } from "crypto";
import { prisma } from "@/lib/db";
import { canonicalizeLogin } from "@/lib/auth";
import { requireSingleBranchSqlContext } from "@/lib/branch-sql-context";

export const DEFAULT_PAYROLL_ORG_ID = "default";

export type PayrollGoalMetric =
  | "ACCRUAL_AMOUNT"
  | "VEHICLES"
  | "SERVICES"
  | "PRODUCTS"
  | "SHIPMENTS"
  | "QUALITY"
  | "DIAGNOSTICS"
  | "APPROVED_RECOMMENDATIONS";

export type PayrollGoalRecord = {
  id: string;
  organizationId: string;
  employeeLogin: string | null;
  role: string | null;
  teamKey: string | null;
  periodType: "SHIFT" | "WEEK" | "MONTH";
  metric: PayrollGoalMetric;
  targetValue: number;
  baselineValue: number | null;
  stretchValue: number | null;
  startsAt: string;
  endsAt: string;
  status: string;
  createdByLogin: string;
  createdAt: string;
  updatedAt: string;
};

export type EmployeeRecognitionRecord = {
  id: string;
  organizationId: string;
  employeeLogin: string;
  authorLogin: string;
  title: string;
  message: string;
  reason: string;
  visibility: "PRIVATE" | "TEAM";
  sourceType: string | null;
  sourceId: string | null;
  createdAt: string;
};

export type MotivationSettingsRecord = {
  id: string;
  organizationId: string;
  employeeLogin: string | null;
  showForecast: boolean;
  showGoals: boolean;
  showAchievements: boolean;
  showTeamProgress: boolean;
  showQuality: boolean;
  showRecognition: boolean;
  notificationsJson: unknown;
  updatedAt: string;
};

function missingTableFallback(error: unknown) {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes("does not exist") || message.includes("p2021") || message.includes("undefined_table");
}

function toIso(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? value : new Date().toISOString();
}

function normalizeLogin(value: string) {
  return canonicalizeLogin(value).trim().toLowerCase();
}

function mapGoal(row: {
  id: string;
  organizationId: string;
  employeeLogin: string | null;
  role: string | null;
  teamKey: string | null;
  periodType: PayrollGoalRecord["periodType"];
  metric: PayrollGoalMetric;
  targetValue: number;
  baselineValue: number | null;
  stretchValue: number | null;
  startsAt: string;
  endsAt: string;
  status: string;
  createdByLogin: string;
  createdAt: Date | string;
  updatedAt: Date | string;
}): PayrollGoalRecord {
  return {
    ...row,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function mapRecognition(row: {
  id: string;
  organizationId: string;
  employeeLogin: string;
  authorLogin: string;
  title: string;
  message: string;
  reason: string;
  visibility: EmployeeRecognitionRecord["visibility"];
  sourceType: string | null;
  sourceId: string | null;
  createdAt: Date | string;
}): EmployeeRecognitionRecord {
  return {
    ...row,
    createdAt: toIso(row.createdAt),
  };
}

export async function listActivePayrollGoals(params: {
  employeeLogin?: string;
  role?: string;
  dateKey: string;
  organizationId?: string;
}) {
  try {
    const { branchId } = requireSingleBranchSqlContext();
    const rows = await prisma.$queryRaw<
      Array<{
        id: string;
        organizationId: string;
        employeeLogin: string | null;
        role: string | null;
        teamKey: string | null;
        periodType: PayrollGoalRecord["periodType"];
        metric: PayrollGoalMetric;
        targetValue: number;
        baselineValue: number | null;
        stretchValue: number | null;
        startsAt: string;
        endsAt: string;
        status: string;
        createdByLogin: string;
        createdAt: Date;
        updatedAt: Date;
      }>
    >`
      SELECT
        id,
        organization_id AS "organizationId",
        employee_id AS "employeeLogin",
        role,
        team_key AS "teamKey",
        period_type AS "periodType",
        metric,
        target_value AS "targetValue",
        baseline_value AS "baselineValue",
        stretch_value AS "stretchValue",
        starts_at AS "startsAt",
        ends_at AS "endsAt",
        status,
        created_by_id AS "createdByLogin",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM payroll_goals
      WHERE organization_id = ${params.organizationId ?? DEFAULT_PAYROLL_ORG_ID}
        AND branch_id = ${branchId}
        AND status <> 'archived'
        AND starts_at <= ${params.dateKey}
        AND ends_at >= ${params.dateKey}
        AND (
          employee_id = ${params.employeeLogin ? canonicalizeLogin(params.employeeLogin) : ""}
          OR (${params.role ?? ""} <> '' AND employee_id IS NULL AND role = ${params.role ?? ""})
          OR (employee_id IS NULL AND role IS NULL AND team_key IS NULL)
        )
      ORDER BY employee_id NULLS LAST, role NULLS LAST, created_at DESC
      LIMIT 20
    `;
    return rows.map(mapGoal);
  } catch (error) {
    if (missingTableFallback(error)) return [];
    throw error;
  }
}

export async function listAllPayrollGoals(organizationId = DEFAULT_PAYROLL_ORG_ID) {
  try {
    const rows = await prisma.$queryRaw<
      Array<{
        id: string;
        organizationId: string;
        employeeLogin: string | null;
        role: string | null;
        teamKey: string | null;
        periodType: PayrollGoalRecord["periodType"];
        metric: PayrollGoalMetric;
        targetValue: number;
        baselineValue: number | null;
        stretchValue: number | null;
        startsAt: string;
        endsAt: string;
        status: string;
        createdByLogin: string;
        createdAt: Date;
        updatedAt: Date;
      }>
    >`
      SELECT
        id,
        organization_id AS "organizationId",
        employee_id AS "employeeLogin",
        role,
        team_key AS "teamKey",
        period_type AS "periodType",
        metric,
        target_value AS "targetValue",
        baseline_value AS "baselineValue",
        stretch_value AS "stretchValue",
        starts_at AS "startsAt",
        ends_at AS "endsAt",
        status,
        created_by_id AS "createdByLogin",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM payroll_goals
      WHERE organization_id = ${organizationId}
      ORDER BY created_at DESC
      LIMIT 100
    `;
    return rows.map(mapGoal);
  } catch (error) {
    if (missingTableFallback(error)) return [];
    throw error;
  }
}

export async function createPayrollGoal(params: {
  employeeLogin?: string | null;
  role?: string | null;
  teamKey?: string | null;
  periodType: PayrollGoalRecord["periodType"];
  metric: PayrollGoalMetric;
  targetValue: number;
  baselineValue?: number | null;
  stretchValue?: number | null;
  startsAt: string;
  endsAt: string;
  createdByLogin: string;
  organizationId?: string;
}) {
  const { branchId } = requireSingleBranchSqlContext();
  const id = randomUUID();
  await prisma.$executeRaw`
    INSERT INTO payroll_goals (
      id,
      branch_id,
      organization_id,
      employee_id,
      role,
      team_key,
      period_type,
      metric,
      target_value,
      baseline_value,
      stretch_value,
      starts_at,
      ends_at,
      status,
      created_by_id
    )
    VALUES (
      ${id},
      ${branchId},
      ${params.organizationId ?? DEFAULT_PAYROLL_ORG_ID},
      ${params.employeeLogin ? canonicalizeLogin(params.employeeLogin) : null},
      ${params.role ?? null},
      ${params.teamKey ?? null},
      ${params.periodType},
      ${params.metric},
      ${params.targetValue},
      ${params.baselineValue ?? null},
      ${params.stretchValue ?? null},
      ${params.startsAt},
      ${params.endsAt},
      'active',
      ${canonicalizeLogin(params.createdByLogin)}
    )
  `;
  return id;
}

export async function updatePayrollGoal(params: {
  id: string;
  targetValue?: number;
  baselineValue?: number | null;
  stretchValue?: number | null;
  startsAt?: string;
  endsAt?: string;
  status?: string;
}) {
  const { branchId } = requireSingleBranchSqlContext();
  const hasBaselineValue = Object.prototype.hasOwnProperty.call(params, "baselineValue");
  const hasStretchValue = Object.prototype.hasOwnProperty.call(params, "stretchValue");
  await prisma.$executeRaw`
    UPDATE payroll_goals
    SET
      target_value = COALESCE(${params.targetValue ?? null}, target_value),
      baseline_value = CASE WHEN ${hasBaselineValue} THEN ${params.baselineValue ?? null} ELSE baseline_value END,
      stretch_value = CASE WHEN ${hasStretchValue} THEN ${params.stretchValue ?? null} ELSE stretch_value END,
      starts_at = COALESCE(${params.startsAt ?? null}, starts_at),
      ends_at = COALESCE(${params.endsAt ?? null}, ends_at),
      status = COALESCE(${params.status ?? null}, status),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ${params.id}
      AND branch_id = ${branchId}
  `;
}

export async function listEmployeeRecognition(params: {
  employeeLogin: string;
  organizationId?: string;
  limit?: number;
}) {
  try {
    const { branchId } = requireSingleBranchSqlContext();
    const rows = await prisma.$queryRaw<
      Array<{
        id: string;
        organizationId: string;
        employeeLogin: string;
        authorLogin: string;
        title: string;
        message: string;
        reason: string;
        visibility: EmployeeRecognitionRecord["visibility"];
        sourceType: string | null;
        sourceId: string | null;
        createdAt: Date;
      }>
    >`
      SELECT
        id,
        organization_id AS "organizationId",
        employee_id AS "employeeLogin",
        author_id AS "authorLogin",
        title,
        message,
        reason,
        visibility,
        source_type AS "sourceType",
        source_id AS "sourceId",
        created_at AS "createdAt"
      FROM employee_recognitions
      WHERE organization_id = ${params.organizationId ?? DEFAULT_PAYROLL_ORG_ID}
        AND branch_id = ${branchId}
        AND lower(employee_id) = ${normalizeLogin(params.employeeLogin)}
      ORDER BY created_at DESC
      LIMIT ${params.limit ?? 20}
    `;
    return rows.map(mapRecognition);
  } catch (error) {
    if (missingTableFallback(error)) return [];
    throw error;
  }
}

export async function listAllRecognition(organizationId = DEFAULT_PAYROLL_ORG_ID) {
  try {
    const rows = await prisma.$queryRaw<
      Array<{
        id: string;
        organizationId: string;
        employeeLogin: string;
        authorLogin: string;
        title: string;
        message: string;
        reason: string;
        visibility: EmployeeRecognitionRecord["visibility"];
        sourceType: string | null;
        sourceId: string | null;
        createdAt: Date;
      }>
    >`
      SELECT
        id,
        organization_id AS "organizationId",
        employee_id AS "employeeLogin",
        author_id AS "authorLogin",
        title,
        message,
        reason,
        visibility,
        source_type AS "sourceType",
        source_id AS "sourceId",
        created_at AS "createdAt"
      FROM employee_recognitions
      WHERE organization_id = ${organizationId}
      ORDER BY created_at DESC
      LIMIT 50
    `;
    return rows.map(mapRecognition);
  } catch (error) {
    if (missingTableFallback(error)) return [];
    throw error;
  }
}

export async function createEmployeeRecognition(params: {
  employeeLogin: string;
  authorLogin: string;
  title: string;
  message: string;
  reason: string;
  visibility?: "PRIVATE" | "TEAM";
  sourceType?: string | null;
  sourceId?: string | null;
  organizationId?: string;
}) {
  const { branchId } = requireSingleBranchSqlContext();
  const id = randomUUID();
  await prisma.$executeRaw`
    INSERT INTO employee_recognitions (
      id,
      branch_id,
      organization_id,
      employee_id,
      author_id,
      title,
      message,
      reason,
      visibility,
      source_type,
      source_id
    )
    VALUES (
      ${id},
      ${branchId},
      ${params.organizationId ?? DEFAULT_PAYROLL_ORG_ID},
      ${canonicalizeLogin(params.employeeLogin)},
      ${canonicalizeLogin(params.authorLogin)},
      ${params.title},
      ${params.message},
      ${params.reason},
      ${params.visibility ?? "PRIVATE"},
      ${params.sourceType ?? null},
      ${params.sourceId ?? null}
    )
  `;
  return id;
}

export async function getMotivationSettings(params: {
  employeeLogin?: string | null;
  organizationId?: string;
}): Promise<MotivationSettingsRecord | null> {
  try {
    const { branchId } = requireSingleBranchSqlContext();
    const employeeLogin = params.employeeLogin ? canonicalizeLogin(params.employeeLogin) : null;
    const rows = await prisma.$queryRaw<
      Array<{
        id: string;
        organizationId: string;
        employeeLogin: string | null;
        showForecast: boolean;
        showGoals: boolean;
        showAchievements: boolean;
        showTeamProgress: boolean;
        showQuality: boolean;
        showRecognition: boolean;
        notificationsJson: unknown;
        updatedAt: Date;
      }>
    >`
      SELECT
        id,
        organization_id AS "organizationId",
        employee_id AS "employeeLogin",
        show_forecast AS "showForecast",
        show_goals AS "showGoals",
        show_achievements AS "showAchievements",
        show_team_progress AS "showTeamProgress",
        show_quality AS "showQuality",
        show_recognition AS "showRecognition",
        notifications_json AS "notificationsJson",
        updated_at AS "updatedAt"
      FROM employee_motivation_settings
      WHERE organization_id = ${params.organizationId ?? DEFAULT_PAYROLL_ORG_ID}
        AND branch_id = ${branchId}
        AND (employee_id = ${employeeLogin} OR (${employeeLogin} IS NULL AND employee_id IS NULL))
      ORDER BY employee_id NULLS LAST
      LIMIT 1
    `;
    const row = rows[0];
    return row ? { ...row, updatedAt: toIso(row.updatedAt) } : null;
  } catch (error) {
    if (missingTableFallback(error)) return null;
    throw error;
  }
}

export async function upsertMotivationSettings(params: {
  employeeLogin?: string | null;
  showForecast?: boolean;
  showGoals?: boolean;
  showAchievements?: boolean;
  showTeamProgress?: boolean;
  showQuality?: boolean;
  showRecognition?: boolean;
  notificationsJson?: unknown;
  organizationId?: string;
}) {
  const { branchId } = requireSingleBranchSqlContext();
  const id = randomUUID();
  const employeeLogin = params.employeeLogin ? canonicalizeLogin(params.employeeLogin) : null;
  const organizationId = params.organizationId ?? DEFAULT_PAYROLL_ORG_ID;
  const showForecast = params.showForecast ?? true;
  const showGoals = params.showGoals ?? true;
  const showAchievements = params.showAchievements ?? true;
  const showTeamProgress = params.showTeamProgress ?? true;
  const showQuality = params.showQuality ?? true;
  const showRecognition = params.showRecognition ?? true;
  const notificationsJson = JSON.stringify(params.notificationsJson ?? {});

  if (employeeLogin === null) {
    const updated = await prisma.$executeRaw`
      UPDATE employee_motivation_settings
      SET
        show_forecast = ${showForecast},
        show_goals = ${showGoals},
        show_achievements = ${showAchievements},
        show_team_progress = ${showTeamProgress},
        show_quality = ${showQuality},
        show_recognition = ${showRecognition},
        notifications_json = CAST(${notificationsJson} AS jsonb),
        updated_at = CURRENT_TIMESTAMP
      WHERE organization_id = ${organizationId}
        AND branch_id = ${branchId}
        AND employee_id IS NULL
    `;
    if (updated > 0) return;
  }

  await prisma.$executeRaw`
    INSERT INTO employee_motivation_settings (
      id,
      branch_id,
      organization_id,
      employee_id,
      show_forecast,
      show_goals,
      show_achievements,
      show_team_progress,
      show_quality,
      show_recognition,
      notifications_json
    )
    VALUES (
      ${id},
      ${branchId},
      ${organizationId},
      ${employeeLogin},
      ${showForecast},
      ${showGoals},
      ${showAchievements},
      ${showTeamProgress},
      ${showQuality},
      ${showRecognition},
      CAST(${notificationsJson} AS jsonb)
    )
    ON CONFLICT (branch_id, employee_id)
    DO UPDATE SET
      show_forecast = EXCLUDED.show_forecast,
      show_goals = EXCLUDED.show_goals,
      show_achievements = EXCLUDED.show_achievements,
      show_team_progress = EXCLUDED.show_team_progress,
      show_quality = EXCLUDED.show_quality,
      show_recognition = EXCLUDED.show_recognition,
      notifications_json = EXCLUDED.notifications_json,
      updated_at = CURRENT_TIMESTAMP
  `;
}
