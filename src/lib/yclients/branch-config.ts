import { getBranchIntegrationValues } from "@/lib/branch-integration-credentials";
import { getScopedBranchId } from "@/lib/request-tenant-store";

export type YclientsBranchConfig = {
  branchId: string;
  apiBase: string;
  companyId: string;
  locationId?: string;
  partnerToken: string;
  userToken?: string;
  userLogin?: string;
  userPassword?: string;
  webhookSecret?: string;
  companyTitle?: string;
  serviceId?: string;
  staffId?: string;
  branchAddress?: string;
};

export async function getYclientsBranchConfig(): Promise<YclientsBranchConfig> {
  const values = await getBranchIntegrationValues(
    "yclients",
    [
      "apiBase",
      "companyId",
      "locationId",
      "partnerToken",
      "userToken",
      "userLogin",
      "userPassword",
      "webhookSecret",
      "companyTitle",
      "serviceId",
      "staffId",
      "branchAddress",
    ],
    ["companyId", "partnerToken"]
  );
  return {
    branchId: getScopedBranchId(),
    apiBase: (values.apiBase || "https://api.yclients.com/api/v1").replace(/\/+$/, ""),
    companyId: values.companyId.trim(),
    locationId: values.locationId?.trim() || undefined,
    partnerToken: values.partnerToken.trim(),
    userToken: values.userToken?.trim() || undefined,
    userLogin: values.userLogin?.trim() || undefined,
    userPassword: values.userPassword?.trim() || undefined,
    webhookSecret: values.webhookSecret?.trim() || undefined,
    companyTitle: values.companyTitle?.trim() || undefined,
    serviceId: values.serviceId?.trim() || undefined,
    staffId: values.staffId?.trim() || undefined,
    branchAddress: values.branchAddress?.trim() || undefined,
  };
}
