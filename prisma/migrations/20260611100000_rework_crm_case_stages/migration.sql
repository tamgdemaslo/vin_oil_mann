INSERT INTO "crm_stages" ("id", "name", "sort_order", "color", "created_at", "updated_at")
VALUES
  ('crm_stage_control_after_visit', 'Контроль после визита', 90, 'blue', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('crm_stage_closed_100', 'Закрыто', 100, 'emerald', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("sort_order") DO UPDATE
SET "name" = EXCLUDED."name",
    "color" = EXCLUDED."color",
    "updated_at" = CURRENT_TIMESTAMP;

UPDATE "crm_deals"
SET "stage_id" = (SELECT "id" FROM "crm_stages" WHERE "sort_order" = 100 LIMIT 1),
    "updated_at" = CURRENT_TIMESTAMP
WHERE "stage_id" IN (SELECT "id" FROM "crm_stages" WHERE "sort_order" = 80)
  AND "status" <> 'open';

UPDATE "crm_stages" SET "name" = 'Новый запрос', "color" = 'sky', "updated_at" = CURRENT_TIMESTAMP WHERE "sort_order" = 10;
UPDATE "crm_stages" SET "name" = 'Уточнить данные', "color" = 'blue', "updated_at" = CURRENT_TIMESTAMP WHERE "sort_order" = 20;
UPDATE "crm_stages" SET "name" = 'Рассчитать', "color" = 'amber', "updated_at" = CURRENT_TIMESTAMP WHERE "sort_order" = 30;
UPDATE "crm_stages" SET "name" = 'Расчёт отправлен', "color" = 'sky', "updated_at" = CURRENT_TIMESTAMP WHERE "sort_order" = 40;
UPDATE "crm_stages" SET "name" = 'Проверить расходники', "color" = 'orange', "updated_at" = CURRENT_TIMESTAMP WHERE "sort_order" = 50;
UPDATE "crm_stages" SET "name" = 'Ждём расходники', "color" = 'orange', "updated_at" = CURRENT_TIMESTAMP WHERE "sort_order" = 60;
UPDATE "crm_stages" SET "name" = 'Запись создана', "color" = 'violet', "updated_at" = CURRENT_TIMESTAMP WHERE "sort_order" = 70;
UPDATE "crm_stages" SET "name" = 'На визите / в документе', "color" = 'zinc', "updated_at" = CURRENT_TIMESTAMP WHERE "sort_order" = 80;
