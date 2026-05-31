# MoySklad rollback plan

Generated: 2026-05-31

## Цель

Отключение МойСклад выполняется обратимо: сначала через feature flags, без удаления старого кода интеграции и без автоматического включения write-интеграции при проблемах.

## 1. Backup перед backfill

Перед `backfill` нужен полный backup локальной БД и конфигурации.

```bash
mkdir -p .backups/moysklad-cutover/$(date +%Y%m%d-%H%M%S)
```

DB backup:

```bash
pg_dump "$DATABASE_URL" --format=custom --file ".backups/moysklad-cutover/$(date +%Y%m%d-%H%M%S)/db.dump"
pg_restore --list ".backups/moysklad-cutover/<backup-id>/db.dump" > ".backups/moysklad-cutover/<backup-id>/db.restore-list.txt"
```

Env/config backup:

```bash
cp .env ".backups/moysklad-cutover/<backup-id>/.env" 2>/dev/null || true
cp .env.local ".backups/moysklad-cutover/<backup-id>/.env.local" 2>/dev/null || true
cp .env.example ".backups/moysklad-cutover/<backup-id>/.env.example"
cp .env.local.template ".backups/moysklad-cutover/<backup-id>/.env.local.template"
cp railway.json ".backups/moysklad-cutover/<backup-id>/railway.json" 2>/dev/null || true
cp vercel.json ".backups/moysklad-cutover/<backup-id>/vercel.json" 2>/dev/null || true
```

Production env/config must also be exported from the hosting provider before changing flags. Keep the export together with the DB dump.

## 2. Normal cutover flags

Normal post-cutover runtime:

```dotenv
MOYSKLAD_ENABLED=false
MOYSKLAD_READ_ENABLED=false
MOYSKLAD_WRITE_ENABLED=false
MOYSKLAD_SYNC_ENABLED=false
MOYSKLAD_DEBUG_ENABLED=false
NEXT_PUBLIC_MOYSKLAD_DEBUG_ENABLED=false
```

This keeps ordinary pages on local DB and hides manual/debug integration UI.

## 3. Admin manual sync only

If owner/admin needs a controlled one-off sync window:

```dotenv
MOYSKLAD_ENABLED=true
MOYSKLAD_DEBUG_ENABLED=true
MOYSKLAD_SYNC_ENABLED=true
MOYSKLAD_READ_ENABLED=false
MOYSKLAD_WRITE_ENABLED=false
NEXT_PUBLIC_MOYSKLAD_DEBUG_ENABLED=true
```

Use only `/cabinet/integrations` or CLI audit/backfill/verify commands. Do not expose this as normal UX.

## 4. Read-only rollback profile

If a critical issue appears after cutover and the team needs temporary read-only access to compare or re-import data:

```dotenv
MOYSKLAD_ENABLED=true
MOYSKLAD_DEBUG_ENABLED=true
MOYSKLAD_READ_ENABLED=true
MOYSKLAD_SYNC_ENABLED=true
MOYSKLAD_WRITE_ENABLED=false
NEXT_PUBLIC_MOYSKLAD_DEBUG_ENABLED=true
```

Rules:

- `MOYSKLAD_WRITE_ENABLED` stays `false`.
- Do not create counterparties, demands, supplies, cashouts, product updates or stock movements in МойСклад automatically.
- Use sync only for audit/compare/re-import into local DB.
- Keep ordinary user workflows on local DB while investigating.

## 5. Restore from backup

Restore only if data is corrupted or the local backfill must be reverted.

```bash
createdb vin_oil_restore_check
pg_restore --dbname vin_oil_restore_check ".backups/moysklad-cutover/<backup-id>/db.dump"
```

Validate the restore in a separate database first. Only then restore the production database during a maintenance window.

Production restore outline:

```bash
pg_restore --clean --if-exists --dbname "$DATABASE_URL" ".backups/moysklad-cutover/<backup-id>/db.dump"
```

After restore:

```bash
node_modules/.bin/prisma generate
node_modules/.bin/tsc --noEmit
node scripts/sync-moysklad-last-days.mjs --days=14 --mode=audit
```

## 6. Code retention and cleanup

- Do not delete old MoySklad integration code before final verify and smoke tests.
- First disable through flags.
- Keep legacy fields for audit/rollback.
- Cleanup/removal is allowed only after stable local-only operation and a closed rollback window.

## 7. Incident flow

1. Freeze user-impacting changes.
2. Keep `MOYSKLAD_WRITE_ENABLED=false`.
3. Enable read-only rollback profile if comparison/re-import is needed.
4. Run `node scripts/sync-moysklad-last-days.mjs --days=14 --mode=audit`.
5. If needed, run `backfill` only after DB backup is confirmed.
6. If local data is corrupted, restore from backup after validating the dump in a separate DB.
7. Return to normal cutover flags after the incident is resolved.

## 8. Rollback acceptance

- Backup dump exists and `pg_restore --list` succeeds.
- Env/config backup exists.
- Read-only rollback profile is documented and available.
- Write integration remains disabled during rollback.
- Old integration code is retained until stable verification is complete.
