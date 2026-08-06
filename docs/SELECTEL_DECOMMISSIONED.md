# Selectel decommissioned

Selectel is no longer a production provider for Eco Platform.

- Production application and PostgreSQL run on Timeweb Cloud App Platform.
- Deployments flow from GitHub to Timeweb.
- Do not deploy to Selectel, use it as a fallback, or store runtime secrets
  there, including `OPENAI_API_KEY`.
- Before any production action, read the current Timeweb runbook in
  `deploy/timeweb/README.md` and run `npm run check:timeweb-only`.

Historical migration evidence, if it must be retained, belongs only in
`docs/legacy/selectel/`; it is not an operational runbook or rollback target.
