import { AsyncLocalStorage } from "node:async_hooks";

export type RequestTenant = {
  mode: "branch" | "all" | "denied";
  branchId: string | null;
  organizationId: string | null;
  allowedBranchIds: string[];
  businessGroupId?: string | null;
  userId?: string | null;
  permissions?: string[];
};

const globalTenant = globalThis as typeof globalThis & {
  __ecoRequestTenantStorage?: AsyncLocalStorage<RequestTenant>;
};

const storage = globalTenant.__ecoRequestTenantStorage ??= new AsyncLocalStorage<RequestTenant>();

export function bindRequestTenantStore(value: RequestTenant) {
  storage.enterWith(value);
}

export function runWithRequestTenant<T>(value: RequestTenant, operation: () => T): T {
  return storage.run(value, operation);
}

export function getRequestTenant() {
  return storage.getStore() ?? null;
}

export function getScopedBranchId() {
  const tenant = getRequestTenant();
  if (!tenant) throw new Error("Branch context is required for this operation");
  if (tenant.mode === "branch" && tenant.branchId) return tenant.branchId;
  throw new Error("Для операции выберите конкретный активный филиал");
}
