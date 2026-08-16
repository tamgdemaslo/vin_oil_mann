-- Own branch-scoped booking system. This migration is intentionally not
-- executed by application startup; deploy only after an approved Timeweb backup.

CREATE UNIQUE INDEX "branch_memberships_branch_id_id_key"
ON "branch_memberships"("branch_id", "id");

CREATE TABLE "branch_booking_settings" (
    "id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "public_booking_enabled" BOOLEAN NOT NULL DEFAULT false,
    "public_name" TEXT,
    "public_intro" TEXT,
    "booking_step_minutes" INTEGER NOT NULL DEFAULT 30,
    "booking_horizon_days" INTEGER NOT NULL DEFAULT 60,
    "minimum_lead_minutes" INTEGER NOT NULL DEFAULT 60,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "branch_booking_settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "branch_booking_working_hours" (
    "id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "is_working" BOOLEAN NOT NULL DEFAULT true,
    "start_time" TEXT,
    "end_time" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "branch_booking_working_hours_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "booking_services" (
    "id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "duration_minutes" INTEGER NOT NULL,
    "online_booking_enabled" BOOLEAN NOT NULL DEFAULT false,
    "requires_vin" BOOLEAN NOT NULL DEFAULT false,
    "requires_confirmation" BOOLEAN NOT NULL DEFAULT false,
    "required_fields_json" JSONB NOT NULL DEFAULT '[]',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "booking_services_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "booking_master_services" (
    "id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "membership_id" TEXT NOT NULL,
    "service_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "booking_master_services_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "booking_master_working_hours" (
    "id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "membership_id" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "is_working" BOOLEAN NOT NULL DEFAULT true,
    "start_time" TEXT,
    "end_time" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "booking_master_working_hours_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "booking_schedule_exceptions" (
    "id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "membership_id" TEXT NOT NULL,
    "local_date" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'CLOSED',
    "start_time" TEXT,
    "end_time" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "booking_schedule_exceptions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "client_vehicles" (
    "id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "counterparty_id" TEXT NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "generation" TEXT,
    "year" INTEGER,
    "plate" TEXT,
    "vin" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "client_vehicles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "bookings" (
    "id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "client_id" TEXT,
    "vehicle_id" TEXT,
    "master_membership_id" TEXT,
    "customer_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "normalized_phone" TEXT NOT NULL,
    "email" TEXT,
    "vehicle_snapshot" JSONB NOT NULL DEFAULT '{}',
    "vin" TEXT,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'ADMIN',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "requires_confirmation" BOOLEAN NOT NULL DEFAULT false,
    "confirmation_state" TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
    "comment" TEXT,
    "internal_comment" TEXT,
    "conflict_override" BOOLEAN NOT NULL DEFAULT false,
    "management_handle" TEXT NOT NULL,
    "management_token_version" INTEGER NOT NULL DEFAULT 1,
    "legacy_external_id" TEXT,
    "created_by_user_id" TEXT,
    "cancelled_at" TIMESTAMPTZ(6),
    "cancelled_by" TEXT,
    "cancellation_reason" TEXT,
    "confirmed_at" TIMESTAMPTZ(6),
    "confirmed_by" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "booking_service_items" (
    "id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "service_id" TEXT,
    "service_name_snapshot" TEXT NOT NULL,
    "duration_minutes_snapshot" INTEGER NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "booking_service_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "branch_booking_settings_branch_id_key" ON "branch_booking_settings"("branch_id");
CREATE UNIQUE INDEX "branch_booking_working_hours_branch_id_weekday_key" ON "branch_booking_working_hours"("branch_id", "weekday");
CREATE INDEX "branch_booking_working_hours_branch_id_is_working_idx" ON "branch_booking_working_hours"("branch_id", "is_working");
CREATE UNIQUE INDEX "booking_services_branch_id_id_key" ON "booking_services"("branch_id", "id");
CREATE INDEX "booking_services_branch_id_status_sort_order_idx" ON "booking_services"("branch_id", "status", "sort_order");
CREATE INDEX "booking_services_branch_id_online_booking_enabled_status_idx" ON "booking_services"("branch_id", "online_booking_enabled", "status");
CREATE UNIQUE INDEX "booking_master_services_membership_id_service_id_key" ON "booking_master_services"("membership_id", "service_id");
CREATE INDEX "booking_master_services_branch_id_service_id_idx" ON "booking_master_services"("branch_id", "service_id");
CREATE INDEX "booking_master_services_branch_id_membership_id_idx" ON "booking_master_services"("branch_id", "membership_id");
CREATE UNIQUE INDEX "booking_master_working_hours_membership_id_weekday_key" ON "booking_master_working_hours"("membership_id", "weekday");
CREATE INDEX "booking_master_working_hours_branch_id_weekday_is_working_idx" ON "booking_master_working_hours"("branch_id", "weekday", "is_working");
CREATE UNIQUE INDEX "booking_schedule_exceptions_membership_id_local_date_key" ON "booking_schedule_exceptions"("membership_id", "local_date");
CREATE INDEX "booking_schedule_exceptions_branch_id_local_date_idx" ON "booking_schedule_exceptions"("branch_id", "local_date");
CREATE UNIQUE INDEX "client_vehicles_branch_id_id_key" ON "client_vehicles"("branch_id", "id");
CREATE INDEX "client_vehicles_branch_id_counterparty_id_status_idx" ON "client_vehicles"("branch_id", "counterparty_id", "status");
CREATE INDEX "client_vehicles_branch_id_vin_idx" ON "client_vehicles"("branch_id", "vin");
CREATE INDEX "client_vehicles_branch_id_plate_idx" ON "client_vehicles"("branch_id", "plate");
CREATE UNIQUE INDEX "bookings_management_handle_key" ON "bookings"("management_handle");
CREATE UNIQUE INDEX "bookings_branch_id_id_key" ON "bookings"("branch_id", "id");
CREATE UNIQUE INDEX "bookings_branch_id_legacy_external_id_key" ON "bookings"("branch_id", "legacy_external_id");
CREATE INDEX "bookings_branch_id_starts_at_ends_at_idx" ON "bookings"("branch_id", "starts_at", "ends_at");
CREATE INDEX "bookings_branch_id_master_membership_id_status_starts_at_idx" ON "bookings"("branch_id", "master_membership_id", "status", "starts_at");
CREATE INDEX "bookings_branch_id_normalized_phone_starts_at_idx" ON "bookings"("branch_id", "normalized_phone", "starts_at");
CREATE INDEX "bookings_branch_id_client_id_starts_at_idx" ON "bookings"("branch_id", "client_id", "starts_at");
CREATE INDEX "booking_service_items_branch_id_booking_id_sort_order_idx" ON "booking_service_items"("branch_id", "booking_id", "sort_order");
CREATE INDEX "booking_service_items_branch_id_service_id_idx" ON "booking_service_items"("branch_id", "service_id");

ALTER TABLE "branch_booking_settings" ADD FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "branch_booking_working_hours" ADD FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "booking_services" ADD FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "booking_master_services" ADD FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "booking_master_services" ADD FOREIGN KEY ("branch_id", "membership_id") REFERENCES "branch_memberships"("branch_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "booking_master_services" ADD FOREIGN KEY ("branch_id", "service_id") REFERENCES "booking_services"("branch_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "booking_master_working_hours" ADD FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "booking_master_working_hours" ADD FOREIGN KEY ("branch_id", "membership_id") REFERENCES "branch_memberships"("branch_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "booking_schedule_exceptions" ADD FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "booking_schedule_exceptions" ADD FOREIGN KEY ("branch_id", "membership_id") REFERENCES "branch_memberships"("branch_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "client_vehicles" ADD FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "client_vehicles" ADD FOREIGN KEY ("branch_id", "counterparty_id") REFERENCES "local_counterparties"("branch_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bookings" ADD FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bookings" ADD FOREIGN KEY ("branch_id", "client_id") REFERENCES "local_counterparties"("branch_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bookings" ADD FOREIGN KEY ("branch_id", "vehicle_id") REFERENCES "client_vehicles"("branch_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bookings" ADD FOREIGN KEY ("branch_id", "master_membership_id") REFERENCES "branch_memberships"("branch_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "booking_service_items" ADD FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "booking_service_items" ADD FOREIGN KEY ("branch_id", "booking_id") REFERENCES "bookings"("branch_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "booking_service_items" ADD FOREIGN KEY ("branch_id", "service_id") REFERENCES "booking_services"("branch_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Existing notification infrastructure is reused for local booking events.
UPDATE "notification_rules"
SET "enabled" = true, "updated_at" = CURRENT_TIMESTAMP
WHERE "event_type" IN ('appointment_rescheduled', 'appointment_cancelled');

INSERT INTO "notification_templates"
    ("id", "branch_id", "organization_id", "name", "event_type", "channel", "body", "is_active", "status", "metadata_json", "created_at", "updated_at")
SELECT
    'booking-confirmed:template:' || b."id",
    b."id",
    COALESCE(b."legacy_organization_id", b."id"),
    'Запись подтверждена',
    'appointment_confirmed',
    'telegram',
    '{{#clientName}}Здравствуйте, {{clientName}}!{{/clientName}}{{^clientName}}Здравствуйте!{{/clientName}}' || E'\n' ||
      'Подтверждаем вашу запись на {{appointmentDate}} в {{appointmentTime}}.' ||
      '{{#vehicleDisplayName}}' || E'\n🚗 ' || '{{vehicleDisplayName}}{{/vehicleDisplayName}}',
    true,
    'active',
    '{}',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "branches" b
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "notification_rules"
    ("id", "branch_id", "organization_id", "event_type", "enabled", "channel", "template_id", "timing_type", "offset_minutes", "conditions_json", "created_at", "updated_at")
SELECT
    'booking-confirmed:rule:' || b."id",
    b."id",
    COALESCE(b."legacy_organization_id", b."id"),
    'appointment_confirmed',
    true,
    'telegram',
    'booking-confirmed:template:' || b."id",
    'immediate',
    NULL,
    '{"requireTelegram":true,"requireConsent":true,"preventDuplicates":true,"skipCancelled":true}',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "branches" b
ON CONFLICT ("id") DO NOTHING;
