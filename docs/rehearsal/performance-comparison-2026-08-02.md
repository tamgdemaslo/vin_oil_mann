# Branch migration performance comparison — 2026-08-02

**Status: PASS for the isolated Selectel-copy benchmark.**

Each result is the median of five warm `EXPLAIN ANALYZE` runs. Absolute
post-migration execution time is below 0.1 ms in all five sampled paths.

| Query | Before, ms | After, ms | Delta |
|---|---:|---:|---:|
| Product browse | 0.071 | 0.090 | +26.76% |
| Stock aggregate | 0.103 | 0.104 | +0.97% |
| Recent shipment | 0.054 | 0.063 | +16.67% |
| Recent message | 1.432 | 0.099 | -93.09% |
| Active CRM cases | 0.040 | 0.041 | +2.50% |

The percentage increases are sub-0.02 ms effects. The rehearsal found stale
planner estimates after the branch backfill; the final migration refreshes
statistics after creating the branch/order indexes. Production traffic and
concurrency were not measured.

Raw evidence:
[`performance-comparison-2026-08-02.json`](performance-comparison-2026-08-02.json).
