ALTER TABLE "local_products"
ADD COLUMN "pricing_mode" TEXT NOT NULL DEFAULT 'fixed';

ALTER TABLE "ai_assistant_quotes"
ADD COLUMN "applied_rule_id" TEXT,
ADD COLUMN "applied_rule_snapshot_json" JSONB NOT NULL DEFAULT '{}';

-- These cards stay available for duration/documents, but their mutable retail
-- price must not participate in assistant calculations.
UPDATE "local_products"
SET "pricing_mode" = 'assistant_rule'
WHERE "entity_type" = 'service'
  AND (
    "name" ILIKE '%замена моторного масла%'
    OR "name" ILIKE '%замена масла акпп%'
    OR "name" ILIKE '%замена масла cvt%'
    OR "name" ILIKE '%обслуживание акпп%'
    OR "name" ILIKE '%обслуживание вариатора%'
  );

UPDATE "local_products"
SET "pricing_mode" = 'individual'
WHERE "entity_type" = 'service'
  AND ("name" ILIKE '%замена воздушного фильтра%' OR "name" ILIKE '%замена салонного фильтра%');

CREATE TABLE "ai_assistant_labor_pricing_rules" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL DEFAULT 'default',
    "location_id" TEXT NOT NULL DEFAULT 'dachnaya',
    "service_family" TEXT NOT NULL,
    "procedure_type" TEXT NOT NULL,
    "transmission_configuration" TEXT,
    "materials_owner" TEXT,
    "vehicle_id" TEXT,
    "aggregate_code" TEXT,
    "name" TEXT NOT NULL,
    "labor_price_cents" INTEGER NOT NULL,
    "price_from_cents" INTEGER,
    "price_to_cents" INTEGER,
    "requires_human_confirmation" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "effective_from" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effective_to" TIMESTAMPTZ(6),
    "comment" TEXT,
    "created_by_id" TEXT,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_assistant_labor_pricing_rules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_assistant_labor_pricing_rules_organization_id_location_id_active_effective_from_effective_to_idx"
ON "ai_assistant_labor_pricing_rules"("organization_id", "location_id", "active", "effective_from", "effective_to");

CREATE INDEX "ai_assistant_labor_pricing_rules_organization_id_vehicle_id_aggregate_code_idx"
ON "ai_assistant_labor_pricing_rules"("organization_id", "vehicle_id", "aggregate_code");

CREATE INDEX "ai_assistant_labor_pricing_rules_organization_id_service_family_procedure_type_transmission_configuration_materials_owner_idx"
ON "ai_assistant_labor_pricing_rules"("organization_id", "service_family", "procedure_type", "transmission_configuration", "materials_owner");

CREATE TABLE "vehicle_service_complexity_rules" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL DEFAULT 'default',
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "generation" TEXT,
    "year_from" INTEGER,
    "year_to" INTEGER,
    "engine_code" TEXT,
    "service_type" TEXT NOT NULL,
    "complexity" TEXT NOT NULL,
    "labor_price_cents" INTEGER NOT NULL,
    "source" TEXT,
    "confirmed_by_id" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "vehicle_service_complexity_rules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "vehicle_service_complexity_rules_organization_id_make_model_service_type_active_idx"
ON "vehicle_service_complexity_rules"("organization_id", "make", "model", "service_type", "active");

INSERT INTO "ai_assistant_labor_pricing_rules"
  ("id", "organization_id", "location_id", "service_family", "procedure_type", "transmission_configuration", "materials_owner", "name", "labor_price_cents", "price_from_cents", "price_to_cents", "requires_human_confirmation", "comment", "created_by_id", "updated_by_id")
