import { z } from "zod";

export const avitoSettingsSchema = z.object({
  name: z.string().trim().min(1).max(100), enabled: z.boolean(), publicBaseUrl: z.string().trim().max(300),
  address: z.string().trim().max(256), sellerAddressId: z.string().trim().max(30), contactPerson: z.string().trim().max(40), phone: z.string().trim().max(40),
  contactMethod: z.enum(["По телефону и в сообщениях", "По телефону", "В сообщениях"]),
  storeIds: z.array(z.string().min(1).max(200)).max(200), onlyInStock: z.boolean(), stockBuffer: z.number().finite().min(0).max(1_000_000),
  listingFee: z.enum(["Package", "PackageBBL", "BBL"]),
}).strict();

export const avitoSettingsSaveSchema = z.object({
  settings: avitoSettingsSchema,
  clientId: z.string().trim().max(1000).optional(), clientSecret: z.string().trim().max(2000).optional(),
  rotateFeedToken: z.boolean().optional(),
}).strict();

export const avitoCredentialsSaveSchema = z.object({
  clientId: z.string().trim().max(1000).optional(),
  clientSecret: z.string().trim().max(2000).optional(),
  publicBaseUrl: z.string().trim().max(300).optional(),
}).strict();

export const avitoOverridesSchema = z.object({
  type: z.enum(["motor", "transmission"]).optional(),
  title: z.string().trim().max(500).optional(), description: z.string().trim().max(15_000).optional(),
  priceRubles: z.number().int().min(1).max(1_000_000_000).nullable().optional(),
  brand: z.string().trim().max(200).optional(), sae: z.string().trim().max(100).optional(), volume: z.string().trim().max(100).optional(),
  acea: z.string().trim().max(4000).optional(), api: z.string().trim().max(4000).optional(), atf: z.string().trim().max(4000).optional(), oem: z.string().trim().max(4000).optional(),
  condition: z.enum(["Новое", "Б/у"]).optional(), avitoId: z.string().trim().max(25).optional(),
  multiItem: z.boolean().optional(), multiName: z.string().trim().max(100).optional(), photoIds: z.array(z.string().min(1).max(200)).max(10).optional(),
}).strict();

export const avitoListingSaveSchema = z.object({
  id: z.string().min(1).max(200), enabled: z.boolean(), overrides: avitoOverridesSchema,
  sourceUpdatedAt: z.string().datetime(),
}).strict();

export const avitoSelectionSchema = z.object({ ids: z.array(z.string().min(1).max(200)).min(1).max(500), enabled: z.boolean() }).strict();
export const avitoExportSchema = z.object({ allowEmpty: z.boolean().optional() }).strict();
export const avitoApiActionSchema = z.object({ action: z.enum(["test", "connect", "upload", "reports"]) }).strict();

export class AvitoAutoloadError extends Error {
  constructor(message: string, public status = 422, public code = "AVITO_VALIDATION", public details?: unknown) { super(message); this.name = "AvitoAutoloadError"; }
}
