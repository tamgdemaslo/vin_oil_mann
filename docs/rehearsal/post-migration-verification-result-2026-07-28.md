# Post-migration verification — 2026-07-28

**Status: NOT RUN.** No production-copy rehearsal migration exists to verify.

Pending checks include null `branch_id`, orphans, cross-branch relations,
duplicates, row loss, financial totals, stock totals, messages, files,
memberships, integration ownership, sequences, and all-branches mutation
blocking. The successful synthetic PostgreSQL matrix is documented separately
and does not satisfy this gate.
