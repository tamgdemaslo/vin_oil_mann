# Blocked transmission quote: investigated behavior and limits

Read-only investigation of the reported 2026-09-11 18:18 UTC run:

- The run completed in 191.750 seconds; two technical searches took 67.542 and
  42.349 seconds. `completed` did not mean a usable customer quote.
- The provider snapshot did not contain an exact transmission code and its
  body identifier conflicted with MANN. No applicable active technical profile
  supplied verified service capacities.
- External research supplied candidate prose. A complete-refill capacity and a
  drained-volume/level-adjustment procedure did not establish fixed consumption
  for either requested service. Candidate EPC pages referred to other vehicles.
- The calculator returned before resolving available branch labour rules or
  checking the material catalogue. Missing quantity was incorrectly classified
  as `NO_MATERIAL_PRICE`. Full research was absent from the blocked artifact.
- Provider discovery links were mixed into answer sources; model-authored web
  references were additionally labeled `internal_catalog`.

The patch preserves independently resolved, exact branch labour lines while
keeping the full quote total unknown. Catalogue diagnostics distinguish missing
specification matches, missing prices and zero stock without inventing a fluid
quantity, selecting a product, or asserting sufficient stock. Unknown service
quantity has its own error code. The existing renderer shows those lines and
blockers and allows the operator to expand retained technical findings.

Only cited web pages and tool evidence are listed as answer sources. A model's
web reference is labeled as a candidate external source. Research remains
unverified; displaying it cannot authorize service facts. Previously researched
fields are reused for matching service/procedure scope instead of another
enrichment call.

Validation: 24 frozen regression suites, TypeScript, Timeweb infrastructure
checks, and local browser inspection of the actual React renderer. The initial
diagnostics change was also checked at 390px width. The runner replay covers absent service quantities,
independent branch tariffs, catalogue mismatch/price/stock diagnostics, complete
research retention and avoiding duplicate enrichment. Fixtures use synthetic
vehicles and catalogues. No new paid smoke, production mutation, technical
profile activation or production deployment was performed for this patch.

The owner confirmed the commercial rule: bulk oil is charged by actual
consumption; sealed oil is charged as whole packages and the unused oil is
handed to the customer. The planner now preserves fractional consumption to
0.001 L instead of applying legacy whole-litre rounding or a minimum volume.
The catalogue's sale unit and packaging determine purchased units afterwards.
For a planned 4.3 L, this means 4.3 sale litres from bulk, one 5 L canister, or
five 1 L bottles. Unknown or conflicting packaging remains unresolved.

Billing mode is retained in the existing quote JSON, with a sale-unit fallback
for older saved artifacts. Bulk totals are explicitly estimates until measured
consumption is available. All five customer message modes and bundled messages
retain the billing/return condition; price-free modes omit money. Whole-package
leftovers are described as estimates. The tech card displays consumption litres,
not the number of canisters, and quote rows show their sale units. Settings show
the owner-approved policy instead of unused litre-rounding/minimum controls.
The existing currency-rounding policy is unchanged. No accounting writes or
claims of already-measured consumption are introduced.

This is not acceptance of a complete real-vehicle quote. Remaining work is an
applicable verified vehicle/aggregate and service-data path, a supported basis
for pre-visit consumption when the manufacturer specifies measured refill, and
priced compatible fluid and service parts. Candidate prose and complete-refill
capacity must not be promoted merely to make a total appear. Tariff setup alone
does not resolve those requirements.
