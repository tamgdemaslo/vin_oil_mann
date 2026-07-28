# Перенос на Selectel

Этот каталог содержит production-каркас для переноса с Railway:

- `Dockerfile` собирает Next.js, Prisma и Chromium для PDF;
- `docker-compose.selectel.yml` запускает приложение и локальный PostgreSQL;
- `Caddyfile` направляет публичный HTTPS-трафик на приложение;
- `.env.production.template` — непубличный шаблон переменных окружения.

Для вывода через WireGuard только Telegram и OpenAI используйте дополнительный
файл `docker-compose.selectel.wireguard.yml`. Подготовка клиентского конфига и
проверка приведены в
[`wireguard/README.md`](wireguard/README.md). Базовый compose-файл остаётся
вариантом без VPN.

Миграция текущих данных в Branch 1 выполняется только по
[`BRANCH_MIGRATION_RUNBOOK.md`](BRANCH_MIGRATION_RUNBOOK.md) после закрытия
зафиксированных блокеров филиальной изоляции.

Для будущего production-copy rehearsal используйте отдельный
`.env.branch-rehearsal.template` и `prepare-branch-rehearsal.sh`. Скрипт принимает
только уже одобренный backup, восстанавливает его в пустую БД с `rehearsal` в
имени и не умеет брать dump из production/Railway. План восстановления и
критерии проверки находятся в `BRANCH_ROLLBACK_RUNBOOK.md`.

Перед запуском нужно перенести значения production-переменных из Railway в
`.env.production`, сменить `DATABASE_URL` на локальный PostgreSQL и выполнить
контролируемый `pg_dump`/`pg_restore`. Не храните реальный `.env.production` в Git.
