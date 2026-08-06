import { prisma } from "@/lib/db";
import { decryptIntegrationSecret } from "@/lib/messenger/messenger-crypto";
import { getRequestTenant, getScopedBranchId, type RequestTenant } from "@/lib/request-tenant-store";

export type BranchIntegrationProvider = "telegram" | "yclients" | "legacy" | "rossko" | "tbank" | string;

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

export type BranchIntegrationContext = Pick<RequestTenant, "branchId" | "organizationId" | "businessGroupId">;

function exactContext(context?: BranchIntegrationContext) {
  const tenant = getRequestTenant();
  const branchId = context?.branchId ?? getScopedBranchId();
  const organizationId = context?.organizationId ?? tenant?.organizationId;
  const businessGroupId = context?.businessGroupId ?? tenant?.businessGroupId;
  if (!branchId || !organizationId || !businessGroupId) {
    throw new BranchIntegrationCredentialError("Для интеграции требуется точный контекст филиала", "branch_context_required");
  }
  if (tenant) {
    if (tenant.mode !== "branch" || tenant.branchId !== branchId || tenant.organizationId !== organizationId || tenant.businessGroupId !== businessGroupId) {
      throw new BranchIntegrationCredentialError("Контекст интеграции не совпадает с активным филиалом", "branch_context_mismatch");
    }
  }
  return { branchId, organizationId, businessGroupId };
}

/**
 * Единая точка чтения филиальных интеграций. Она никогда не обращается к env
 * и принимает только точный branch + organization + business group scope.
 */
export async function resolveBranchIntegration(
  provider: BranchIntegrationProvider,
  keys: readonly string[],
  required: readonly string[] = keys,
  context?: BranchIntegrationContext
) {
  const scope = exactContext(context);
  const rows = await prisma.integrationCredential.findMany({
    where: {
      branchId: scope.branchId,
      organizationId: scope.organizationId,
      businessGroupId: scope.businessGroupId,
      channel: provider,
      key: { in: [...keys] },
      status: "active",
    },
    orderBy: [{ rotatedAt: "desc" }, { updatedAt: "desc" }],
    select: { id: true, key: true, encryptedValue: true, lastValidatedAt: true, lastErrorCode: true },
  });
  const values: Record<string, string> = {};
  for (const row of rows) {
    if (values[row.key] !== undefined) continue;
    const value = decryptIntegrationSecret(row.encryptedValue);
    if (value) values[row.key] = value;
  }
  const missing = required.filter((key) => !values[key]);
  if (missing.length) throw new IntegrationNotConfiguredForBranch(provider, missing);
  return { provider, ...scope, values, rows };
}

export async function getBranchIntegrationValues(
  provider: BranchIntegrationProvider,
  keys: readonly string[],
  required: readonly string[] = keys
) {
  return (await resolveBranchIntegration(provider, keys, required)).values;
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
  const resolved = await resolveBranchIntegration(provider, [credentialType], [credentialType]);
  const credential = resolved.rows.find((row) => row.key === credentialType);
  if (!credential) {
    throw new BranchIntegrationCredentialError(
      `Credential ${provider}/${credentialType} is not configured for the active branch`,
      "branch_credential_missing"
    );
  }
  const value = resolved.values[credentialType];
  if (!value) {
    throw new BranchIntegrationCredentialError(
      `Credential ${provider}/${credentialType} cannot be decrypted`,
      "branch_credential_invalid"
    );
  }
  return { id: credential.id, value, lastValidatedAt: credential.lastValidatedAt, lastErrorCode: credential.lastErrorCode };
}
