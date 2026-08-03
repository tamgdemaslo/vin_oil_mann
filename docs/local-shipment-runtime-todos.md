# TODO: cosmetic route renames

The `/shipment/new` runtime is local-DB backed, but the public route paths still keep legacy `moysklad` names to avoid churn in this iteration.

- `/api/moysklad/products` -> `/api/catalog/products`
- `/api/moysklad/counterparties` -> `/api/customers`
- `/api/moysklad/stores` -> `/api/warehouse/stores`
- `/api/moysklad/organizations` -> `/api/organizations`
- `/api/moysklad/product-cells` -> `/api/catalog/product-cells`
- `/api/moysklad/image` -> `/api/catalog/product-images`
- Diagnostic field `shipmentMoySkladId` -> `shipmentId`
