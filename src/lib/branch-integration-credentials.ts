import { prisma } from "@/lib/db";
import { decryptIntegrationSecret } from "@/lib/messenger/messenger-crypto";
import { getRequestTenant, getScopedBranchId } from "@/lib/request-tenant-store";

export type BranchIntegrationProvider = "telegram" | "yclients" | "moysklad" | "rossko" | "tbank" | string;

export class BranchIntegrationCredentialError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "BranchIntegrationCredentialError";
  }
}

export class IntegrationNotConfiguredForBranch extends BranchIntegrationCredentialError {
  constructor(provider: string, missing: string[]) {
    super(`Integration ${provider} is not configured for the active branch (${missing.join(", ")})`, "integration_not_configured_for_branch");
    this.name = "IntegrationNotConfiguredForBranch";
  }
}

export async function getBranchIntegrationValues(
  provider: BranchIntegrationProvider,
  keys: readonly string[],
  required: readonly string[] = keys
) {
  const branchId = getScopedBranchId();
  const tenant = getRequestTenant();
  const rows = await prisma.integrationCredential.findMany({
    where: {
      branchId,
      organizationId: tenant?.organizationId ?? undefined,
      channel: provider,
      key: { in: [...keys] },
      status: "active",
    },
    orderBy: [{ rotatedAt: "desc" }, { updatedAt: "desc" }],
    select: { key: true, encryptedValue: true },
  });
  const values: Record<string, string> = {};
  for (const row of rows) {
    if (values[row.key]) continue;
    const value = decryptIntegrationSecret(row.encryptedValue);
    if (value) values[row.key] = value;
  }
  const missing = required.filter((key) => !values[key]);
  if (missing.length) throw new IntegrationNotConfiguredForBranch(provider, missing);
  return values;
}

export async function isBranchIntegrationConfigured(provider: BranchIntegrationProvider, required: readonly string[]) {
  try {
    await getBranchIntegrationValues(provider, required, required);
    return true;
  } catch (error) {
    if (error instanceof IntegrationNotConfiguredForBranch) return false;
    throw error;
  }
}

export async function getBranchIntegrationSecret(provider: BranchIntegrationProvider, credentialType: string) {
  const branchId = getScopedBranchId();
  const tenant = getRequestTenant();
  const credential = await prisma.integrationCredential.findFirst({
    where: {
      branchId,
      organizationId: tenant?.organizationId ?? undefined,
      channel: provider,
      key: credentialType,
      status: "active",
    },
    orderBy: [{ rotatedAt: "desc" }, { updatedAt: "desc" }],
    select: { id: true, encryptedValue: true, lastValidatedAt: true, lastErrorCode: true },
  });
  if (!credential) {
    throw new BranchIntegrationCredentialError(
      `Credential ${provider}/${credentialType} is not configured for the active branch`,
      "branch_credential_missing"
    );
  }
  const value = decryptIntegrationSecret(credential.encryptedValue);
  if (!value) {
    throw new BranchIntegrationCredentialError(
      `Credential ${provider}/${credentialType} cannot be decrypted`,
      "branch_credential_invalid"
    );
  }
  return { id: credential.id, value, lastValidatedAt: credential.lastValidatedAt, lastErrorCode: credential.lastErrorCode };
}
