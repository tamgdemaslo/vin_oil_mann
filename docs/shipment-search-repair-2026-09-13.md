# Shipment product search repair — 2026-09-13

## Cause

The deployed catalog search selected `local_product_photos.purpose`, but the
production database did not yet have that column. Timeweb application logs
confirmed Prisma error `P2022` in `/api/catalog/search`; a read-only schema query
confirmed the missing column.

## Applied repair

Following explicit owner approval, applied only
`20260912180000_product_photo_purpose` to the Timeweb database at
2026-09-13 11:16:59 UTC. The migration already existed in the repository.
No application deployment was needed.

- Migration SHA-256: `5292d9e809bf2c87d40ba5312e04ffcb147838da45d77ff4a7b5a44ddf144a12`.
- Timeweb backup `103337415`, created 2026-09-13 04:46:52 UTC, was confirmed
  `done` through the provider API. A restore test was not performed.
- Schema changes and the Prisma migration history entry were committed in one
  transaction, with lock and statement timeouts.
- All 83 existing photos were preserved and assigned the default `AVITO`
  purpose. The constraint and index from the migration were applied.
- Other pending migrations were not applied.

## Verification

- `npm run check:timeweb-only` passed.
- The column is present with `NOT NULL` and default `AVITO`; Prisma migration
  history marks the migration completed.
- Six searches using the application catalog search service passed across two
  branches: an existing product name, `масло`, and `MANN` in each branch.
- Live Safari verification on `/shipment/new` returned eight MANN products with
  prices, stock quantities, and Add buttons. No shipment was saved.
- `/api/health/ready` returned `ready`, with all checks passing.
