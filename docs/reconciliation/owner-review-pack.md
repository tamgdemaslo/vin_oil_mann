# Owner review pack

Нужно утвердить: 6 critical same-PK и 14 Railway-only решений.

## Разбивка

- communication_identities: 1
- conversation_entity_links: 1
- crm_deals: 4
- messenger_attachments: 9
- messenger_connections: 1
- notification_jobs: 4

## Последствия

- SAME_PK MANUAL_REVIEW: Selectel остаётся без изменений до решения; никакая строка целиком не заменяется.
- Railway-only MANUAL_REVIEW: запись не импортируется до явного выбора из допустимых действий.
- RECREATE_BUSINESS_EVENT: legacy job не копируется; после подтверждения создаётся новое событие штатным Selectel workflow.
- Все 3 709 исходных Selectel-only строк защищены отдельным denylist/checksum-контролем.

Решения записываются только в `approved-manual-decisions.json`; исходный manifest и PII не редактируются вручную.
