# Подготовлен переход на один общий комплект

Новая реализация и согласуемая миграция описаны в
[shared-product-kits-2026-10-31.md](shared-product-kits-2026-10-31.md).
Они ожидают отдельного подтверждения переноса рабочей базы.

Ниже сохранено описание прежней филиальной модели и истории её проверок.

# Internal product kits

Kits are reusable, branch-scoped compositions of existing catalog products and quantities.
They are managed in `/inventory/products?tab=kits`; stock targets are managed in
`/inventory/restock?tab=kits`. They are not published to the storefront.

The catalog defaults to a shared list across the user's accessible branches in
the current business group. Each kit shows its owning branch and independently
calculated availability on each active warehouse of that branch. A branch filter
narrows the shared list without switching the active branch. Kits with no active
warehouse remain visible. Same-named kits keep their own composition and identity.
The list never infers matching products or pools stock across warehouses.

`GET /api/product-kits/network` derives the readable scope from verified branch
membership and runs explicit branch-filtered queries in a read-only aggregate
context. It accepts neither caller-supplied access scope nor cross-branch writes.
Editing and archiving remain in the active owning branch; other rows offer an
explicit branch switch. Product links in another branch switch to that branch
before opening the card. Shipment selection and restock operations retain their
concrete branch and warehouse context. No schema migration or data transfer is
required for the shared catalog.

## Behaviour

- Name and a fixed composition; 1–100 distinct active products, quantities from
  0.001 to 1,000,000 in the product's own stock unit. No nesting or services.
- The kit price is the sum of current component sale prices, rounded per line to
  cents, matching shipment totals. An existing shipment line retains its price
  and discount when quantities are merged.
- Available complete kits are the minimum of `floor(free stock / required quantity)`
  across components on the selected store. Calculations use integer thousandths.
  Zero available complete kits with some free components is "Частично";
  no free components is "Нет в наличии". Archived components block availability
  and require editing the kit before it can be added to a shipment.
- Each kit's availability is independent. No product reservations are created.
- Each kit/store has its own integer target, default zero (not configured).
  The screen shows shortage for both the next complete kit and the full target.
  Shared components are not allocated between different kits or targets.
- Adding a kit refreshes its composition, prices and stock, then expands the
  entire composition into ordinary shipment rows, including out-of-stock products.
  Matching assortment metadata merges quantities. Existing shipment stock checks
  mark shortages; existing posting restrictions continue to apply.
- Kit identity is not persisted on shipment rows or printed documents. Later
  composition changes do not modify existing shipments.
- Archive/restore is reversible. Composition saves use optimistic version checks
  to reject concurrent changes instead of overwriting them.
- Expanded kits show unit sale prices, rounded line totals, a parts subtotal and
  product links that open the catalog card in a separate tab.
- The client quote includes component quantities and prices, optional labor and
  the combined total, with a copy button and manual selection fallback. Labor is
  kept per kit while the workspace is open (including collapse/reopen), not saved
  to the catalog. Empty labor is explicitly unpriced; zero means free work.
  Invalid labor disables copying; archived kits or blocked components require
  composition review before a client quote is offered.

## Database migration and release

Migration: `prisma/migrations/20261019140000_add_product_kits/migration.sql`.
It adds `product_kits`, `product_kit_items`, and `product_kit_stock_targets`.
It does not rewrite products, balances, or shipments. Composite foreign keys
enforce branch boundaries, unique constraints prevent duplicate component rows,
and CHECK constraints enforce quantity/name limits.

Per `AGENTS.md` and `deploy/timeweb/README.md`, production schema changes require
separate migration approval and a verified Timeweb backup before migration or
promotion to `main`. Startup never applies migrations. Do not deploy code requiring
these tables before the approved migration has completed. A rollback can revert
the application code and keep the added tables and kit data intact.

## Verification

- `npm run test:product-kits`: quantities, price totals, shortage calculations,
  independent availability, shipment merging, validation, client quote rounding,
  labor input and branch query policy.
- `DATABASE_URL=postgresql://<local-user>@127.0.0.1/eco_kits_test_<suffix> node scripts/test-product-kits-db.mjs`:
  integration tests and synthetic preview fixtures. This command refuses nonlocal
  hosts and databases outside the `eco_kits_test_*` prefix. It deletes and recreates
  kit fixtures only inside that explicitly isolated test database.
- For migration rehearsal, prepare the isolated database from the original
  schema first, then apply this migration transactionally with `psql -1 -v
  ON_ERROR_STOP=1 -f .../migration.sql`. Run the database test only afterward.
- The local 2026-10-19 rehearsal applied the original schema followed by this
  migration and verified targets per store, archived products, archive/restore,
  failed updates, concurrent composition edits and cross-branch foreign keys.

The browser preview uses synthetic products and a synthetic branch in the isolated
local database. No production database migration has been applied.

The 2026-10-19 browser check covered creation with 0.5 litres, target changes with
recalculated deficits, repeated additions merging into three shipment rows, and
adding an out-of-stock CVT filter as a fourth row marked "Недостаточно". Layouts
were checked at 1440 px and 375 px; document width matches the narrow viewport,
with wide tables scrolling inside their own containers.

TypeScript, scoped ESLint checks, kit unit/database tests, branch isolation and
Timeweb-only checks passed. The full production build also passed, including
standalone runtime preparation, in an isolated `/tmp` source copy with
`NODE_OPTIONS=--max-old-space-size=6144`. The original default-memory build hit
Node's 2 GB heap limit; running a full build alongside the development server
was stopped to avoid memory contention. The final preview runs the successful
standalone build against the local synthetic database.
