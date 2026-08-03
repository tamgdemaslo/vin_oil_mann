CREATE TABLE IF NOT EXISTS payroll_goals (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL DEFAULT 'default',
  employee_id TEXT,
  role TEXT,
  team_key TEXT,
  period_type TEXT NOT NULL,
  metric TEXT NOT NULL,
  target_value INTEGER NOT NULL,
  baseline_value INTEGER,
  stretch_value INTEGER,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_by_id TEXT NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS payroll_goals_org_employee_idx ON payroll_goals (organization_id, employee_id);
CREATE INDEX IF NOT EXISTS payroll_goals_org_role_idx ON payroll_goals (organization_id, role);
CREATE INDEX IF NOT EXISTS payroll_goals_org_period_idx ON payroll_goals (organization_id, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS payroll_achievement_definitions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL DEFAULT 'default',
  key TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  icon TEXT,
  metric TEXT NOT NULL,
  threshold INTEGER NOT NULL,
  period_type TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  repeatable BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT payroll_achievement_definitions_org_key_unique UNIQUE (organization_id, key)
);

CREATE TABLE IF NOT EXISTS payroll_achievement_awards (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL DEFAULT 'default',
  definition_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  source_id TEXT,
  awarded_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TIMESTAMP(3),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS payroll_achievement_awards_org_employee_idx ON payroll_achievement_awards (organization_id, employee_id);
CREATE INDEX IF NOT EXISTS payroll_achievement_awards_definition_idx ON payroll_achievement_awards (definition_id);

CREATE TABLE IF NOT EXISTS employee_recognitions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL DEFAULT 'default',
  employee_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  reason TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'PRIVATE',
  source_type TEXT,
  source_id TEXT,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS employee_recognitions_org_employee_idx ON employee_recognitions (organization_id, employee_id);
CREATE INDEX IF NOT EXISTS employee_recognitions_org_created_idx ON employee_recognitions (organization_id, created_at);

CREATE TABLE IF NOT EXISTS payroll_team_goals (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL DEFAULT 'default',
  team_key TEXT NOT NULL,
  employee_ids_json JSONB NOT NULL,
  metric TEXT NOT NULL,
  target_value INTEGER NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_by_id TEXT NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS payroll_team_goals_org_team_idx ON payroll_team_goals (organization_id, team_key);
CREATE INDEX IF NOT EXISTS payroll_team_goals_org_period_idx ON payroll_team_goals (organization_id, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS employee_motivation_settings (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL DEFAULT 'default',
  employee_id TEXT,
  show_forecast BOOLEAN NOT NULL DEFAULT true,
  show_goals BOOLEAN NOT NULL DEFAULT true,
  show_achievements BOOLEAN NOT NULL DEFAULT true,
  show_team_progress BOOLEAN NOT NULL DEFAULT true,
  show_quality BOOLEAN NOT NULL DEFAULT true,
  show_recognition BOOLEAN NOT NULL DEFAULT true,
  notifications_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT employee_motivation_settings_org_employee_unique UNIQUE (organization_id, employee_id)
);
