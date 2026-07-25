# Перенос на Selectel

Этот каталог содержит production-каркас для переноса с Railway:

- `Dockerfile` собирает Next.js, Prisma и Chromium для PDF;
- `docker-compose.selectel.yml` запускает приложение и локальный PostgreSQL;
- `Caddyfile` направляет публичный HTTPS-трафик на приложение;
- `.env.production.template` — непубличный шаблон переменных окружения.

Перед запуском нужно перенести значения production-переменных из Railway в
`.env.production`, сменить `DATABASE_URL` на локальный PostgreSQL и выполнить
контролируемый `pg_dump`/`pg_restore`. Не храните реальный `.env.production` в Git.
