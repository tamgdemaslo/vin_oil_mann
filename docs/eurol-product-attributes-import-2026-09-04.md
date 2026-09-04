# Eurol product attributes import — 2026-09-04

## Source and scope

- Source: `pr01301-eurol-product-catalogue-july-2024.pdf`.
- SHA-256: `eb6a637290ed75874c73b856398ce8913182f192ca3a81ce4701afed1c80f850`.
- Included: 20 Eurol formulations that have an exact family and viscosity match in the inventory snapshot.
- Excluded from automatic filling: `Масло моторное Eurol 5W-30 C3 1 л`, because the card does not identify the Eurol product family. The catalogue contains more than one 5W-30 C3 product.

The mapping merges the catalogue sections `APPROVED`, `PERFORMANCE LEVEL`, and `RECOMMENDED FOR USE` into the corresponding searchable API, ACEA, ILSAC, ATF, and manufacturer-specification fields. Package volume comes from the inventory card name because the catalogue identifies formulations rather than local package SKUs.

## Reproducible artifacts

- Mapping: `data/product-attributes/vendors/eurol-2024-07.json`.
- Read-only planner: `scripts/prepare-eurol-product-attributes.mjs`.
- Manifest validation: `scripts/test-eurol-product-attributes.mjs`.

The planner only accepts a local PostgreSQL URL and runs its database read in a read-only transaction. It does not contain a production write path.

## Local restored-copy dry-run

Database: `eco_sales_manifest_20260802` (`LEGACY_UNSCOPED`). This is a restored historical snapshot and is not treated as proof of current production state.

| Metric | Result |
| --- | ---: |
| Active Eurol cards | 33 |
| Exact card matches | 32 |
| Unmatched cards | 1 |
| Ambiguous matches | 0 |
| Cards with proposed changes | 32 |
| Proposed field changes | 87 |
| Apply-eligible exact matches | 32 |

Proposed changes by field:

| Field | Changes |
| --- | ---: |
| `acea` | 12 |
| `apiSpec` | 26 |
| `atf` | 2 |
| `brand` | 3 |
| `oem` | 22 |
| `oemAtf` | 10 |
| `packageVolume` | 7 |
| `sae` | 5 |

The plan corrects several demonstrably stale or malformed values, including Syntence LV `A5 → C5`, Ultrance VCC `API SP → API SN` according to the July 2024 catalogue, Turbosyn specifications copied from an unrelated product, and `Chrysler MS 6396 → Chrysler MS 6395` for Evolence 0W-20.

## Related profile fix

Seven legacy transmission-oil groups use the misspelling `трансмисионное`. The fluid-profile resolver previously missed those groups and classified them as engine oil through its generic fallback. The resolver now accepts both `трансмисионное` and `трансмиссионное`, covered by a regression test.

## Production gate

`npm run check:timeweb-only` passes. Current production values still require an authenticated read before write, and affected rows must be backed up immediately before applying the exact mapping. No production data was changed during this preparation run.
