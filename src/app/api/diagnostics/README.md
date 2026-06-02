# Diagnostic Map API

New diagnostic flows use this namespace: `/api/diagnostics/**`.

The old `/api/diagnostic/**` namespace is legacy-only and must not be used by
new shipment screens. It remains for old `Diagnostic*` records and public tokens
that may already have been sent to clients.

## Operations

- `POST /api/diagnostics` - create a diagnostic map session for a local shipment.
- `GET /api/diagnostics/for-shipment?shipmentId=...` - find the current diagnostic for a shipment.
- `GET /api/diagnostics/[id]` - get a diagnostic map session.
- `PUT /api/diagnostics/[id]/item` - save one diagnostic item.
- `POST /api/diagnostics/[id]/photos` - upload a photo with a caption.
- `PATCH /api/diagnostics/[id]/photos/[photoId]` - update a photo caption.
- `DELETE /api/diagnostics/[id]/photos/[photoId]` - delete a photo.
- `POST /api/diagnostics/[id]/complete` - complete the diagnostic.
- `GET /api/diagnostics/[id]/report-payload` - get report/print payload.
- `GET /api/diagnostics/public/[token]` - get public report payload.
- `POST /api/diagnostics/public/[token]/reminder` - save a public reminder request.
- `POST /api/diagnostics/[id]/recommendations/crm-task` - create a local CRM task from a recommendation.
- `POST /api/diagnostics/[id]/recommendations/add-to-shipment` - add a recommendation to local shipment positions.

## Data boundary

This API is local-DB only. It must not depend on MoySklad, old diagnostic offer
templates, or the old `DiagnosticOffer` flow. Recommendation actions are created
from the diagnostic item/recommendation context.
