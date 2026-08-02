/** Ответ VIN Decoder API (POST /vin/decode) */
export type VinDecodeResponse = {
  make?: string;
  model?: string;
  year?: string;
  engine?: string;
  /** Код двигателя, если его вернул декодер VIN. */
  engineCode?: string;
  /** Рабочий объём двигателя в см³. */
  engineVolumeCc?: number;
  powerHp?: number;
  trim?: string;
  series?: string;
  market?: string;
  region?: string;
  vin?: string;
  hints?: string[];
  raw?: Record<string, unknown>;
};

/** Требования к маслу от OpenAI (structured output) */
export type OilRequirements = {
  oil_capacity_liters?: number;
  oil_capacity_note?: string;
  sae_viscosities: string[];
  oem_approvals: string[];
  acea: string[];
  api: string[];
  /** Допуски ILSAC (если есть отдельно от API/ACEA) */
  ilsac?: string[];
  confidence: number;
  source_hint?: string;
};

/** Нормализованные допуски товара из МойСклад */
export type RequirementsNorm = {
  sae: string[];
  oem: string[];
  acea: string[];
  api: string[];
  ilsac: string[];
};

/** Товар масла из МойСклад с нормализованными требованиями */
export type OilProduct = {
  id: string;
  name: string;
  article?: string;
  price: number;
  currency: string;
  meta: { href: string };
  requirements_norm: RequirementsNorm;
  volume_liters?: number;
  imageHref?: string;
};

/** Один элемент recommended/alternatives с объяснением */
export type OilRecommendationItem = {
  product: OilProduct;
  score: number;
  why: string[];
};

/** Результат подбора масел по VIN */
export type OilRecommendationResult = {
  vin: string;
  decoded?: VinDecodeResponse | null;
  requirements?: OilRequirements | null;
  recommended: OilRecommendationItem[];
  alternatives: OilRecommendationItem[];
  warning?: string;
}
