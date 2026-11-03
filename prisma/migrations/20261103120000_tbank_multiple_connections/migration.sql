-- Existing integration remains the main connection, with all accounts and payments intact.
ALTER TABLE "tbank_integrations" ADD COLUMN "connection_key" TEXT NOT NULL DEFAULT 'main',
  ADD COLUMN "name" TEXT NOT NULL DEFAULT 'Основное подключение';
DROP INDEX IF EXISTS "tbank_integrations_branch_id_organization_id_key";
DROP INDEX IF EXISTS "tbank_integrations_branch_org_key";
CREATE UNIQUE INDEX "tbank_integrations_branch_id_organization_id_connection_key_key"
  ON "tbank_integrations"("branch_id", "organization_id", "connection_key");
