# Branch migration rollback rehearsal

Статус: **PREPARED, NOT VERIFIED**. Rollback нельзя считать готовым, пока restore реально не выполнен и не измерен на отдельной тестовой копии Selectel. Railway не является rollback target.

## Критерии rollback

Rollback объявляет migration owner при любом из условий: migration/precheck завершился ошибкой; post-migration SQL нашёл NULL/cross-branch/duplicate; login или branch selector недоступны; критичный read/write smoke test падает; worker обрабатывает чужой branch; внешний side effect произошёл в rehearsal; p95/ошибки вышли за согласованный порог; сверка контрольных сумм не совпала.

## До окна

- Зафиксировать migration owner, rollback owner и канал связи.
- Иметь custom-format backup с timestamp, SHA-256, размером и подтверждённым `pg_restore --list`.
- Подготовить новый пустой Selectel database с именем, содержащим `rollback_rehearsal`.
- Сохранить старый release image/tag и его schema migration state (`_prisma_migrations`).
- Оценка RTO остаётся `UNKNOWN` до замера полного restore; целевой RPO равен началу maintenance window.

## Остановка

1. Включить maintenance/read-only на web.
2. Остановить cron, messenger media worker и все queue consumers.
3. Убедиться, что active jobs/transactions завершились; не убивать PostgreSQL вслепую.
4. Не менять DNS, Telegram webhook или T-Bank callback. Декомиссионированная
   legacy-платформа не является rollback target.

Команды зависят от текущего Selectel compose/release и выполняются только в утверждённом окне. Перед каждой командой оператор фиксирует точное имя сервиса; wildcard и массовое удаление запрещены.

## Restore rehearsal

```bash
export APP_ENV=branch-migration-rehearsal
export DEPLOYMENT_PROVIDER=selectel-rehearsal
export EXTERNAL_SIDE_EFFECTS_ENABLED=false
export DATABASE_URL='postgresql://.../eco_branch_rollback_rehearsal'
pg_restore --exit-on-error --no-owner --no-privileges --dbname "$DATABASE_URL" approved-pre-migration.dump
psql "$DATABASE_URL" --set ON_ERROR_STOP=1 -c 'SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at DESC NULLS LAST LIMIT 20'
```

Restore выполняется только в заранее созданную пустую rehearsal DB. `--clean`, `dropdb` и перезапись существующей DB в restore-команде не используются.

## Переключение DATABASE_URL

1. Создать новый release с URL восстановленной DB; не редактировать секрет работающего release без журнала.
2. Сначала поднять один web instance с workers/cron выключенными и всеми side-effect flags `false`.
3. Проверить hostname/database name без вывода пароля.
4. После smoke tests переключить оставшийся web traffic штатным механизмом Selectel.

## Проверки после restore

- Web: health, login, branch selector, client/product/store/shipment read, разрешённая тестовая запись и её rollback.
- Workers: запуск одного consumer с тестовым branch payload; отсутствие foreign-branch claim.
- Telegram: webhook **не менять**; при `TELEGRAM_SEND_ENABLED=false` тест отправки обязан быть заблокирован кодом.
- Данные: row counts, суммы по отгрузкам/кассе/зарплате, последние timestamps, `_prisma_migrations`, FK/unique checks и выборочная сверка файлов.
- Интеграции: credentials читаются только для активного branch; YCLIENTS/MoySklad/ROSSKO mutations остаются false.

## Возврат сервиса

Workers включаются по одному только после успешной проверки web и данных. Внешние mutation flags включаются отдельно, с записью времени и ответственного. Branch 2 остаётся выключенным.

## Cleanup rehearsal

Cleanup разрешён после сохранения протокола, checksum и timings. Сначала
read-only проверить точное имя/host; затем отдельным одобренным действием
удалить **только** rehearsal database. Production, offline archive и
действующий Selectel rollback target не удалять.

## Протокол времени

Записать: stop-writes, restore-start, restore-finish, web-ready, data-verified, workers-ready, decision. Итоговые `restore duration`, `RTO`, `RPO` и объём backup добавить в evidence-файл. До этого rollback status — `NOT VERIFIED`.
