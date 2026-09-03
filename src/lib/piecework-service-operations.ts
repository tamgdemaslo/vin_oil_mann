import { createHash } from "node:crypto";

/**
 * Stable payroll group id for a built-in service operation. The branch is part
 * of the hash so identical operations in different branches never share a
 * mutable group record.
 */
export function serviceOperationGroupId(branchId: string, metricCode: string) {
  const digest = createHash("sha256")
    .update(`${branchId}:service-operation:${metricCode.trim().toUpperCase()}`)
    .digest("hex")
    .slice(0, 32);
  return `grp_service_operation_${digest}`;
}
