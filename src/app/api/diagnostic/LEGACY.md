# Legacy Diagnostic API

`src/app/api/diagnostic/**` is the old diagnostic API surface.

It is kept only for legacy `Diagnostic`, `DiagnosticPosition`, `DiagnosticPhoto`
and `DiagnosticOffer` data, plus old public report tokens that may already have
been sent to clients.

New user flows must use `src/app/api/diagnostics/**` and the local diagnostic map
models. Do not add new UX features or MoySklad-dependent diagnostic behavior here.
