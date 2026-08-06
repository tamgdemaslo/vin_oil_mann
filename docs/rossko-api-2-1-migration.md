# ROSSKO API 2.1: mapping and safe migration

The integration uses the documented SOAP endpoints:

- `https://api.rossko.ru/service/v2.1/GetCheckoutDetails`
- `https://api.rossko.ru/service/v2.1/GetSearch`
- `https://api.rossko.ru/service/v2.1/GetCheckout`

`integration_credentials` stores every value encrypted. The legacy value `223246`
cannot be inspected from source control (it is not stored in plaintext); the former
form binds the value to the `profile` credential key. Therefore it is an internal
CRM value, not a proved ROSSKO identifier. It remains untouched until a separately
approved cleanup after the live, per-branch audit below.

| Current database key | Current value | Real purpose | Exact ROSSKO source / use | New field |
|---|---:|---|---|---|
| `profile` | legacy encrypted value, e.g. `223246` | CRM-created free text; no public API meaning | None | None. Retained as legacy only; not returned by the API or shown in the form. |
| `preferredStore` | legacy encrypted text | CRM-created warehouse/address preference; not a ROSSKO checkout setting | None. The real stock is `GetSearch.PartsList.Part.stocks.stock.id`, supplied as `GetCheckout.PARTS.Part.stock`. | `offerPriority` is a local business preference only; it sorts actual `GetSearch` stocks and never invents a warehouse ID. |
| `deliveryId` | selected string | Delivery method for checkout/search | `GetCheckoutDetails.DeliveryType.delivery.id` → `GetCheckout.delivery.delivery_id`, `GetSearch.delivery_id` | unchanged key, selected only from the API list |
| `addressId` | selected string or empty for pickup | Delivery address | `GetCheckoutDetails.DeliveryAddress.address.id` → `GetCheckout.delivery.address_id`; allowed delivery IDs are `DeliveryAddress.address.Delivery.ids.id` | unchanged key, selected only from the API list |
| `paymentId` | selected string | Payment method | `GetCheckoutDetails.PaymentType.payment.id` → `GetCheckout.payment.payment_id` | unchanged key, selected only from the API list |
| `requisiteId` | legacy manual value or selected string | Buyer requisites ID; no longer a free-text input | `GetCheckoutDetails.CompanyList.company.id` → `GetCheckout.payment.requisite_id` when the checkout method requires it | unchanged key, populated by the selected organisation |
| `contactName` | text | Buyer contact name | `GetCheckout.contact.name` | unchanged key |
| `contactPhone` | text | Buyer contact phone | `GetCheckout.contact.phone` | unchanged key |
| `contactComment` | text | Operator comment | `GetCheckout.contact.comment` | new key |
| `deliveryParts` | boolean | Partial-delivery preference | `GetCheckout.delivery_parts` | unchanged key |
| `offerPriority` | business option | Local ordering of actual search offers | `GetSearch.stocks.stock.delivery`, `.price`, `.extra`; chosen `stock.id` remains the one sent to checkout | new key |
| `AIAgentSetting.rosskoMarkupRulesJson` | филиальный массив диапазонов | Действующий движок наценки: закупочная цена, применённое правило и рассчитанная розничная цена | `getAgentSettings(branchId, organizationId)` в обоих инструментах ИИ; редактируется также в карточке ROSSKO без дублирования данных | существующая филиальная модель переиспользована |

## Safe per-branch migration

1. Open **Integrations → ROSSKO** and use “Проверить ключи и загрузить настройки”. This calls only `GetCheckoutDetails` and returns no keys to the browser.
2. Select the organisation, delivery, address, and payment from the returned lists. A single organisation is selected automatically. Incompatible delivery/address pairs cannot be saved.
3. Use “Сохранить и проверить поиск”. The save revalidates every selected ID against a new `GetCheckoutDetails` response, then runs read-only `GetSearch`; it never calls `GetCheckout`.
4. Record the per-branch result (legacy key name, masked/non-secret presence, and selected API IDs) in the approved migration report. Do not copy decrypted values, keys, or `223246` into logs.
5. Only after every affected branch has a recorded result may `profile` and `preferredStore` be considered for a separately approved data-retention or deletion migration. This change deliberately does not delete or mutate either legacy value.
