# MoySklad legacy fields retention

Generated: 2026-05-31

## Decision

Legacy MoySklad fields are retained after the local DB cutover. They are audit metadata only and must not be required for normal local create/edit flows.

## Why Keep Them

- Audit and final data comparison.
- Historical traceability for imported rows.
- One-off manual recovery if rollback or reconciliation is needed.
- Manual review of records that cannot be safely imported automatically.

## Fields To Keep

- `moyskladId`
- `moyskladHref`
- `moyskladMetaHref`
- `externalCode`
- `source`
- `syncedAt`
- `syncStatus`
- `syncError`

## Schema Status

| Area | Status |
| --- | --- |
| Organizations, stores, products, counterparties, demands | Existing MoySklad ids/hrefs are retained and non-blocking; existing `syncedAt` defaults do not require user input. |
| Cash expense orders | Added nullable generic `moyskladId`, `moyskladHref`, `moyskladMetaHref`, `externalCode`, `syncedAt`, `syncStatus`, `syncError`; existing specific href fields remain. |
| Receipts/writeoffs | Added nullable legacy fields to `LocalInventoryDocument` and `LocalInventoryDocumentPosition`; `source` defaults to `local`. |
| Supplier invoices | Added nullable legacy fields to `LocalSupplierInvoice`; `source` remains defaulted and non-blocking. |
| Supplier invoice payments | Added nullable legacy fields to `LocalSupplierInvoicePayment`; `source` defaults to `local`. |

## Non-Blocking Rule

New local documents must be creatable without `moyskladId`, `moyskladHref`, `moyskladMetaHref`, `externalCode`, `syncedAt`, `syncStatus`, or `syncError`.

`source` may be non-null only when it has a local default and is not required from the UI/API caller.

## Migration

`prisma/migrations/20260528170000_keep_nullable_legacy_fields/migration.sql`

This migration only adds nullable/defaulted metadata columns and indexes. It does not delete data, change local business fields, or require MoySklad fields for local operations.
