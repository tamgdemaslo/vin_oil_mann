# TODO: cosmetic route renames

The `/shipment/new` runtime is local-DB backed, but the public route paths still keep legacy `local_inventory` names to avoid churn in this iteration.

- `/api/local_inventory/products` -> `/api/catalog/products`
- `/api/local_inventory/counterparties` -> `/api/customers`
- `/api/local_inventory/stores` -> `/api/warehouse/stores`
- `/api/local_inventory/organizations` -> `/api/organizations`
- `/api/local_inventory/product-cells` -> `/api/catalog/product-cells`
- `/api/local_inventory/image` -> `/api/catalog/product-images`
- Diagnostic field `shipmentLocalInventoryId` -> `shipmentId`