VALUES
  ('seed-labor-engine-service-dachnaya', 'default', 'dachnaya', 'engine_oil', 'oil_change', NULL, 'service', 'Замена моторного масла — масло сервиса', 0, NULL, NULL, false, 'Работа бесплатна при покупке основного объёма масла у сервиса.', 'system', 'system'),
  ('seed-labor-engine-customer-dachnaya', 'default', 'dachnaya', 'engine_oil', 'oil_change', NULL, 'customer', 'Замена моторного масла — масло клиента', 150000, NULL, NULL, false, 'Применяется только при явно указанном масле клиента.', 'system', 'system'),
  ('seed-labor-atf-partial-no-pan-service-dachnaya', 'default', 'dachnaya', 'transmission_fluid', 'partial', 'no_pan', 'service', 'АКПП: частичная замена без поддона — масло сервиса', 400000, NULL, NULL, false, NULL, 'system', 'system'),
  ('seed-labor-atf-partial-no-pan-customer-dachnaya', 'default', 'dachnaya', 'transmission_fluid', 'partial', 'no_pan', 'customer', 'АКПП: частичная замена без поддона — масло клиента', 600000, NULL, NULL, false, NULL, 'system', 'system'),
  ('seed-labor-atf-machine-no-pan-service-dachnaya', 'default', 'dachnaya', 'transmission_fluid', 'machine', 'no_pan', 'service', 'АКПП: аппаратная замена без поддона — масло сервиса', 500000, NULL, NULL, false, NULL, 'system', 'system'),
  ('seed-labor-atf-machine-no-pan-customer-dachnaya', 'default', 'dachnaya', 'transmission_fluid', 'machine', 'no_pan', 'customer', 'АКПП: аппаратная замена без поддона — масло клиента', 800000, NULL, NULL, false, NULL, 'system', 'system'),
  ('seed-labor-atf-partial-pan-service-dachnaya', 'default', 'dachnaya', 'transmission_fluid', 'partial', 'pan_and_filter', 'service', 'АКПП: частичная замена с поддоном и фильтром — масло сервиса', 500000, NULL, NULL, false, NULL, 'system', 'system'),
  ('seed-labor-atf-partial-pan-customer-dachnaya', 'default', 'dachnaya', 'transmission_fluid', 'partial', 'pan_and_filter', 'customer', 'АКПП: частичная замена с поддоном и фильтром — масло клиента', 1000000, NULL, NULL, false, NULL, 'system', 'system'),
  ('seed-labor-atf-machine-pan-service-dachnaya', 'default', 'dachnaya', 'transmission_fluid', 'machine', 'pan_and_filter', 'service', 'АКПП: аппаратная замена с поддоном и фильтром — масло сервиса', 600000, NULL, NULL, false, NULL, 'system', 'system'),
  ('seed-labor-atf-machine-pan-customer-dachnaya', 'default', 'dachnaya', 'transmission_fluid', 'machine', 'pan_and_filter', 'customer', 'АКПП: аппаратная замена с поддоном и фильтром — масло клиента', 1200000, NULL, NULL, false, NULL, 'system', 'system'),
  ('seed-labor-atf-partial-two-filters-service-dachnaya', 'default', 'dachnaya', 'transmission_fluid', 'partial', 'two_coarse_filters', 'service', 'АКПП/CVT: два фильтра грубой очистки, частичная — масло сервиса', 600000, NULL, NULL, false, NULL, 'system', 'system'),
  ('seed-labor-atf-partial-two-filters-customer-dachnaya', 'default', 'dachnaya', 'transmission_fluid', 'partial', 'two_coarse_filters', 'customer', 'АКПП/CVT: два фильтра грубой очистки, частичная — масло клиента', 1200000, NULL, NULL, false, NULL, 'system', 'system'),
  ('seed-labor-atf-machine-two-filters-service-dachnaya', 'default', 'dachnaya', 'transmission_fluid', 'machine', 'two_coarse_filters', 'service', 'АКПП/CVT: два фильтра грубой очистки, аппаратная — масло сервиса', 700000, NULL, NULL, false, NULL, 'system', 'system'),
  ('seed-labor-atf-machine-two-filters-customer-dachnaya', 'default', 'dachnaya', 'transmission_fluid', 'machine', 'two_coarse_filters', 'customer', 'АКПП/CVT: два фильтра грубой очистки, аппаратная — масло клиента', 1400000, NULL, NULL, false, NULL, 'system', 'system'),
  ('seed-labor-air-filter-range-dachnaya', 'default', 'dachnaya', 'air_filter', 'replace', NULL, NULL, 'Воздушный фильтр — диапазон без подтверждённой сложности', 20000, 20000, 80000, true, 'Точную цену выбирает сотрудник после оценки доступа.', 'system', 'system'),
  ('seed-labor-cabin-filter-range-dachnaya', 'default', 'dachnaya', 'cabin_filter', 'replace', NULL, NULL, 'Салонный фильтр — диапазон без подтверждённой сложности', 20000, 20000, 80000, true, 'Точную цену выбирает сотрудник после оценки доступа.', 'system', 'system');
