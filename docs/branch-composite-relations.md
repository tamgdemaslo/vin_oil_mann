# Critical composite branch relations

Generated from Prisma schema and migrations 20260728170000/20260728180000. Critical relations: **40**; blockers: **0**. Optional durable business references use RESTRICT; owned child records use CASCADE.

| model | relation | FK column | Prisma composite | migration | onDelete | status |
|---|---|---|---:|---:|---|---|
| PayrollPeriodEmployee | period | period_id | yes | yes | Restrict | ENFORCED |
| PayrollAccrualLine | period | period_id | yes | yes | Restrict | ENFORCED |
| LocalDemand | counterparty | counterparty_id | yes | yes | Restrict | ENFORCED |
| LocalDemand | store | store_id | yes | yes | Restrict | ENFORCED |
| ShipmentRevision | shipment | shipment_id | yes | yes | Cascade | ENFORCED |
| LocalDemandPosition | demand | demand_id | yes | yes | Cascade | ENFORCED |
| LocalDemandPosition | product | product_id | yes | yes | Restrict | ENFORCED |
| InventoryLedgerEntry | shipment | shipment_id | yes | yes | Restrict | ENFORCED |
| InventoryLedgerEntry | product | product_id | yes | yes | Restrict | ENFORCED |
| InventoryLedgerEntry | store | store_id | yes | yes | Restrict | ENFORCED |
| MessengerMessage | conversation | conversation_id | yes | yes | Cascade | ENFORCED |
| MessengerOutbox | conversation | conversation_id | yes | yes | Restrict | ENFORCED |
| MessengerAttachment | message | message_id | yes | yes | Cascade | ENFORCED |
| DiagnosticPosition | diagnostic | diagnostic_id | yes | yes | Cascade | ENFORCED |
| DiagnosticPhoto | position | position_id | yes | yes | Cascade | ENFORCED |
| DiagnosticOffer | diagnostic | diagnostic_id | yes | yes | Cascade | ENFORCED |
| DiagnosticMapSession | demand | demand_id | yes | yes | Restrict | ENFORCED |
| DiagnosticMapItem | session | session_id | yes | yes | Cascade | ENFORCED |
| DiagnosticMapPhoto | item | item_id | yes | yes | Cascade | ENFORCED |
| InventorySession | warehouse | warehouse_id | yes | yes | Restrict | ENFORCED |
| InventoryLine | session | inventory_session_id | yes | yes | Cascade | ENFORCED |
| InventoryLine | product | product_id | yes | yes | Restrict | ENFORCED |
| InventoryLine | warehouse | warehouse_id | yes | yes | Restrict | ENFORCED |
| InventoryCountEntry | line | inventory_line_id | yes | yes | Cascade | ENFORCED |
| TelegramUserSession | messengerAccount | messenger_account_id | yes | yes | Cascade | ENFORCED |
| MessengerConversation | connection | connection_id | yes | yes | Restrict | ENFORCED |
| MessengerConversation | messengerAccount | messenger_account_id | yes | yes | Restrict | ENFORCED |
| MessengerMessage | messengerAccount | messenger_account_id | yes | yes | Restrict | ENFORCED |
| MessengerOutbox | message | message_id | yes | yes | Restrict | ENFORCED |
| MessengerOutbox | connection | connection_id | yes | yes | Restrict | ENFORCED |
| MessengerOutbox | messengerAccount | messenger_account_id | yes | yes | Restrict | ENFORCED |
| MessengerMediaJob | attachment | attachment_id | yes | yes | Cascade | ENFORCED |
| MessengerDeliveryEvent | message | message_id | yes | yes | Cascade | ENFORCED |
| MessengerSyncCursor | messengerAccount | messenger_account_id | yes | yes | Cascade | ENFORCED |
| DiagnosticOffer | diagnostic | diagnostic_id | yes | yes | Cascade | ENFORCED |
| DiagnosticMapVehiclePhoto | session | session_id | yes | yes | Cascade | ENFORCED |
| InventoryAttachment | line | inventory_line_id | yes | yes | Cascade | ENFORCED |
| LocalProductPhoto | product | product_id | yes | yes | Cascade | ENFORCED |
| LocalStockBalance | product | product_id | yes | yes | Cascade | ENFORCED |
| LocalStockBalance | store | store_id | yes | yes | Cascade | ENFORCED |

Polymorphic fields such as `sourceType/sourceId`, AI snapshot references, and messenger context entity links cannot have a static FK. They remain protected by server-side branch invariants and are tracked as integration-test obligations.
