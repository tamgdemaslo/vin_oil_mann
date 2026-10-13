export type AvitoOilType = "motor" | "transmission";
export type AvitoSort = "name_asc" | "name_desc" | "errors_first" | "no_photos_first" | "ready_first" | "price_asc" | "price_desc" | "stock_asc" | "stock_desc";
export type AvitoPhotoFilter = "all" | "without" | "with";
export type AvitoIssue = { field: string; message: string; severity: "error" | "warning" };
export type AvitoPhoto = { id: string; url: string; name: string; contentType: string; size: number };

export type AvitoOverrides = {
  type?: AvitoOilType;
  title?: string;
  description?: string;
  priceRubles?: number | null;
  brand?: string;
  sae?: string;
  volume?: string;
  acea?: string;
  api?: string;
  atf?: string;
  oem?: string;
  condition?: "Новое" | "Б/у";
  avitoId?: string;
  multiItem?: boolean;
  multiName?: string;
  photoIds?: string[];
};

export type AvitoSettings = {
  name: string;
  enabled: boolean;
  publicBaseUrl: string;
  address: string;
  addressSource: "branch" | "manual";
  sellerAddressId: string;
  contactPerson: string;
  phone: string;
  contactMethod: "По телефону и в сообщениях" | "По телефону" | "В сообщениях";
  storeIds: string[];
  onlyInStock: boolean;
  stockBuffer: number;
  listingFee: "Package" | "PackageBBL" | "BBL";
  titleTemplate: string;
  titleRemovePhrases: string[];
  autoShortenTitles: boolean;
  descriptionTemplate: string;
  categoryDescriptionTemplates: Record<AvitoOilType, string>;
};

export type AvitoConnection = {
  status: "never" | "ok" | "error";
  checkedAt: string | null;
  message: string | null;
  accountId: string | null;
};

export type AvitoSettingsView = AvitoSettings & {
  branchAddress: string;
  configured: boolean;
  clientIdConfigured: boolean;
  clientSecretConfigured: boolean;
  feedUrl: string | null;
  connection: AvitoConnection;
  lastExportAt: string | null;
};

export type AvitoRemoteStatus = {
  status: string;
  avitoId: string | null;
  url: string | null;
  messages: string[];
  checkedAt: string;
  reportId: string;
};

export type AvitoProductSource = {
  id: string;
  name: string;
  article: string | null;
  groupPath: string | null;
  group?: { id: string; name: string; kind: string } | null;
  groupCode?: string | null;
  entityType: string;
  uomName?: string | null;
  brand: string | null;
  sae: string | null;
  packageVolume: string | null;
  acea: string | null;
  aceaExtra: string | null;
  apiSpec: string | null;
  atf: string | null;
  oem: string | null;
  oemAtf: string | null;
  description: string | null;
  salePriceCents: number;
  archived: boolean;
  avito: boolean | null;
  available: number;
  photos: AvitoPhoto[];
  updatedAt: string;
};

export type AvitoListing = {
  source: AvitoProductSource;
  id: string;
  adId: string;
  name: string;
  article: string | null;
  type: AvitoOilType;
  enabled: boolean;
  archived: boolean;
  available: number;
  sourcePriceCents: number;
  sourceUpdatedAt: string;
  overrides: AvitoOverrides;
  values: Required<Omit<AvitoOverrides, "photoIds" | "priceRubles">> & { priceRubles: number | null };
  photos: AvitoPhoto[];
  allPhotos: AvitoPhoto[];
  issues: AvitoIssue[];
  included: boolean;
  remote: AvitoRemoteStatus | null;
};

export type AvitoFeedStats = {
  selected: number;
  included: number;
  outOfStock: number;
  invalid: number;
  warnings: number;
  withdrawals: number;
};

export type AvitoHistoryItem = {
  id: string;
  action: string;
  status: string;
  message: string | null;
  createdAt: string;
  stats: AvitoFeedStats | null;
  downloadUrl: string | null;
  reportId: string | null;
};

export type AvitoWorkspaceData = {
  branchName: string;
  canEdit: boolean;
  canEditSecrets: boolean;
  settings: AvitoSettingsView;
  products: AvitoListing[];
  groups: { key: string; name: string; type: AvitoOilType }[];
  stores: { id: string; name: string }[];
  history: AvitoHistoryItem[];
  stats: AvitoFeedStats;
  total: number;
  limit: number;
};

export type AvitoIntegrationData = {
  branchName: string;
  canEdit: boolean;
  canEditSecrets: boolean;
  settings: AvitoSettingsView;
  stores: { id: string; name: string }[];
  reviewedAds: number;
};
