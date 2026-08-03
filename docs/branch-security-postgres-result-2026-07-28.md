# PostgreSQL branch security result — 2026-07-28

## Result

**PASS for the synthetic PostgreSQL matrix scope.** This closes the empty-test
database blocker. It does not replace the production-copy migration and API
rehearsals.

## Environment

- PostgreSQL: **18.4 (Homebrew)**, matching Selectel major version 18.
- Host: `127.0.0.1:55432` only.
- Database: `eco_branch_security`.
- Extensions: `plpgsql 1.0`.
- Public tables after schema preparation: **145**.
- Production credentials/data/integrations: not used.
- Schema mode: `push` from the current `prisma/schema.prisma` into an empty
  synthetic database.

The historical migration chain was also tested in `migrate` mode. It cannot
bootstrap an empty database because migration
`20260528150000_crm_client_cases` expects `crm_deals`, which is part of the
pre-existing production baseline and is not created by an earlier tracked
migration. This is recorded as a migration-baseline limitation. The real
migration chain must be proven on the canonical Selectel production copy.

## Assertions

- Database assertions passed: **13**.
- Database assertions failed: **0**.
- Direct cross-branch FK attacks blocked: **8**.
- Synthetic rows remaining after test: **0** (transaction rolled back).

Direct attacks:

1. Shipment A → Client B.
2. ShipmentItem A → Product B.
3. Payroll row A → Period B.
4. Message A → Conversation B.
5. Stock movement A → Store/Product B.
6. DiagnosticPhoto A → DiagnosticPosition B.
7. ProductPhoto A → Product B.
8. Queue job A → Attachment B.

Application policy assertions also passed for branch-scoped list, get,
create, update, delete, explicit all-branches read, denied context, credentials,
AI settings, webhook events, attachments, and queue models. All-branches
mutations and foreign branch IDs are rejected fail-closed.

## Command

```text
BRANCH_SECURITY_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/eco_branch_security?schema=public npm run test:branch-security-db
```

Result:

```text
Branch security DB schema mode: push.
PostgreSQL two-branch security matrix passed (13 DB assertions plus application policy matrix). Test data rolled back.
```

## Remaining verification

The matrix does not yet constitute full HTTP/browser E2E evidence for every
route. File, export, AI, and webhook coverage here proves the shared
fail-closed query policy and database relations; endpoint-level smoke and
negative tests must be repeated against the migrated production-copy rehearsal.
