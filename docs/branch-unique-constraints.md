# Аудит unique/PK по филиалам

Сгенерировано из `prisma/schema.prisma` 2026-07-28. Ограничений: **247**, блокеров: **0**. Глобальные технические ID и высокоэнтропийные public tokens не получают `branchId`; их основания перечислены явно.

| model | kind | fields | current scope | expected scope | provider guarantee / basis | risk | migration | duplicate precheck | status |
|---|---|---|---|---|---|---|---|---|---|
| BusinessGroup | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| BusinessGroup | UNIQUE | slug | GLOBAL | GLOBAL_OR_GROUP | global/control-plane model; reviewed by model-scope registry | LOW | no | not required | SAFE_GLOBAL |
| User | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| User | UNIQUE | login | GLOBAL | GLOBAL_OR_GROUP | global/control-plane model; reviewed by model-scope registry | LOW | no | not required | SAFE_GLOBAL |
| Branch | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| Branch | UNIQUE | legacyOrganizationId | GLOBAL | GLOBAL_OR_GROUP | global/control-plane model; reviewed by model-scope registry | LOW | no | not required | SAFE_GLOBAL |
| Branch | UNIQUE | businessGroupId, slug | GLOBAL | GLOBAL_OR_GROUP | global/control-plane model; reviewed by model-scope registry | LOW | no | not required | SAFE_GLOBAL |
| BranchMembership | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| BranchMembership | UNIQUE | branchId, userId | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| BusinessGroupMembership | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| BusinessGroupMembership | UNIQUE | businessGroupId, userId | GLOBAL | GLOBAL_OR_GROUP | global/control-plane model; reviewed by model-scope registry | LOW | no | not required | SAFE_GLOBAL |
| BranchLegalEntity | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| BranchLegalEntity | UNIQUE | branchId, inn | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| BranchCommunicationSettings | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| BranchCommunicationSettings | UNIQUE | branchId | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| BranchTelegramIntegration | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| BranchTelegramIntegration | UNIQUE | branchId | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| BranchAuditLog | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| BranchStockTransfer | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| BranchStockTransferItem | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| Shift | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| Shift | UNIQUE | branchId, userLogin, shiftDate | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| ShiftRate | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| PieceworkRule | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| PieceworkRule | UNIQUE | branchId, targetType, targetId, role | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| BonusPenalty | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| PayrollAdjustment | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| PayrollPayment | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| ChangeLog | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| ScheduledWorkingDay | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| ScheduledWorkingDay | UNIQUE | branchId, userLogin, date | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| PayrollGoal | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| PayrollAchievementDefinition | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| PayrollAchievementDefinition | UNIQUE | branchId, key | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| PayrollAchievementAward | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| EmployeeRecognition | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| PayrollTeamGoal | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| EmployeeMotivationSettings | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| EmployeeMotivationSettings | UNIQUE | branchId, employeeLogin | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| PayrollPeriod | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| PayrollPeriod | UNIQUE | branchId, dateFrom, dateTo | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| PayrollPeriod | UNIQUE | branchId, id | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| PayrollPeriodEmployee | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| PayrollPeriodEmployee | UNIQUE | branchId, periodId, employeeLogin | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| PayrollAccrualLine | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| AuthPassword | ID | login | GLOBAL | GLOBAL_OR_GROUP | global/control-plane model; reviewed by model-scope registry | LOW | no | not required | SAFE_GLOBAL |
| MoySkladDemandSync | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| MoySkladDemandPositionSync | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| MoySkladAnalyticsSyncState | ID | branchId, id | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| CustomerAnalyticsSettings | ID | branchId, id | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| VinLookupCache | ID | branchId, vin | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| VehicleLookupCache | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| VehicleMannMapping | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| VehicleModelAlias | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| VehicleModelAlias | UNIQUE | normalizedMake, sourceName | GLOBAL | GLOBAL_OR_GROUP | global/control-plane model; reviewed by model-scope registry | LOW | no | not required | SAFE_GLOBAL |
| CrmStage | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| CrmStage | UNIQUE | branchId, sortOrder | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| CrmDeal | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| CrmDeal | UNIQUE | branchId, caseKey | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| ClientCaseEvent | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| ClientCaseNotificationLog | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| MessengerConnection | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| MessengerConnection | UNIQUE | branchId, channel, externalChatId | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| MessengerConnection | UNIQUE | branchId, id | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| MessengerAccount | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| MessengerAccount | UNIQUE | branchId, id | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| TelegramUserSession | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| TelegramUserSession | UNIQUE | branchId, messengerAccountId | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| MessengerConversation | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| MessengerConversation | UNIQUE | branchId, channel, externalConversationId | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| MessengerConversation | UNIQUE | branchId, id | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| MessengerMessage | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| MessengerMessage | UNIQUE | branchId, channel, externalMessageId | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| MessengerMessage | UNIQUE | branchId, id | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| MessengerOutbox | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| MessengerOutbox | UNIQUE | branchId, organizationId, idempotencyKey | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| MessengerWebhookEvent | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| MessengerWebhookEvent | UNIQUE | branchId, channel, externalUpdateId | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| MessengerTemplate | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| MessengerTemplate | UNIQUE | branchId, key | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| MessengerLinkToken | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| MessengerLinkToken | UNIQUE | token | GLOBAL | GLOBAL_RANDOM_TOKEN | 192-bit random start token; global uniqueness prevents token ambiguity | LOW | no | not required | SAFE_GLOBAL_TOKEN |
| MessengerChannelSetting | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| MessengerChannelSetting | UNIQUE | branchId, channel | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| IntegrationProvider | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| IntegrationProvider | UNIQUE | channel, providerKey | GLOBAL | GLOBAL_OR_GROUP | global/control-plane model; reviewed by model-scope registry | LOW | no | not required | SAFE_GLOBAL |
| IntegrationCredential | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| IntegrationOnboardingSession | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| WebhookSubscription | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| MessengerAttachment | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| MessengerAttachment | UNIQUE | branchId, id | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| MessengerMediaJob | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| MessengerDeliveryEvent | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| MessengerSyncCursor | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| MessengerSyncCursor | UNIQUE | branchId, organizationId, messengerAccountId, scope | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| CommunicationConsent | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| NotificationTemplate | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| NotificationRule | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| NotificationJob | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| NotificationJob | UNIQUE | branchId, organizationId, idempotencyKey | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| NotificationLog | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| ClientNotificationPreference | ID | clientId | GLOBAL | PARENT_SCOPED | one-to-one preference keyed by globally generated client id; branch ownership is enforced by the client relation policy | LOW | no | not required | SAFE_BY_PARENT |
| CommunicationIdentity | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| CommunicationIdentity | UNIQUE | branchId, organizationId, messengerAccountId, externalUserId | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| ConversationEntityLink | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| ConversationEntityLink | UNIQUE | branchId, organizationId, conversationId, entityType, entityId, relationType | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| IntegrationAuditLog | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| Diagnostic | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| Diagnostic | UNIQUE | clientReportToken | GLOBAL | GLOBAL_RANDOM_TOKEN | UUID v4 public capability token | LOW | no | not required | SAFE_GLOBAL_TOKEN |
| Diagnostic | UNIQUE | branchId, id | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| DiagnosticPosition | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| DiagnosticPosition | UNIQUE | branchId, diagnosticId, node | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| DiagnosticPosition | UNIQUE | diagnosticId, node | GLOBAL | PARENT_SCOPED | redundant parent-scoped key retained for Prisma compatibility; branch-aware twin exists | LOW | no | not required | SAFE_BY_PARENT |
| DiagnosticPosition | UNIQUE | branchId, id | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| DiagnosticPhoto | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| DiagnosticOffer | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| DiagnosticMapSession | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| DiagnosticMapSession | UNIQUE | publicToken | GLOBAL | GLOBAL_RANDOM_TOKEN | CUID public capability token | LOW | no | not required | SAFE_GLOBAL_TOKEN |
| DiagnosticMapSession | UNIQUE | branchId, id | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| DiagnosticMapItem | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| DiagnosticMapItem | UNIQUE | branchId, sessionId, itemCode | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| DiagnosticMapItem | UNIQUE | sessionId, itemCode | GLOBAL | PARENT_SCOPED | redundant parent-scoped key retained for Prisma compatibility; branch-aware twin exists | LOW | no | not required | SAFE_BY_PARENT |
| DiagnosticMapItem | UNIQUE | branchId, id | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| DiagnosticMapPhoto | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| DiagnosticMapVehiclePhoto | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| DiagnosticMapVehiclePhoto | UNIQUE | sessionId | GLOBAL | PARENT_SCOPED | one-to-one child of globally generated session id | LOW | no | not required | SAFE_BY_PARENT |
| DiagnosticMapVehiclePhoto | UNIQUE | branchId, sessionId | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| DiagnosticMapRecommendationAction | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| LocalOrganization | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| LocalOrganization | UNIQUE | moyskladId | GLOBAL | GLOBAL_OR_GROUP | global/control-plane model; reviewed by model-scope registry | LOW | no | not required | SAFE_GLOBAL |
| OrganizationMember | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| OrganizationMember | UNIQUE | branchId, organizationId, userId | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| LocalStore | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| LocalStore | UNIQUE | branchId, moyskladId | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| LocalStore | UNIQUE | branchId, id | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| LocalProduct | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| LocalProduct | UNIQUE | branchId, moyskladId | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| LocalProduct | UNIQUE | branchId, article | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| LocalProduct | UNIQUE | branchId, code | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| LocalProduct | UNIQUE | branchId, barcodeEan13 | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| LocalProduct | UNIQUE | branchId, barcodeEan8 | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| LocalProduct | UNIQUE | branchId, barcodeCode128 | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| LocalProduct | UNIQUE | branchId, id | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| ProductMannLink | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| ProductMannLink | UNIQUE | branchId, organizationId, productId, mannArticleNormalized | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| ProductMannLink | UNIQUE | organizationId, productId, mannArticleNormalized | GLOBAL | PARENT_SCOPED | redundant parent-scoped key retained for Prisma compatibility; branch-aware twin exists | LOW | no | not required | SAFE_BY_PARENT |
| ProductMannPomanMigrationAudit | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| ProductMannPomanMigrationAudit | UNIQUE | branchId, migrationKey, productId | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| MannPdfImportBatch | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| MannPdfApplicationRaw | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| MannPdfApplicationRaw | UNIQUE | sourceRowHash | GLOBAL | GLOBAL_OR_GROUP | global/control-plane model; reviewed by model-scope registry | LOW | no | not required | SAFE_GLOBAL |
| MannFilterApplication | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| MannFilterApplication | UNIQUE | sourceRowHash | GLOBAL | GLOBAL_OR_GROUP | global/control-plane model; reviewed by model-scope registry | LOW | no | not required | SAFE_GLOBAL |
| FluidCatalogImportBatch | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| FluidSourceRow | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| VehicleFluidRequirement | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| MannFluidRequirementLink | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| MannFluidRequirementLink | UNIQUE | requirementId, mannVariantKey | GLOBAL | GLOBAL_OR_GROUP | global/control-plane model; reviewed by model-scope registry | LOW | no | not required | SAFE_GLOBAL |
| ProductMarkingAuditLog | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| ProductImportJob | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| ProductImportRow | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| LocalProductPhoto | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| LocalStockBalance | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| LocalStockBalance | UNIQUE | branchId, productId, storeId | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| LocalStockBalance | UNIQUE | productId, storeId | GLOBAL | PARENT_SCOPED | redundant parent-scoped key retained for Prisma compatibility; branch-aware twin exists | LOW | no | not required | SAFE_BY_PARENT |
| LocalCounterparty | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| LocalCounterparty | UNIQUE | branchId, moyskladId | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| LocalCounterparty | UNIQUE | branchId, normalizedPhone | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| LocalCounterparty | UNIQUE | branchId, id | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| CashShift | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| CashShift | UNIQUE | branchId, serviceDate | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| CashWithdrawal | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| CashExpenseItem | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| CashExpenseItem | UNIQUE | branchId, name | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| CashExpenseItem | UNIQUE | branchId, moyskladId | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| CashExpenseOrder | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| CashExpenseOrder | UNIQUE | branchId, number | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| CashExpenseOrder | UNIQUE | branchId, moyskladId | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| LocalDemand | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| LocalDemand | UNIQUE | branchId, name | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| LocalDemand | UNIQUE | branchId, moyskladId | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| LocalDemand | UNIQUE | branchId, id | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| ShipmentRevision | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| InventoryLedgerEntry | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| InventorySession | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| InventorySession | UNIQUE | branchId, organizationId, number | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| InventorySession | UNIQUE | branchId, id | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| InventoryLine | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| InventoryLine | UNIQUE | branchId, id | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| InventoryCountEntry | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| InventoryCountEntry | UNIQUE | branchId, inventoryLineId, sequence | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| InventoryAttachment | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| InventoryMovementLink | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| InventoryAssignment | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| InventoryLock | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| InventorySchedule | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| InventoryAuditLog | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| ClosingDocument | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| ClosingDocument | UNIQUE | branchId, organizationId, type, number | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| ClosingDocumentNumberSequence | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| ClosingDocumentNumberSequence | UNIQUE | branchId, organizationId, type, year | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| LocalDemandPosition | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| LocalDemandPosition | UNIQUE | branchId, moyskladPositionId | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| DemandAttributeDefinition | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| DemandAttributeDefinition | UNIQUE | branchId, name | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| LocalInventoryDocument | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| LocalInventoryDocument | UNIQUE | branchId, moyskladId | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| LocalInventoryDocumentAuditLog | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| LocalInventoryDocumentPosition | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| LocalInventoryDocumentPosition | UNIQUE | branchId, moyskladPositionId | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| LocalSupplierInvoice | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| LocalSupplierInvoice | UNIQUE | documentId | GLOBAL | PARENT_SCOPED | one-to-one child of globally generated inventory document id | LOW | no | not required | SAFE_BY_PARENT |
| LocalSupplierInvoice | UNIQUE | branchId, moyskladId | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| LocalSupplierInvoicePayment | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| LocalSupplierInvoicePayment | UNIQUE | branchId, moyskladId | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| TBankIntegration | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| TBankIntegration | UNIQUE | branchId, organizationId | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| TBankSettlementAccount | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| TBankSettlementAccount | UNIQUE | branchId, integrationId, accountNumberHash | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| SupplierInvoiceTBankPayment | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| SupplierInvoiceTBankPayment | UNIQUE | branchId, idempotencyKey | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| TBankWebhookEvent | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| TBankWebhookEvent | UNIQUE | branchId, eventId | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| LocalInventorySyncState | ID | branchId, id | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| AIAgentSetting | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| AIAgentSetting | UNIQUE | branchId, organizationId | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| AIAgentSession | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| AIAgentSession | UNIQUE | branchId, organizationId, conversationId | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| AIServiceQuote | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| AIAgentTechnicalEvidence | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| AIAgentQualityFeedback | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| AIAgentRun | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| AIAgentRun | UNIQUE | branchId, idempotencyKey | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| AIAgentRun | UNIQUE | branchId, organizationId, sourceMessageId | BRANCH | BRANCH | n/a | LOW | no | deploy/selectel/branch-unique-duplicate-precheck.sql | SAFE_BRANCH |
| AIAgentRunEvent | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| AIAgentToolCall | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| AIAgentDecision | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| AIAgentHandoff | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| AIAgentSlotHold | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| AIAssistantThread | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| AIAssistantMessage | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| AIAssistantRun | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| AIAssistantToolCall | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| AIAssistantSource | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| AIAssistantQuote | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| AIAssistantLaborPricingRule | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
| VehicleServiceComplexityRule | ID | id | GLOBAL | GLOBAL_TECHNICAL_ID | application-generated UUID/CUID or explicit control-plane id | LOW | no | not required | SAFE_GLOBAL_ID |
