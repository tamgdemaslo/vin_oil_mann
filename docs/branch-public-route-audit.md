# Аудит публичных token routes

Сгенерировано 2026-07-28. Routes: **8**; blockers: **0**. Public routes derive branch ownership from the token-owned entity and never from activeBranch session.

| route | file | capability scope | token binding | status |
|---|---|---|---|---|
| Legacy report payload | `src/app/api/diagnostic/public/[token]/route.ts` | READ_ONE_ENTITY | entity token + child relation | TOKEN_BOUND |
| Legacy report photo | `src/app/api/diagnostic/public/[token]/photo/[photoId]/route.ts` | READ_ONE_ATTACHMENT | entity token + child relation | TOKEN_BOUND |
| Legacy reminder mutation | `src/app/api/diagnostic/public/[token]/reminder/route.ts` | TOKEN_TO_BRANCH_MUTATION | entity token + child relation | TOKEN_BOUND |
| Map report payload | `src/app/api/diagnostics/public/[token]/route.ts` | READ_ONE_ENTITY | entity token + child relation | TOKEN_BOUND |
| Map report photo | `src/app/api/diagnostics/public/[token]/photos/[photoId]/route.ts` | READ_ONE_ATTACHMENT | entity token + child relation | TOKEN_BOUND |
| Map vehicle photo | `src/app/api/diagnostics/public/[token]/vehicle-photo/route.ts` | READ_ONE_ATTACHMENT | entity token + child relation | TOKEN_BOUND |
| Map reminder mutation | `src/lib/diagnostic-map-service.ts` | TOKEN_BOUND_MUTATION | entity token + child relation | TOKEN_BOUND |
| Public PDF | `src/app/report/[token]/pdf/route.ts` | READ_ONE_ENTITY | entity token + child relation | TOKEN_BOUND |

## Token entropy

- Diagnostic.clientReportToken: UUID v4, PASS.
- DiagnosticMapSession.publicToken: CUID, PASS.

The map public serializer omits internal session/demand/client IDs, client phone, sender login, upload actor, and CRM/action IDs. Attachment IDs remain opaque CUID/UUID values only where required to address one child under the report token.
