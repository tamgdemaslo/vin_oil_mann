export { sharedKitNetwork as listNetworkKits } from "@/lib/shared-product-kits";
import type { sharedKitNetwork } from "@/lib/shared-product-kits";
export type ProductKitNetworkResponse = Awaited<ReturnType<typeof sharedKitNetwork>>;
export type ProductKitNetworkView = ProductKitNetworkResponse["kits"][number];
