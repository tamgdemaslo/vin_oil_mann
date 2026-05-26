const LEGACY_SELLER_PHONE_RE = /(?:\+?7|8)?\s*\(?999\)?\s*[-\s]?\s*255\s*[-\s]?\s*60\s*[-\s]?\s*31/g;

export const CURRENT_SELLER_PHONE = "+7 (995) 054-58-59";

export function normalizeSellerPhonesForPrint(phones: string): string {
  return phones.replace(LEGACY_SELLER_PHONE_RE, CURRENT_SELLER_PHONE);
}
